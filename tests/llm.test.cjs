const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function boot(fetch) {
  const context = { fetch, AbortController, TextDecoder, setTimeout, clearTimeout, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "agents", "llm.js"), "utf8"), context);
  return context;
}

function sseResponse(chunks) {
  let index = 0;
  return {
    ok: true,
    headers: { get: () => "text/event-stream" },
    body: { getReader: () => ({ read: async () => index < chunks.length
      ? { done: false, value: new TextEncoder().encode(chunks[index++]) }
      : { done: true } }) },
  };
}

test("parses the final SSE line without a trailing newline", async () => {
  const response = sseResponse(['data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}']);
  const context = boot(async () => response);
  const result = await context.llmJson(
    { baseUrl: "https://example.test/v1", apiKey: "secret", model: "demo" },
    "system", "user", { timeoutMs: 1000 },
  );
  assert.equal(result.data.ok, true);
});

test("uses the same abort signal for the non-streaming fallback", async () => {
  const signals = [];
  let call = 0;
  const context = boot(async (_url, options) => {
    signals.push(options.signal);
    if (call++ === 0) return sseResponse([]);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"fallback":true}' } }] }),
      headers: { get: () => "application/json" },
    };
  });
  const result = await context.llmJson(
    { baseUrl: "https://example.test/v1", apiKey: "secret", model: "demo" },
    "system", "user", { timeoutMs: 1000 },
  );
  assert.equal(result.data.fallback, true);
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
});

test("aborts a stalled request on timeout", async () => {
  const context = boot((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  }));
  await assert.rejects(
    context.llmJson(
      { baseUrl: "https://example.test/v1", apiKey: "secret", model: "demo" },
      "system", "user", { timeoutMs: 10 },
    ),
    /Timeout/,
  );
});

test("timeout after streamed chunks exposes partial content", async () => {
  const chunks = ['data: {"choices":[{"delta":{"content":"{\\"partial\\":"}}]}\n'];
  const context = boot(async (_url, options) => {
    let index = 0;
    return {
      ok: true,
      headers: { get: () => "text/event-stream" },
      body: { getReader: () => ({ read: async () => {
        if (index < chunks.length) {
          return { done: false, value: new TextEncoder().encode(chunks[index++]) };
        }
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      } }) },
    };
  });
  await assert.rejects(
    context.llmJson(
      { baseUrl: "https://example.test/v1", apiKey: "secret", model: "demo" },
      "system", "user", { timeoutMs: 10 },
    ),
    error => {
      assert.match(error.message, /Timeout/);
      assert.equal(error.partial.raw, '{"partial":');
      assert.equal(error.partial.usedSource, "interrupted");
      assert.ok(error.partial.estimatedTokens > 0);
      return true;
    },
  );
});

test("parse failures expose raw and reasoning partials", async () => {
  const response = sseResponse([
    'data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}\n',
    'data: {"choices":[{"delta":{"reasoning_content":"draft json was incomplete"}}]}\n',
  ]);
  const context = boot(async () => response);
  await assert.rejects(
    context.llmJson(
      { baseUrl: "https://example.test/v1", apiKey: "secret", model: "demo" },
      "system", "user", { timeoutMs: 1000 },
    ),
    error => {
      assert.match(error.message, /JSON parse failed/);
      assert.equal(error.partial.raw, '{"ok":');
      assert.equal(error.partial.reasoning, "draft json was incomplete");
      assert.equal(error.partial.usedSource, "unparsed");
      return true;
    },
  );
});

test("classifies common provider failures", () => {
  const context = boot(async () => { throw new Error("unused"); });
  const http = (status, message) => Object.assign(new Error(`HTTP ${status}: ${message}`), { status, body: message });
  assert.equal(context.classifyLlmError(http(401, "Unauthorized")).code, "auth");
  assert.equal(context.classifyLlmError(http(404, "model not found")).code, "not-found");
  assert.equal(context.classifyLlmError(http(429, "rate limit")).code, "rate-limit");
  assert.equal(context.classifyLlmError(new Error("Timeout (15s)")).code, "timeout");
  assert.equal(context.classifyLlmError(new TypeError("fetch failed")).code, "network");
  assert.equal(context.classifyLlmError(http(400, "response_format json_object unsupported")).code, "json-mode");
  assert.equal(context.classifyLlmError(http(404, "No endpoints found that support image input"), { vision: true }).code, "non-vision");
});

test("probeLlmConnection reports success and classified failures", async () => {
  const okResponse = {
    ok: true,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
  };
  const ok = boot(async () => okResponse);
  const success = await ok.probeLlmConnection(
    { baseUrl: "https://example.test/v1", apiKey: "secret", model: "demo" },
    { timeoutMs: 1000 },
  );
  assert.equal(success.ok, true);

  const failure = boot(async () => ({
    ok: false,
    status: 401,
    headers: { get: () => "application/json" },
    text: async () => "Unauthorized",
  }));
  const failed = await failure.probeLlmConnection(
    { baseUrl: "https://example.test/v1", apiKey: "bad", model: "demo" },
    { timeoutMs: 1000 },
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "auth");
});


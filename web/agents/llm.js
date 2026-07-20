// Thin OpenAI-compatible chat client with streaming + reasoning support.
// Works against any provider exposing /v1/chat/completions (OpenAI, Groq,
// Azure, OpenRouter, Ollama, vLLM…).

const PPTGEN_PROBE_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzoAAAAASUVORK5CYII=";

function _httpStatusFromError(error) {
  if (Number.isFinite(error?.status)) return error.status;
  const match = /HTTP\s+(\d{3})/i.exec(String(error?.message || ""));
  return match ? Number(match[1]) : 0;
}

function _errorText(error) {
  return [error?.message, error?.body, error?.stack]
    .filter(Boolean).join("\n").slice(0, 2000);
}

function _estimatePartialTokens(raw, reasoning) {
  const estimator = globalThis.PPTGen?.llmContext?.estimateTokens;
  if (typeof estimator === "function") return estimator(String(raw || "") + "\n" + String(reasoning || ""));
  return Math.ceil((String(raw || "").length + String(reasoning || "").length) / 4);
}

function _attachLlmPartial(error, { raw = "", reasoning = "", usedSource = null } = {}) {
  if (error?.partial || (!raw && !reasoning)) return error;
  error.partial = {
    raw: String(raw || ""),
    reasoning: String(reasoning || ""),
    usedSource,
    estimatedTokens: _estimatePartialTokens(raw, reasoning),
  };
  return error;
}

function classifyLlmError(error, { vision = false } = {}) {
  const status = _httpStatusFromError(error);
  const text = _errorText(error);
  const lower = text.toLowerCase();
  let code = "unknown";
  if (/timeout|provider n'a pas r/i.test(text)) code = "timeout";
  else if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api key|api key/i.test(text)) code = "auth";
  else if (status === 429 || /rate limit|too many requests|quota/i.test(text)) code = "rate-limit";
  else if (vision && /no endpoints found.*image|support image input|image input|image_url|vision|multimodal/i.test(text)) code = "non-vision";
  else if (/response_format|json_object|json mode|unsupported.*json|does not support.*json/i.test(text)) code = "json-mode";
  else if (status === 404 || /model.*not found|not found|unknown model/i.test(text)) code = "not-found";
  else if (/json parse failed|provider returned non-json|unexpected token/i.test(text)) code = "parse";
  else if (/failed to fetch|fetch failed|networkerror|load failed|err_network|econnrefused|enotfound|cors/i.test(lower)) code = "network";

  const messages = {
    auth: "Cle API invalide ou refusee par le provider.",
    "not-found": "Base URL ou modele introuvable chez le provider.",
    "non-vision": "Le modele configure ne semble pas supporter les images.",
    timeout: "Timeout : le provider n'a pas repondu a temps.",
    "rate-limit": "Quota ou rate limit atteint chez le provider.",
    "json-mode": "Le provider refuse response_format=json_object pour ce modele.",
    network: "Base URL injoignable ou erreur reseau.",
    parse: "Le provider a repondu, mais pas avec un JSON exploitable.",
    unknown: "Erreur LLM non classifiee.",
  };
  return {
    code,
    message: messages[code],
    status: status || null,
    detail: String(error?.message || error || "").slice(0, 500),
  };
}

function _throwHttpError(status, body, suffix = "") {
  const error = new Error(`HTTP ${status}${suffix}: ${String(body || "").slice(0, 500)}`);
  error.status = status;
  error.body = String(body || "");
  throw error;
}

async function probeLlmConnection(cfg, { vision = false, timeoutMs = 15_000 } = {}) {
  const model = vision ? (cfg.visionModel || cfg.model) : cfg.model;
  const userPrompt = vision
    ? [
        { type: "text", text: "Return JSON {\"ok\":true} after checking that you can read this image." },
        { type: "image_url", image_url: { url: PPTGEN_PROBE_PIXEL } },
      ]
    : "Return exactly this JSON object: {\"ok\":true}";
  try {
    await llmJson(
      { ...cfg, model },
      "Return one compact JSON object and no prose.",
      userPrompt,
      { model, temperature: 0, stream: false, reasoningFormat: null, useJsonMode: true, timeoutMs },
    );
    return { ok: true, code: "ok", model, message: `Connexion OK (${model}).` };
  } catch (error) {
    const diagnostic = classifyLlmError(error, { vision });
    return { ok: false, model, ...diagnostic };
  }
}

/**
 * Stream a chat completion, collect the full reply, parse as JSON.
 * @param {Object}   cfg            - { baseUrl, apiKey, model }
 * @param {string}   systemPrompt
 * @param {string|Array} userPrompt - either a plain string or a
 *   multimodal array: [{type:"text", text:"..."}, {type:"image_url",
 *   image_url:{url:"data:image/png;base64,..."}}]
 * @param {Object}   [options]      - { temperature, onDelta, reasoningFormat, model, stream }
 *   - model : override cfg.model (used e.g. for vision calls with a different model)
 *   - stream : default true ; set false for non-streaming (simpler responses)
 * @returns {Promise<{data: Object, reasoning: string, raw: string, usedSource: string}>}
 */
async function llmJson(cfg, systemPrompt, userPrompt, options = {}) {
  const {
    temperature = 0.4,
    onDelta,
    reasoningFormat = "parsed",
    model,
    stream = true,
    useJsonMode = true,          // set false for vision models that reject response_format
    timeoutMs = 360_000,         // hard abort after this total request window
    signal: externalSignal,      // optional caller-owned AbortSignal (UI "stop")
  } = options;

  // Abort the underlying fetch if the caller's timeout elapses. This is
  // what prevents a stuck analysis from holding the UI forever.
  // If the caller also passed a signal (e.g. a UI "stop" button), we
  // forward its abort to our internal controller so either source cancels
  // the fetch.
  const abortCtrl = new AbortController();
  const abortTimer = setTimeout(() => abortCtrl.abort("timeout"), timeoutMs);
  let externalAborted = false;
  let onExternalAbort = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(abortTimer);
      throw new Error("Agent stopped by the user before sending.");
    }
    onExternalAbort = () => {
      externalAborted = true;
      abortCtrl.abort("external");
    };
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model: model || cfg.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
    temperature,
    stream,
  };
  // Only include these knobs when the caller actually wants them. Passing
  // unknown fields trips a 400 on some OpenAI-compatible providers.
  if (useJsonMode) body.response_format = { type: "json_object" };
  if (reasoningFormat) body.reasoning_format = reasoningFormat;

  let fullContent = "";
  let fullReasoning = "";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.apiKey}`,
        ...(stream ? { "Accept": "text/event-stream" } : {}),
      },
      body: JSON.stringify(body),
      signal: abortCtrl.signal,
    });
    if (!res.ok) {
    const text = await res.text();
    _throwHttpError(res.status, text);
    }
  const contentTypeHeader = (res.headers.get("content-type") || "").toLowerCase();
  const isSse = contentTypeHeader.includes("text/event-stream");

  if (!stream || !isSse) {
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      const msg = data.choices?.[0]?.message || {};
      fullContent = msg.content || "";
      fullReasoning = msg.reasoning || msg.reasoning_content || "";
    } catch (e) {
      throw new Error(
        `Provider returned non-JSON, non-SSE body (content-type: ${contentTypeHeader || "unknown"}). ` +
        `First 400 chars: ${text.slice(0, 400)}`
      );
    }
  } else {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consumeLine = line => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      let chunk;
      try { chunk = JSON.parse(payload); }
      catch { return; }
      const delta = chunk.choices?.[0]?.delta || {};
      const contentChunk = delta.content || "";
      const reasoningChunk = delta.reasoning ?? delta.reasoning_content ?? "";
      if (contentChunk) fullContent += contentChunk;
      if (reasoningChunk) fullReasoning += reasoningChunk;
      if (onDelta && (contentChunk || reasoningChunk)) {
        onDelta({ contentChunk, reasoningChunk, fullContent, fullReasoning });
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop();   // keep incomplete trailing line for next round

      for (const line of lines) consumeLine(line);
    }
    buffer += decoder.decode();
    for (const line of buffer.split("\n")) consumeLine(line);

    // Stream closed empty? That happens when the provider accepts
    // `stream:true` but never flushes anything (OpenRouter does this for
    // some free models). Fall back to a non-streaming retry.
    if (!fullContent && !fullReasoning) {
      const retryBody = { ...body, stream: false };
      const retryRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(retryBody),
        signal: abortCtrl.signal,
      });
      if (!retryRes.ok) {
        const t = await retryRes.text();
        _throwHttpError(retryRes.status, t, " on non-stream retry");
      }
      const data = await retryRes.json();
      const msg = data.choices?.[0]?.message || {};
      fullContent = msg.content || "";
      fullReasoning = msg.reasoning || msg.reasoning_content || "";
    }
  }

  // Some providers still embed <think>...</think> blocks in content when
  // reasoning_format isn't honored. Split them out.
  const { think, rest } = extractThink(fullContent);
  if (think && !fullReasoning) fullReasoning = think;

  // Parse the output. Primary source = content. Fallback = reasoning,
  // because some providers (notably Groq with gpt-oss in certain modes)
  // put the whole JSON in `reasoning` when `reasoning_format: parsed` is
  // combined with `response_format: json_object`.
  const candidates = [
    stripJsonFences(rest),
    stripJsonFences(extractLastJson(fullReasoning) || fullReasoning),
  ].filter(Boolean);

  let parsed, usedSource;
  for (const [idx, cand] of candidates.entries()) {
    try {
      parsed = JSON.parse(cand);
      usedSource = idx === 0 ? "content" : "reasoning-fallback";
      break;
    } catch { /* try next */ }
  }
  if (!parsed) {
    const parseError = new Error(
      `JSON parse failed — no valid JSON in content or reasoning.\n` +
      `content: ${fullContent.length} chars; reasoning: ${fullReasoning.length} chars`
    );
    throw _attachLlmPartial(parseError, {
      raw: fullContent,
      reasoning: fullReasoning,
      usedSource: "unparsed",
    });
  }
    return { data: parsed, reasoning: fullReasoning, raw: fullContent, usedSource };
  } catch (error) {
    if (error?.name === "AbortError" || abortCtrl.signal.aborted) {
      if (externalAborted) {
        throw _attachLlmPartial(new Error("Agent stopped by the user."), {
          raw: fullContent,
          reasoning: fullReasoning,
          usedSource: "interrupted",
        });
      }
      throw _attachLlmPartial(new Error(`Timeout (${timeoutMs / 1000}s): the provider did not respond.`), {
        raw: fullContent,
        reasoning: fullReasoning,
        usedSource: "interrupted",
      });
    }
    _attachLlmPartial(error, {
      raw: fullContent,
      reasoning: fullReasoning,
      usedSource: "interrupted",
    });
    throw error;
  } finally {
    clearTimeout(abortTimer);
    if (externalSignal && onExternalAbort) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

// Grab the last balanced JSON object/array inside a free-text string.
// Useful when the model wraps the final payload at the end of its reasoning.
function extractLastJson(s) {
  if (!s) return "";
  const str = String(s);
  // Find the last `{` or `[`, then walk forward matching braces.
  for (let startIdx = str.length - 1; startIdx >= 0; startIdx--) {
    const c = str[startIdx];
    if (c !== "{" && c !== "[") continue;
    const open = c, close = c === "{" ? "}" : "]";
    let depth = 0, inString = false, esc = false;
    for (let i = startIdx; i < str.length; i++) {
      const ch = str[i];
      if (inString) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") inString = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return str.slice(startIdx, i + 1);
      }
    }
  }
  return "";
}

function stripJsonFences(s) {
  const trimmed = (s || "").trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1].trim() : trimmed;
}

function extractThink(s) {
  const m = /^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/.exec(s || "");
  if (m) return { think: m[1].trim(), rest: m[2].trim() };
  return { think: "", rest: s || "" };
}

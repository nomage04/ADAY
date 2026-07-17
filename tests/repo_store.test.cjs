const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzoAAAAASUVORK5CYII=";
const layout = id => ({ id, name: id, category: "custom", imageDataUrl: PIXEL, zones: [] });

function localStorageMock(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function makeHarness({ initialState = {}, local = {}, confirm = true, failInitial = false } = {}) {
  const server = {
    layouts: [], icons: [], photos: [], history: [],
    settings: {}, gallery: {}, warnings: [], ...structuredClone(initialState),
  };
  const calls = [];
  let failNext = false;
  let initialPending = failInitial;
  const response = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    async json() { return structuredClone(body); },
    async text() { return JSON.stringify(body); },
  });
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/state" && initialPending) {
      initialPending = false;
      return response(503, { detail: "starting" });
    }
    if (failNext) { failNext = false; return response(507, { detail: "disk full" }); }
    if (url === "/api/state") return response(200, server);
    const parts = url.split("/").filter(Boolean);
    if (parts.length === 2 && options.method === "PUT") {
      const name = parts[1];
      server[name] = JSON.parse(options.body);
      return response(200, server[name]);
    }
    const collection = parts[1];
    const id = decodeURIComponent(parts[2]);
    if (options.method === "PUT") {
      const entry = JSON.parse(options.body);
      server[collection] = server[collection].filter(item => item.id !== id).concat([entry]);
      return response(200, entry);
    }
    if (options.method === "DELETE") {
      server[collection] = server[collection].filter(item => item.id !== id);
      return response(204, null);
    }
    return response(404, { detail: "not found" });
  };
  const sessionValues = new Map();
  const context = {
    console, fetch, structuredClone, TextEncoder, Blob,
    location: { protocol: "http:" }, confirm: () => confirm,
    localStorage: localStorageMock(local),
    sessionStorage: {
      getItem: key => sessionValues.get(key) || null,
      setItem: (key, value) => sessionValues.set(key, String(value)),
      removeItem: key => sessionValues.delete(key),
    },
    atob: value => Buffer.from(value, "base64").toString("binary"),
    PPTGen: {},
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ["core/constraints.generated.js", "core/security.js", "core/repo_store.js"]) {
    vm.runInContext(fs.readFileSync(path.join(WEB, file), "utf8"), context, { filename: file });
  }
  return { context, server, calls, sessionValues, fail: () => { failNext = true; } };
}

test("loads repository state and updates memory only after confirmed writes", async () => {
  const setup = makeHarness({ initialState: { layouts: [layout("existing")] } });
  await setup.context.PPTGen.repoReady;
  assert.deepEqual(Array.from(setup.context.PPTGen.repoStore.getAll("layouts"), item => item.id), ["existing"]);
  await setup.context.PPTGen.repoStore.put("layouts", layout("new"));
  assert.deepEqual(Array.from(setup.context.PPTGen.repoStore.getAll("layouts"), item => item.id).sort(), ["existing", "new"]);
  setup.fail();
  await assert.rejects(setup.context.PPTGen.repoStore.put("layouts", layout("broken")), /disk full/);
  assert.equal(setup.context.PPTGen.repoStore.get("layouts", "broken"), null);
});

test("file protocol remains read-only", async () => {
  const setup = makeHarness();
  setup.context.location.protocol = "file:";
  // Build a fresh context because initialization begins at script evaluation.
  const context = {
    console, location: { protocol: "file:" }, localStorage: localStorageMock(),
    sessionStorage: localStorageMock(), atob: setup.context.atob,
    TextEncoder, Blob, PPTGen: {},
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ["core/constraints.generated.js", "core/security.js", "core/repo_store.js"]) {
    vm.runInContext(fs.readFileSync(path.join(WEB, file), "utf8"), context, { filename: file });
  }
  await context.PPTGen.repoReady;
  assert.equal(context.PPTGen.repoStore.isReadOnly(), true);
  await assert.rejects(context.PPTGen.repoStore.put("layouts", layout("x")), /lecture seule/);
});

test("reloadState reconnects after an unavailable initial load", async () => {
  const setup = makeHarness({ failInitial: true, initialState: { layouts: [layout("after_retry")] } });
  await setup.context.PPTGen.repoReady;
  assert.equal(setup.context.PPTGen.repoStore.isAvailable(), false);
  assert.equal(await setup.context.PPTGen.repoStore.reloadState(), true);
  assert.equal(setup.context.PPTGen.repoStore.get("layouts", "after_retry").id, "after_retry");
});

test("migrates non-conflicting local data, keeps refused collisions, and moves keys to session", async () => {
  const setup = makeHarness({
    initialState: { layouts: [layout("same")] },
    confirm: false,
    local: {
      "pptgen.cl.same": JSON.stringify(layout("same")),
      "pptgen.cl.new_one": JSON.stringify(layout("new_one")),
      "pptgen.prefs": JSON.stringify({ baseUrl: "https://example.test/v1", model: "demo", apiKey: "secret", rememberKey: true }),
    },
  });
  const report = await setup.context.PPTGen.repoReady;
  assert.equal(report.imported, 2); // layout + settings
  assert.ok(setup.context.localStorage.getItem("pptgen.cl.same"));
  assert.equal(setup.context.localStorage.getItem("pptgen.cl.new_one"), null);
  assert.equal(setup.sessionValues.get("pptgen.apiKey"), "secret");
  assert.equal(setup.server.settings.apiKey, undefined);
  assert.equal(setup.server.settings.rememberKey, true);
});

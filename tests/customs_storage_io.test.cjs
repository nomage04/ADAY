const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const SCRIPTS = ["core/constraints.generated.js", "core/security.js", "core/download.js", "custom_icons.js", "custom_layouts.js", "customs_io.js"];
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzoAAAAASUVORK5CYII=";

function layout(id, extra = {}) {
  return {
    id, name: `Layout ${id}`, description: "Demo", category: "custom",
    imageDataUrl: PIXEL,
    zones: [{ id: "z0", label: "title", type: "title", x_pct: 10, y_pct: 10, w_pct: 80, h_pct: 20 }],
    ...extra,
  };
}

function icon(id) { return { id, name: `Icon ${id}`, dataUrl: PIXEL }; }

function localStorageMock(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump() { return Object.fromEntries(values); },
  };
}

class FakeZip {
  constructor() { this.files = {}; FakeZip.last = this; }
  file(name, content) {
    this.files[name] = { dir: false, async: async () => String(content) };
    return this;
  }
  async generateAsync() { return new Blob(["zip"]); }
  static async loadAsync(file) { return { files: file.entries || {} }; }
}

function zipFile(name, values) {
  const entries = {};
  for (const [entryName, value] of Object.entries(values)) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    entries[entryName] = { dir: false, name: entryName, async: async () => text };
  }
  return { name, size: 100, entries };
}

function harness({ local = {}, confirm = true, failAt = Infinity } = {}) {
  const data = { layouts: [], icons: [], photos: [], history: [] };
  const documents = { settings: {}, gallery: { disabledIcons: [], disabledLayouts: [] } };
  let writes = 0;
  const repoStore = {
    isAvailable: () => true,
    isReadOnly: () => false,
    getAll: collection => structuredClone(data[collection] || []),
    get: (collection, id) => structuredClone((data[collection] || []).find(entry => entry.id === id) || null),
    getDocument: name => structuredClone(documents[name] || {}),
    async put(collection, entry) {
      writes++;
      if (writes === failAt) throw new Error("disk full");
      data[collection] = (data[collection] || []).filter(item => item.id !== entry.id);
      data[collection].push(structuredClone(entry));
      return structuredClone(entry);
    },
    async remove(collection, id) {
      data[collection] = (data[collection] || []).filter(item => item.id !== id);
    },
    async putDocument(name, value) {
      writes++;
      if (writes === failAt) throw new Error("disk full");
      documents[name] = structuredClone(value);
      return structuredClone(value);
    },
  };
  const localStorage = localStorageMock(local);
  const sessionValues = new Map();
  const context = {
    console, Blob, TextEncoder, TextDecoder, structuredClone,
    setTimeout, clearTimeout,
    atob: value => Buffer.from(value, "base64").toString("binary"),
    localStorage,
    sessionStorage: {
      getItem: key => sessionValues.get(key) || null,
      setItem: (key, value) => sessionValues.set(key, String(value)),
      removeItem: key => sessionValues.delete(key),
    },
    location: { protocol: "http:" },
    document: {
      addEventListener() {}, getElementById() { return null; },
      createElement() { return { click() {}, remove() {} }; }, body: { appendChild() {} },
    },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    alert() {}, confirm: () => confirm,
    JSZip: FakeZip,
    performance: { now: () => 0 },
    PPTGen: { repoStore, repoReady: Promise.resolve(null) },
  };
  context.window = context;
  vm.createContext(context);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(WEB, file), "utf8"), context, { filename: file });
  context.PPTGen.download.saveBlob = (blob, filename) => { context.download = { blob, filename }; };
  return { context, data, documents, localStorage, sessionValues, repoStore };
}

test("repository-backed customs write and delete one JSON entity at a time", async () => {
  const { context, data } = harness();
  await context._putCustomLayout(layout("one"));
  await context._putCustomIcon(icon("star_custom"));
  assert.deepEqual(Array.from(context.getCustomLayouts(), item => item.id), ["one"]);
  assert.deepEqual(Array.from(context.getCustomIcons(), item => item.id), ["star_custom"]);
  await context._delCustomLayout("one");
  assert.equal(data.layouts.length, 0);
});

test("failed repository write never updates the runtime mirror", async () => {
  const { context, data } = harness({ failAt: 1 });
  await assert.rejects(context._putCustomLayout(layout("broken")), /disk full/);
  assert.equal(data.layouts.length, 0);
  assert.equal(context.getCustomLayouts().length, 0);
});

test("legacy customs import deduplicates and keeps the first entry", async () => {
  const { context, data } = harness();
  const result = await context.importCustomsBackup([
    { name: "one.json", size: 100, text: async () => JSON.stringify(layout("same", { name: "First" })) },
    { name: "two.json", size: 100, text: async () => JSON.stringify(layout("same", { name: "Second" })) },
  ]);
  assert.equal(result.imported, 1);
  assert.equal(result.ignored.length, 1);
  assert.equal(data.layouts[0].name, "First");
});

test("replacement confirmation can cancel every write", async () => {
  const setup = harness({ confirm: false });
  await setup.context._putCustomLayout(layout("same", { name: "Existing" }));
  const result = await setup.context.importCustomsBackup([
    { name: "same.json", size: 100, text: async () => JSON.stringify(layout("same", { name: "New" })) },
  ]);
  assert.equal(result.imported, 0);
  assert.equal(setup.data.layouts[0].name, "Existing");
});

test("partial repository failure keeps successful imports and reports the rest", async () => {
  const { context, data } = harness({ failAt: 2 });
  const result = await context.importCustomsBackup([
    { name: "one.json", size: 100, text: async () => JSON.stringify(layout("one")) },
    { name: "two.json", size: 100, text: async () => JSON.stringify(layout("two")) },
  ]);
  assert.equal(result.imported, 1);
  assert.deepEqual(data.layouts.map(entry => entry.id), ["one"]);
  assert.match(result.ignored.join(" "), /two/);
});

test("custom export contains manifest and flat repository paths", async () => {
  const { context } = harness();
  await context._putCustomLayout(layout("deck_layout"));
  await context._putCustomIcon(icon("deck_icon"));
  const result = await context.exportCustomsBackup();
  assert.equal(result.layouts, 1);
  assert.ok(FakeZip.last.files["_manifest.json"]);
  assert.ok(FakeZip.last.files["layouts/deck_layout.json"]);
  assert.ok(FakeZip.last.files["icons/deck_icon.json"]);
});

test("full backup mirrors repository paths and excludes the API key by default", async () => {
  const { context, repoStore, documents } = harness();
  await context._putCustomLayout(layout("full_layout"));
  await repoStore.put("photos", { id: "p1", name: "Photo", description: "", dataUrl: PIXEL, addedAt: "" });
  documents.settings = { baseUrl: "https://example.test/v1", model: "demo", rememberKey: false };
  await context.exportAppBackup();
  assert.ok(FakeZip.last.files["settings.json"]);
  assert.ok(FakeZip.last.files["gallery.json"]);
  assert.ok(FakeZip.last.files["photos/p1.json"]);
  const settings = JSON.parse(await FakeZip.last.files["settings.json"].async());
  const manifest = JSON.parse(await FakeZip.last.files["_manifest.json"].async());
  assert.equal(settings.apiKey, undefined);
  assert.equal(manifest.version, 4);
  assert.equal(manifest.limits.archiveBytes, 64 * 1024 * 1024);
});

test("full restore writes repository entities and keeps imported key in session only", async () => {
  const { context, data, documents, sessionValues } = harness();
  const backup = zipFile("backup.zip", {
    "settings.json": { baseUrl: "https://example.test/v1", model: "demo", rememberKey: true, apiKey: "secret" },
    "gallery.json": { disabledIcons: ["star"], disabledLayouts: [] },
    "layouts/restored.json": layout("restored"),
  });
  const result = await context.importAppBackup([backup]);
  assert.equal(result.imported, 3);
  assert.equal(data.layouts[0].id, "restored");
  assert.equal(documents.settings.apiKey, undefined);
  assert.equal(documents.settings.rememberKey, true);
  assert.equal(sessionValues.get("pptgen.apiKey"), "secret");
});

test("ZIP expanded and standalone JSON limits are enforced", async () => {
  const { context } = harness();
  const oversized = { name: "huge.json", size: 4 * 1024 * 1024 + 1, text: async () => "{}" };
  const result = await context.importCustomsBackup([oversized]);
  assert.equal(result.imported, 0);
  const hugeText = "x".repeat(4 * 1024 * 1024 + 1);
  const zipResult = await context.importCustomsBackup([zipFile("huge.zip", { "layouts/huge.json": hugeText })]);
  assert.equal(zipResult.imported, 0);
});

test("Gallery exposes only image and PPTX creation while restore lives in Settings", () => {
  const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
  assert.doesNotMatch(html, /id="btnImportCustoms"/);
  assert.match(html, /data-import="image"/);
  assert.match(html, /data-import="slide"/);
  assert.match(html, /id="btnImportBackup"[^>]*>Restore full backup</);
  assert.match(html, /core\/repo_store\.js/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzoAAAAASUVORK5CYII=";

function security() {
  const context = { window: { atob: value => Buffer.from(value, "base64").toString("binary") } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "core", "constraints.generated.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "core", "security.js"), "utf8"), context);
  return context.window.PPTGen.security;
}

test("accepts only bounded base64 image data URLs", () => {
  const api = security();
  assert.ok(api.imageDataUrlInfo(PIXEL));
  assert.equal(api.imageDataUrlInfo("data:image/png;base64,AA=="), null);
  assert.equal(api.imageDataUrlInfo('data:image/png;base64,AA==" onerror="alert(1)'), null);
  assert.equal(api.imageDataUrlInfo("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(api.imageDataUrlInfo("data:image/png;base64,abc"), null);
});

test("normalizes customs through an explicit allowlist", () => {
  const api = security();
  const icon = api.normalizeCustomIcon({
    id: "safe", name: "Safe", dataUrl: PIXEL,
    addedAt: "2026-06-19", onclick: "alert(1)",
  });
  assert.deepEqual(Object.keys(icon).sort(), ["addedAt", "dataUrl", "id", "name"]);

  const layout = api.normalizeCustomLayout({
    id: "layout", name: "Layout", category: "content",
    imageDataUrl: PIXEL,
    zones: [{ type: "title", label: "Title", x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 20 }],
    script: "alert(1)",
  });
  assert.ok(layout);
  assert.equal(layout.script, undefined);
  assert.equal(api.normalizeCustomLayout({ ...layout, thumbnailDataUrl: "javascript:alert(1)" }), null);

  const analyzed = api.normalizeCustomLayout({
    ...layout,
    analysis: { classificationStatus: "complete", descriptionStatus: "failed", updatedAt: "2026-06-20" },
  });
  assert.equal(analyzed.analysis.descriptionStatus, "failed");
  assert.equal(api.normalizeCustomLayout({ ...layout, category: "structural" }), null);
});

test("validates imported configuration and history metadata", () => {
  const api = security();
  const backup = api.normalizeConfigBackup({
    version: 1,
    prefs: { baseUrl: "https://example.test/v1", model: "test", extra: "drop" },
    gallery: { disabledIcons: ["chart", 'x\" onfocus="alert(1)'] },
    plansHistory: [{
      id: "entry-1",
      topic: "<img onerror=alert(1)>",
      plan: [{ layout: "title", breadcrumb: "Legacy footer" }],
    }],
  });
  assert.ok(backup);
  assert.deepEqual(Array.from(backup.gallery.disabledIcons), ["chart"]);
  assert.equal(backup.prefs.extra, undefined);
  assert.equal(backup.plansHistory[0].topic, "<img onerror=alert(1)>");
  assert.equal(backup.plansHistory[0].plan[0].breadcrumb, undefined);
});

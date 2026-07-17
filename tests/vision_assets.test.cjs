const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzoAAAAASUVORK5CYII=";

function vision(response) {
  const calls = [];
  const context = {
    console,
    llmJson: async (...args) => {
      calls.push(args);
      if (typeof response === "function") return response(...args);
      return { data: structuredClone(response) };
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "agents", "vision.js"), "utf8"), context);
  return { context, calls };
}

function customLayoutsContext() {
  const context = {
    console,
    Set,
    window: null,
    document: { addEventListener: () => {} },
  };
  context.window = context;
  context.PPTGen = {
    constraints: {
      categories: ["structural", "content", "smartart", "image", "custom"],
      structuralRoles: ["title", "closing"],
    },
    repoStore: {
      getAll: () => [],
      get: () => null,
      put: async entry => entry,
      remove: async () => {},
    },
    security: { normalizeCustomLayout: entry => entry },
    ui: {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "custom_layouts.js"), "utf8"), context);
  return context;
}

test("normalizes all supported layout categories and structural roles", () => {
  const { context } = vision({});
  for (const category of ["structural", "content", "smartart", "image", "custom"]) {
    const result = context.normalizeLayoutVisionResult({
      description: "Useful layout", suggested_category: category,
      suggested_structural_role: category === "structural" ? "closing" : "title",
      category_confidence: 0.8, category_rationale: "fixture",
    });
    assert.equal(result.suggested_category, category);
    assert.equal(result.suggested_structural_role, category === "structural" ? "closing" : null);
  }
  assert.equal(context.normalizeLayoutVisionResult({ suggested_category: "evil" }).suggested_category, "custom");
});

test("layout and icon vision prompts return planner descriptions", async () => {
  const layout = vision({
    description: "Use for a two-column comparison.", suggested_category: "content",
    suggested_structural_role: null, category_confidence: 0.9, category_rationale: "two columns",
  });
  const analyzed = await layout.context.analyzeLayoutThumbnail({ model: "vision" }, PIXEL);
  assert.equal(analyzed.suggested_category, "content");
  assert.match(analyzed.description, /comparison/);

  const icon = vision({ description: "Use for security and protection topics." });
  assert.match(await icon.context.describeIconThumbnail({ model: "vision" }, PIXEL), /security/);
});

test("vision retries without json mode only when response_format is rejected", async () => {
  let count = 0;
  const setup = vision(async () => {
    count++;
    if (count === 1) throw new Error("response_format json_object unsupported");
    return {
      data: {
        description: "Use for KPI summaries.",
        suggested_category: "content",
        suggested_structural_role: null,
        category_confidence: 0.8,
        category_rationale: "KPI",
      },
    };
  });
  const result = await setup.context.analyzeLayoutThumbnail({ model: "vision" }, PIXEL);
  assert.equal(result.suggested_category, "content");
  assert.equal(setup.calls.length, 2);
  assert.equal(setup.calls[0][3].useJsonMode, true);
  assert.equal(setup.calls[1][3].useJsonMode, false);
});

test("vision surfaces non-vision diagnostics instead of returning null", async () => {
  const setup = vision(async () => {
    throw new Error("No endpoints found that support image input");
  });
  try {
    await setup.context.describeLayoutThumbnail({ model: "text-only" }, PIXEL);
    assert.fail("expected describeLayoutThumbnail to reject");
  } catch (error) {
    assert.equal(error.llmDiagnostic.code, "non-vision");
  }
  assert.equal(setup.calls.length, 1);
});

test("import UI requires category review and exposes retry actions", () => {
  const html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
  const layouts = fs.readFileSync(path.join(ROOT, "web", "custom_layouts.js"), "utf8");
  const icons = fs.readFileSync(path.join(ROOT, "web", "custom_icons.js"), "utf8");
  assert.match(html, /id="customCategory"/);
  assert.match(html, /id="btnRetryLayoutVision"/);
  assert.match(html, /id="btnRetryIconVision"/);
  assert.match(layouts, /Confirm import/);
  assert.match(layouts, /data-slide-category/);
  assert.match(layouts, /errorMessage/);
  assert.match(layouts, /analysisFailure/);
  assert.match(icons, /descriptionStatus: canAnalyze \? "pending" : "failed"/);
  assert.match(icons, /iconAnalysisFailure/);
});

test("custom layout catalog shows exact zone keys instead of ambiguous shape", () => {
  const context = customLayoutsContext();
  const catalog = context._renderCustomCatalog([{
    id: "opaque",
    name: "Opaque import",
    category: "content",
    description: "Use for a title plus body.",
    background: {
      shapes: [
        { kind: "shape", x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100, fill: "102A43" },
        { kind: "text", x_pct: 10, y_pct: 5, w_pct: 50, h_pct: 6, text: "Demo", color: "F5C842", fontFace: "Cambria" },
      ],
    },
    zones: [
      { label: "text_17", type: "title", x_pct: 10, y_pct: 10, w_pct: 80, h_pct: 10, style: { color: "F5C842", fontFace: "Cambria" } },
      { label: "text_18", type: "text_block", x_pct: 10, y_pct: 25, w_pct: 80, h_pct: 30, style: { color: "C8D8F0", fontFace: "Calibri" } },
    ],
  }]);
  assert.match(catalog, /exact slide object/);
  assert.match(catalog, /"layout": "custom:opaque"/);
  assert.match(catalog, /"text_17": "text content"/);
  assert.match(catalog, /"text_18": "text content"/);
  assert.match(catalog, /Visual style: colors/);
  assert.match(catalog, /#F5C842/);
  assert.match(catalog, /font Cambria/);
  assert.match(catalog, /top-level field/);
  assert.doesNotMatch(catalog, /spec shape/);
});

test("pptx generic text shape names become descriptive unique zone labels", () => {
  const context = customLayoutsContext();
  const { zones } = context.classifySlideAsLayout([
    { kind: "text", name: "Text 17", text: "Quarterly review", x_pct: 10, y_pct: 10, w_pct: 70, h_pct: 12, fontSize: 3200, align: "left" },
    { kind: "text", name: "Text 18", text: "North America", x_pct: 10, y_pct: 28, w_pct: 70, h_pct: 10, fontSize: 2400, align: "left" },
    { kind: "text", name: "Text 19", text: "Revenue improved in enterprise accounts.", x_pct: 10, y_pct: 45, w_pct: 70, h_pct: 20, fontSize: 1600, align: "left" },
  ]);
  assert.equal(zones.length, 3);
  assert.deepEqual(new Set(zones.map(zone => zone.label)).size, zones.length);
  assert.ok(zones.every(zone => !/^text_\d+$/.test(zone.label)), zones.map(zone => zone.label).join(", "));
  assert.match(zones[0].label, /^title_/);
  assert.match(zones[1].label, /^subtitle_/);
});

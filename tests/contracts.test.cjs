const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function generatedPack() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "asset_pack.generated.js"), "utf8"), context);
  return context.window.PPT_ASSET_PACK;
}

function bootContracts() {
  const pack = generatedPack();
  const context = { console, Set, window: null };
  context.window = context;
  context.getAssetLayoutMeta = id => pack.layouts[id] || null;
  context.getCustomLayoutById = () => null;
  context.isStructuralRoleLayout = (layout, role) => layout === role;
  context.LayoutSelection = new Set(pack.layoutOrder);
  context.IconSelection = new Set(pack.iconOrder);
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "core", "contracts.js"), "utf8"), context);
  return { context, pack, contracts: context.PPTGen.contracts };
}

function validPlan() {
  return [
    { layout: "title", title: "Quarterly review", subtitle: "June" },
    { layout: "two_col", title: "Options", left_title: "A", left_bullets: ["One"], right_title: "B", right_bullets: ["Two"] },
    { layout: "quote", title: "Voice", quote: "Keep it simple" },
    { layout: "closing", title: "Thank you", message: "Questions" },
  ];
}

test("all bundled layouts expose structured strict schemas", () => {
  const { pack } = bootContracts();
  assert.equal(pack.layoutOrder.length, 20);
  for (const id of pack.layoutOrder) {
    const schema = pack.layouts[id].schema;
    assert.equal(typeof schema, "object", id);
    assert.equal(schema.additionalProperties, false, id);
    assert.ok(schema.properties && Array.isArray(schema.required), id);
    assert.equal(Object.hasOwn(schema.properties, "breadcrumb"), false, id);
    assert.equal(schema.required.includes("breadcrumb"), false, id);
  }
});

test("validates exact slide count and enabled layouts", () => {
  const { contracts, pack } = bootContracts();
  const plan = validPlan();
  assert.deepEqual(Array.from(contracts.collectPlanIssues(plan, { expectedSlideCount: 4 }).errors), []);
  assert.throws(() => contracts.validatePlan(plan, { expectedSlideCount: 5 }), /expected 5 slides/);
  const enabled = new Set(pack.layoutOrder.filter(id => id !== "quote"));
  assert.throws(() => contracts.validatePlan(plan, { enabledLayouts: enabled }), /disabled layout/);
});

test("catches impossible custom-only layout selections before planning", () => {
  const { context, contracts } = bootContracts();
  const customs = {
    cover: { id: "cover", category: "structural", structural_role: "title", zones: [], renderer: { type: "custom" } },
    end: { id: "end", category: "structural", structural_role: "closing", zones: [], renderer: { type: "custom" } },
    body: { id: "body", category: "content", zones: [], renderer: { type: "custom" } },
  };
  context.getCustomLayoutById = id => customs[id] || null;
  context.isStructuralRoleLayout = (layout, role) => {
    if (layout === role) return true;
    if (!layout.startsWith("custom:")) return false;
    const definition = customs[layout.slice("custom:".length)];
    return definition?.category === "structural" && definition.structural_role === role;
  };

  const issues = contracts.collectSelectionIssues({
    expectedSlideCount: 8,
    enabledLayouts: new Set(["custom:cover", "custom:end", "custom:body"]),
  });
  assert.match(issues.errors.join("\n"), /3 distinct content layouts required/);
  assert.equal(issues.contentLayoutCount, 1);
  assert.equal(issues.requiredContentLayouts, 3);
});

test("accepts feasible custom-only selections for requested slide count", () => {
  const { context, contracts } = bootContracts();
  const customs = {
    cover: { id: "cover", category: "structural", structural_role: "title", zones: [], renderer: { type: "custom" } },
    end: { id: "end", category: "structural", structural_role: "closing", zones: [], renderer: { type: "custom" } },
    body_a: { id: "body_a", category: "content", zones: [], renderer: { type: "custom" } },
    body_b: { id: "body_b", category: "content", zones: [], renderer: { type: "custom" } },
    body_c: { id: "body_c", category: "content", zones: [], renderer: { type: "custom" } },
  };
  context.getCustomLayoutById = id => customs[id] || null;
  context.isStructuralRoleLayout = (layout, role) => {
    if (layout === role) return true;
    if (!layout.startsWith("custom:")) return false;
    const definition = customs[layout.slice("custom:".length)];
    return definition?.category === "structural" && definition.structural_role === role;
  };

  const issues = contracts.collectSelectionIssues({
    expectedSlideCount: 8,
    enabledLayouts: new Set(["custom:cover", "custom:end", "custom:body_a", "custom:body_b", "custom:body_c"]),
  });
  assert.equal(issues.errors.length, 0);
  assert.equal(issues.contentLayoutCount, 3);
});

test("enforces layout schemas and required photo usage", () => {
  const { contracts } = bootContracts();
  const bad = validPlan();
  bad[1].unexpected = "not allowed";
  assert.throws(() => contracts.validatePlan(bad), /unknown field/);

  const photoPlan = validPlan();
  photoPlan[1] = { layout: "photo_hero", title: "Photo", image: "photo:p1" };
  assert.doesNotThrow(() => contracts.validatePlan(photoPlan, { requiredPhotoIds: ["p1"] }));
  assert.throws(() => contracts.validatePlan(photoPlan, { requiredPhotoIds: ["p2"] }), /required photo unused/);

  const legacyFooterPlan = validPlan();
  legacyFooterPlan[1].breadcrumb = "Legacy footer";
  assert.throws(() => contracts.validatePlan(legacyFooterPlan), /unknown field/);
});

test("accepts bounded speaker notes without relaxing slide schemas", () => {
  const { contracts } = bootContracts();
  const plan = validPlan();
  plan[1].speakerNotes = "Introduce the two options, then pause before comparing trade-offs.";
  assert.doesNotThrow(() => contracts.validatePlan(plan));

  const tooLong = validPlan();
  tooLong[1].speakerNotes = "x".repeat(1201);
  assert.throws(() => contracts.validatePlan(tooLong), /speakerNotes: text too long/);
});

test("validates unique layout mode before and after planning", () => {
  const { contracts, pack } = bootContracts();
  const contentLayouts = pack.layoutOrder.filter(id => !["title", "closing"].includes(id)).slice(0, 6);
  const issues = contracts.collectSelectionIssues({
    expectedSlideCount: 12,
    enabledLayouts: new Set(["title", "closing", ...contentLayouts]),
    uniqueLayoutsPerDeck: true,
  });
  assert.match(issues.errors.join("\n"), /unique layout mode/);

  const duplicated = [
    { layout: "title", title: "Quarterly review", subtitle: "June" },
    { layout: "two_col", title: "Options", left_title: "A", left_bullets: ["One"], right_title: "B", right_bullets: ["Two"] },
    { layout: "quote", title: "Voice", quote: "Keep it simple" },
    { layout: "two_col", title: "More options", left_title: "C", left_bullets: ["Three"], right_title: "D", right_bullets: ["Four"] },
    { layout: "closing", title: "Thank you", message: "Questions" },
  ];
  assert.throws(
    () => contracts.validatePlan(duplicated, { uniqueLayoutsPerDeck: true }),
    /layout_unique_repetition/,
  );
});

test("repairPlan returns a copy without mutating its input", () => {
  const { context, pack } = bootContracts();
  context.ALLOWED_LAYOUTS = pack.layoutOrder;
  context.ALLOWED_ICONS = new Set(pack.iconOrder);
  context.LAYOUT_REGISTRY = {};
  context.getAssetLayoutMeta = id => pack.layouts[id] || null;
  context.isAssetCustomLayout = () => false;
  context.isAssetStructuralLayout = id => ["title", "closing"].includes(id);
  context.isAssetStructuralRoleLayout = (id, role) => id === role;
  context.pickActiveStructuralAsset = role => pack.layouts[role];
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "builder", "build_deck.js"), "utf8"), context);
  const source = [
    { layout: "quote", title: "Start", breadcrumb: "Legacy one" },
    { layout: "quote", title: "End", breadcrumb: "Legacy two" },
  ];
  const before = JSON.stringify(source);
  const repaired = context.repairPlan(source);
  assert.equal(JSON.stringify(source), before);
  assert.notEqual(repaired, source);
  assert.equal(repaired[0].layout, "title");
  assert.equal(repaired[1].layout, "closing");
  assert.equal(repaired[0].breadcrumb, undefined);
  assert.equal(repaired[1].breadcrumb, undefined);
});

test("repairPlan maps semantic custom zones to exact repository keys", () => {
  const { context, pack } = bootContracts();
  const customs = {
    cover: {
      id: "cover",
      category: "structural",
      structural_role: "title",
      zones: [
        { label: "text_17", type: "title" },
        { label: "text_18", type: "subtitle" },
        { label: "text_19", type: "text_block" },
      ],
    },
    body: {
      id: "body",
      category: "content",
      zones: [
        { label: "text_5", type: "title" },
        { label: "text_6", type: "text_block" },
      ],
    },
    end: {
      id: "end",
      category: "structural",
      structural_role: "closing",
      zones: [
        { label: "text_27", type: "title" },
        { label: "text_28", type: "text_block" },
      ],
    },
  };
  context.ALLOWED_LAYOUTS = pack.layoutOrder;
  context.ALLOWED_ICONS = new Set(pack.iconOrder);
  context.LAYOUT_REGISTRY = {};
  context.getAssetLayoutMeta = id => pack.layouts[id] || null;
  context.getCustomLayoutById = id => customs[id] || null;
  context.pickActiveStructuralCustom = role => role === "title" ? customs.cover : customs.end;
  context.pickActiveStructuralAsset = () => null;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "builder", "build_deck.js"), "utf8"), context);

  const source = [
    { layout: "quote", title: "Deck", subtitle: "June" },
    { layout: "custom:body", title: "Overview", zones: { title: "Mapped title", message: "Mapped body" } },
    { layout: "quote", title: "Merci", message: "Questions" },
  ];
  const before = JSON.stringify(source);
  const repaired = context.repairPlan(source);

  assert.equal(JSON.stringify(source), before);
  assert.equal(repaired[0].layout, "custom:cover");
  assert.deepEqual(Object.keys(repaired[0].zones), ["text_17", "text_18", "text_19"]);
  assert.equal(repaired[0].zones.text_17, "Deck");
  assert.equal(repaired[0].zones.text_18, "June");
  assert.ok(!Object.hasOwn(repaired[0].zones, "title"));
  assert.equal(repaired[1].zones.text_5, "Mapped title");
  assert.equal(repaired[1].zones.text_6, "Mapped body");
  assert.ok(!Object.hasOwn(repaired[1].zones, "message"));
  assert.deepEqual(Object.keys(repaired[2].zones), ["text_27", "text_28"]);
  assert.equal(repaired[2].zones.text_27, "Merci");
  assert.equal(repaired[2].zones.text_28, "Questions");
});

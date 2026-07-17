const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function builder() {
  const context = { console, window: { PPTGen: { contracts: { validatePlan: value => value } } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "builder", "build_deck.js"), "utf8"), context);
  return context;
}

test("build errors keep their identity and receive rendering context", () => {
  const context = builder();
  const error = new Error("renderer failed");
  const tagged = context.tagStage(error, "slide", { slideIndex: 4, layout: "custom:test" });
  assert.equal(tagged, error);
  assert.equal(tagged.message, "renderer failed");
  assert.equal(tagged.stage, "slide");
  assert.equal(tagged.slideIndex, 4);
  assert.equal(tagged.layout, "custom:test");
});

test("build pipeline exposes validation, preload, renderer, slide and export stages", () => {
  const source = fs.readFileSync(path.join(ROOT, "web", "builder", "build_deck.js"), "utf8");
  for (const stage of ["validate", "preload", "renderer", "slide", "export"]) {
    assert.ok(source.includes(`"${stage}"`), `missing stage ${stage}`);
  }
});

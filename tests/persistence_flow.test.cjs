const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

test("plan display is committed to session before optional history persistence", () => {
  const source = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  const block = source.slice(source.indexOf("const display = deck.display"), source.indexOf("// ---- Step 3"));
  assert.ok(block.indexOf("showPlan(display") < block.indexOf("await addToHistory"));
  assert.match(block, /History not saved/);
});

test("settings are debounced and API keys persist only through local config opt-in", () => {
  const source = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(source, /setTimeout\(\(\) => savePrefs\(\).*500\)/s);
  assert.match(source, /sessionStorage\.setItem\("pptgen\.apiKey"/);
  assert.match(source, /baseUrl, model, visionModel, debugLogs, rememberKey/);
  assert.match(source, /window\.PPTGen\.localConfig\.save/);
  assert.match(source, /apiKey: rememberKey \? apiKey : ""/);
});

test("PPTX import restores its action button in a finally block", () => {
  const source = fs.readFileSync(path.join(ROOT, "web", "custom_layouts.js"), "utf8");
  const block = source.slice(source.indexOf("async function importSelectedSlidesBatch"), source.indexOf("// ---- Silent vision"));
  assert.match(block, /finally\s*\{/);
  assert.match(block, /button\.disabled = false/);
});

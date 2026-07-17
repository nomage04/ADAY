const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(ROOT, "web", name), "utf8");

test("planner resilience scripts are loaded before app orchestration", () => {
  const html = read("index.html");
  assert.ok(html.indexOf('core/llm_context.js') < html.indexOf('app.js'));
  assert.ok(html.indexOf('agents/context_compress.js') < html.indexOf('app.js'));
});

test("planner uses compression and resumable session drafts", () => {
  const app = read("app.js");
  assert.match(app, /GENERATION_DRAFT_KEY = "pptgen\.generationDraft"/);
  assert.match(app, /function preparePlannerPrompt/);
  assert.match(app, /context-compressor/);
  assert.match(app, /PPT_CONTEXT_COMPRESS_SYSTEM/);
  assert.match(app, /function updatePlannerDraftCheckpoint/);
  assert.match(app, /function buildPlannerResumePrompt/);
  assert.match(app, /function resumePlannerGeneration/);
  assert.match(app, /Resume generation/);
  assert.match(app, /hashGenerationInputs/);
  assert.doesNotMatch(app, /Start over/);
});

test("resume prompt tells the planner to reuse extracted slides", () => {
  const prompt = read("agents/deck_planner.js");
  assert.match(prompt, /PPT_DECK_PLANNER_RESUME_SYSTEM/);
  assert.match(prompt, /Reuse valid extracted slides/);
  assert.match(prompt, /Avoid duplicate slides/);
});

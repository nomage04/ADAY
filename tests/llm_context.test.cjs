const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function boot() {
  const context = { window: {} };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "core", "llm_context.js"), "utf8"), context);
  return context.PPTGen.llmContext;
}

test("assesses normal and oversized planner prompts", () => {
  const api = boot();
  const normal = api.assessPrompt({
    model: "unknown-small-model",
    systemPrompt: "system",
    userPrompt: JSON.stringify({ topic: "Demo", slide_count: 8 }),
  });
  assert.equal(normal.needsCompression, false);

  const oversized = api.assessPrompt({
    model: "unknown-small-model",
    systemPrompt: "system",
    userPrompt: "x".repeat(120000),
  });
  assert.equal(oversized.needsCompression, true);
  assert.ok(oversized.promptTokens > oversized.triggerTokens);
});
test("compressed planner input keeps exact brief constraints and catalogs", () => {
  const api = boot();
  const plannerInput = {
    topic: "Roadmap",
    slide_count: 8,
    include_speaker_notes: true,
    unique_layouts_per_deck: true,
    validated_brief: { goal: "convince execs" },
    brief_chat_history: [{ role: "user", content: "old" }, { role: "user", content: "latest" }],
    layouts_catalog: "# Layouts\nschema",
    icons_catalog: "# Icons",
    logos_catalog: "# Logos",
    user_content: "long notes",
  };
  const compressed = api.buildCompressedPlannerInput(plannerInput, {
    summary: "short",
    facts: ["fact"],
    constraints: ["must keep"],
    decisions: ["decision"],
    recent_messages: [{ role: "user", content: "latest" }],
  });

  assert.equal(compressed.topic, "Roadmap");
  assert.equal(compressed.slide_count, 8);
  assert.equal(compressed.include_speaker_notes, true);
  assert.equal(compressed.unique_layouts_per_deck, true);
  assert.deepEqual(compressed.validated_brief, { goal: "convince execs" });
  assert.equal(compressed.layouts_catalog, "# Layouts\nschema");
  assert.equal(compressed.icons_catalog, "# Icons");
  assert.equal(compressed.logos_catalog, "# Logos");
  assert.deepEqual(compressed.compressed_context.constraints, ["must keep"]);
  assert.deepEqual(compressed.brief_chat_history, [{ role: "user", content: "latest" }]);
  assert.equal(Object.hasOwn(compressed, "user_content"), false);
});

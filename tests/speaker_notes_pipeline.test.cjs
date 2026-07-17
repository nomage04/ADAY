const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

test("speaker notes agent and app pipeline expose the post-planner notes flow", () => {
  const notesPrompt = fs.readFileSync(path.join(ROOT, "web", "agents", "speaker_notes.js"), "utf8");
  assert.match(notesPrompt, /Return exactly one note per slide/);
  assert.match(notesPrompt, /Do not change, rewrite, add, remove, or reorder slides/);
  assert.match(notesPrompt, /maximum 1200 characters/);

  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(app, /function normalizeSpeakerNotesResult/);
  assert.match(app, /data\.notes\.length !== slideCount/);
  assert.match(app, /function mergeSpeakerNotes/);
  assert.match(app, /next\.speakerNotes = note/);
  assert.match(app, /runPhaseSpeakerNotes\(deck\.plan\)/s);
  assert.match(app, /logSpeakerNotesFailure/);
  assert.match(app, /renderSpeakerNotesReview/);
});

test("planner and context compression preserve generation option flags", () => {
  const plannerPrompt = fs.readFileSync(path.join(ROOT, "web", "agents", "deck_planner.js"), "utf8");
  assert.match(plannerPrompt, /unique_layouts_per_deck/);
  assert.match(plannerPrompt, /Do not emit \\`speakerNotes\\`/);
  assert.match(plannerPrompt, /do not reuse any layout id/);

  const context = { window: { PPTGen: {} }, globalThis: {} };
  context.globalThis = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "core", "llm_context.js"), "utf8"), context);
  const tools = context.window.PPTGen.llmContext;
  const plannerInput = {
    topic: "Demo",
    slide_count: 12,
    include_speaker_notes: true,
    unique_layouts_per_deck: true,
    layouts_catalog: "layouts",
    icons_catalog: "icons",
    logos_catalog: "logos",
  };
  const request = tools.buildCompressionRequest(plannerInput, { promptLimit: 32768 });
  assert.equal(request.preserve_exact.include_speaker_notes, true);
  assert.equal(request.preserve_exact.unique_layouts_per_deck, true);
  const compressed = tools.buildCompressedPlannerInput(plannerInput, { summary: "short" });
  assert.equal(compressed.include_speaker_notes, true);
  assert.equal(compressed.unique_layouts_per_deck, true);
});

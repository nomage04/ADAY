const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");

function read(name) {
  return fs.readFileSync(path.join(WEB, name), "utf8");
}

test("brief chat prompt exposes context status and interaction types", () => {
  const prompt = read("agents/brief_chat.js");
  const planner = read("agents/deck_planner.js");
  assert.match(prompt, /context_status/);
  assert.match(prompt, /context_confidence/);
  assert.match(prompt, /open_questions/);
  assert.match(prompt, /recommended_assumptions/);
  assert.match(prompt, /\\`tone\\`/);
  assert.match(prompt, /instruction/);
  assert.match(planner, /\\`tone\\`/);
  assert.match(planner, /tone\.instruction/);
  assert.match(prompt, /uncertain choices/);
  assert.match(prompt, /Do not restate the topic, the slide count/);
  assert.match(prompt, /Do not duplicate .*open_questions.*recommended_assumptions.*reply/);
  assert.match(prompt, /resolves all open questions/);
  assert.match(prompt, /ready to start/);
  assert.match(prompt, /I assume .*rather than/);
  for (const type of ["initial", "explain", "revise", "force_validate"]) {
    assert.match(prompt, new RegExp(type));
  }
});

test("brief cockpit contains conversation, context status and integrated internal work", () => {
  const html = read("index.html");
  const block = html.slice(
    html.indexOf('id="briefChatSection"'),
    html.indexOf('id="planSection"'),
  );
  assert.match(block, /id="briefContextBadge"/);
  assert.match(block, /id="briefCurrentCard"/);
  assert.match(block, /id="briefOpenQuestions"/);
  assert.match(block, /id="briefAssumptions"/);
  assert.match(block, /brief-context-sidebar/);
  assert.match(block, /id="briefChatMessages"/);
  assert.doesNotMatch(block, /id="logsCard"/);
  assert.doesNotMatch(block, /Thinking \/ internal activity/);
  assert.match(block, /brief-conversation-title/);
  assert.match(block, /id="btnBriefExplain"/);
  assert.match(block, /id="btnBriefExplain"[^>]+hidden/);
  assert.doesNotMatch(block, /id="btnBriefStop"/);
  assert.match(block, /id="btnBriefRegenerate"/);
  assert.match(block, /id="btnBriefChatSend"[^>]*>Send<\/button>/);
});

test("Studio brief captures a selected tone and sends it to both agents", () => {
  const html = read("index.html");
  const app = read("app.js");
  const form = html.slice(html.indexOf('id="studioInput"'), html.indexOf('id="externalPlan"'));
  assert.match(form, /id="tone"/);
  for (const tone of ["professional", "direct", "persuasive", "storytelling", "educational"]) {
    assert.match(form, new RegExp(`value="${tone}"`));
  }
  assert.match(app, /const TONE_GUIDES = \{/);
  assert.match(app, /document\.getElementById\("tone"\)\.value/);
  assert.match(app, /\["topic", "slideCount", "tone", "userContent"/);
  assert.match(app, /const \{ c, topic, slideCount, tone, userContent, photosBlock \}/);
  assert.match(app, /data\.brief\.tone = tone\.label/);
});

test("Studio flow switches between create cockpit and plan steps", () => {
  const html = read("index.html");
  const app = read("app.js");
  const css = read("style.css");
  assert.match(html, /data-studio-step="create"/);
  assert.match(html, /data-studio-step="cockpit"/);
  assert.match(html, /data-studio-step="plan"/);
  assert.match(html, /data-studio-step-panel="create"/);
  assert.match(html, /data-studio-step-panel="cockpit"/);
  assert.match(html, /data-studio-step-panel="plan"/);
  assert.match(app, /function initStudioFlow/);
  assert.match(app, /function activateStudioStep/);
  assert.match(app, /function setStudioStepAvailable/);
  assert.match(app, /function syncDeckPreviewVisibility/);
  assert.match(app, /panel\.classList\.toggle\("hidden", !visible\)/);
  assert.match(css, /#navStudio > #briefChatSection[\s\S]*grid-column: 1 \/ -1/);
  assert.match(app, /activateStudioStep\("cockpit"\)/);
  assert.match(app, /activateStudioStep\("plan"\)/);
  assert.match(app, /setStudioStepAvailable\("plan", true\)/);
});

test("internal work keeps a distinct visual identity inside the conversation", () => {
  const css = read("style.css");
  assert.match(css, /\.brief-work-item/);
  assert.match(css, /\.brief-work-group/);
  assert.match(css, /\.brief-work-summary/);
  assert.match(css, /\.brief-work-pre/);
  assert.match(css, /\.brief-work-background \.brief-work-pre/);
  assert.match(css, /\.brief-work-count/);
  assert.match(css, /\.brief-work-jump/);
  assert.match(css, /\.brief-clarification-prompt/);
  assert.match(css, /\.brief-clarification-label/);
  assert.match(css, /\.brief-work-body[\s\S]*scroll-behavior: smooth/);
  assert.match(css, /\.brief-work-item\.running/);
  assert.match(css, /\.brief-cockpit-grid[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(300px, 380px\)/);
  assert.match(css, /\.brief-chat-messages[\s\S]*width: 100%/);
  assert.match(css, /\.brief-chat-messages[\s\S]*max-height: min\(68vh, 640px\)/);
  assert.match(css, /\.brief-work-item:not\(\[open\]\) \.brief-work-body/);
  assert.match(css, /\.brief-work-body[\s\S]*max-height: min\(42vh, 340px\)/);
  assert.match(css, /\.brief-context-badge\.ready/);
  assert.match(css, /\.brief-context-badge\.clarify/);
  assert.match(css, /\.brief-context-badge\.risky/);
  assert.match(css, /\.brief-chat-msg\.progress/);
  assert.match(css, /\.brief-progress-stop/);
  assert.match(css, /\.studio-flow-nav/);
  assert.match(css, /\.studio-flow-arrow/);
  assert.match(css, /\.studio-flow-arrow::after/);
  assert.match(css, /\.brief-conversation-title/);
  assert.match(css, /\.brief-chat-actions/);
});

test("brief cockpit actions keep explain separate and support abort/regenerate", () => {
  const app = read("app.js");
  assert.match(app, /function normalizeBriefChatResult/);
  assert.match(app, /function normalizeBriefStatus/);
  assert.match(app, /function normalizeBriefConfidence/);
  assert.match(app, /function normalizeStringListFromFields/);
  assert.match(app, /function isUsefulRecommendedAssumption/);
  assert.match(app, /function inferAssumptionsFromBrief/);
  assert.match(app, /function inferQuestionsFromReply/);
  assert.match(app, /function inferAssumptionsFromReply/);
  assert.match(app, /data\.open_questions, data\.openQuestions, data\.questions/);
  assert.match(app, /data\.recommended_assumptions, data\.recommendedAssumptions, data\.assumptions/);
  assert.match(app, /firstDefined\(data\.context_status, data\.contextStatus\)/);
  assert.match(app, /firstDefined\(data\.context_confidence, data\.contextConfidence\)/);
  assert.match(app, /if \(!openQuestions\.length\) openQuestions = inferQuestionsFromReply\(reply\)/);
  assert.match(app, /deck\\s\+de\\s\+\\d\+\\s\+slides/);
  assert.match(app, /inferAssumptionsFromReply\(reply, brief, openQuestions\)/);
  assert.match(app, /organizing\/running the hackathon/);
  assert.match(app, /function ensureBriefReadyReply/);
  assert.match(app, /brief is understood and I am ready to start/);
  assert.match(app, /ensureBriefReadyReply\(data\.reply, data\)/);
  assert.match(app, /if \(completeness >= 4\) return "ready"/);
  assert.match(app, /interaction_type: interactionType/);
  assert.match(app, /interactionType !== "explain"/);
  assert.match(app, /function createBriefWorkItem/);
  assert.match(app, /function beginBriefWorkGroup/);
  assert.match(app, /function endBriefWorkGroup/);
  assert.match(app, /function getBriefWorkGroupUiState/);
  assert.match(app, /function setBriefClarificationPrompt/);
  assert.match(app, /function clearBriefClarificationPrompt/);
  assert.match(app, /function renderBriefClarificationPrompt/);
  assert.match(app, /function renderBriefWorkItem/);
  assert.match(app, /function renderBriefWorkGroup/);
  assert.match(app, /function groupBriefWorkItems/);
  assert.match(app, /function briefWorkUniqueActions/);
  assert.match(app, /normalizedLabel/);
  assert.match(app, /function briefWorkGroupOrder/);
  assert.match(app, /function briefWorkIsNearBottom/);
  assert.match(app, /function setBriefWorkJumpVisible/);
  assert.match(app, /function updateBriefWorkGroupDom/);
  assert.match(app, /function scrollBriefWorkToBottom/);
  assert.match(app, /activeWorkGroupId/);
  assert.match(app, /workGroupUiState/);
  assert.match(app, /_workGroupRefsById/);
  assert.match(app, /briefClarificationPrompt/);
  assert.match(app, /clarificationPrompt/);
  assert.match(app, /Recommended assumptions/);
  assert.match(app, /New activity - jump to bottom/);
  assert.match(app, /function briefWorkThinkingText/);
  assert.match(app, /function briefWorkBackgroundText/);
  assert.match(app, /function streamWorkTitle/);
  assert.match(app, /function briefWorkTitleFromLog/);
  assert.match(app, /function briefWorkDetailFromLog/);
  assert.match(app, /title: briefWorkTitleFromLog\(level, msg\)/);
  assert.match(app, /open: false/);
  assert.match(app, /workItem\.open = false/);
  assert.match(app, /workTitle: interactionType === "explain"/);
  assert.match(app, /workTitle: "Deck agent is constructing\.\.\."/);
  assert.match(app, /function stopActiveGeneration/);
  assert.match(app, /function appendActiveGenerationMessage/);
  assert.match(app, /activeGenerationText/);
  assert.match(app, /brief-progress-stop/);
  assert.match(app, /setActiveGeneration\(\s*abort,\s*"brief-chat"/);
  assert.match(app, /setActiveGeneration\(abort, "ppt-deck-planner", "Deck agent is constructing\.\.\."\)/);
  assert.doesNotMatch(app, /getElementById\("btnBriefStop"\)/);
  assert.match(app, /e\.key === "Enter" && !e\.shiftKey/);
  assert.match(app, /e\.preventDefault\(\)/);
  assert.match(app, /send\.textContent = generationStarted \? "Apply note" : "Send"/);
  assert.match(app, /explain\.classList\.toggle\("hidden", !generationStarted\)/);
  assert.match(app, /Ignore clarifications and start generation/);
  assert.match(app, /Ignore question and start generation/);
  assert.match(app, /briefChatState\.contextStatus !== "ready"/);
  assert.match(app, /confirm\(/);
});

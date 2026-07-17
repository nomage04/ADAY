(function initLlmContext(global) {
  "use strict";

  const PPTGen = global.PPTGen = global.PPTGen || {};

  const DEFAULT_CONTEXT_WINDOW = 32768;
  const DEFAULT_RESPONSE_RESERVE = 8192;
  const COMPRESSION_TRIGGER_RATIO = 0.9;

  const MODEL_PRESETS = [
    { pattern: /gpt-4o|gpt-4\.1|gpt-5|o3|o4/i, window: 128000 },
    { pattern: /gpt-oss|llama-3\.3|claude|gemini|deepseek/i, window: 128000 },
    { pattern: /llama-3\.1|qwen2\.5|mistral|mixtral/i, window: 32768 },
  ];

  function asText(value) {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); }
    catch { return String(value || ""); }
  }

  function estimateTokens(value) {
    const text = asText(value);
    if (!text) return 0;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return Math.ceil(Math.max(text.length / 3.6, words * 1.25));
  }

  function modelContextWindow(model) {
    const name = String(model || "");
    const found = MODEL_PRESETS.find(item => item.pattern.test(name));
    return found ? found.window : DEFAULT_CONTEXT_WINDOW;
  }

  function promptBudget(model, responseReserve = DEFAULT_RESPONSE_RESERVE) {
    const contextWindow = modelContextWindow(model);
    const reserve = Math.min(responseReserve, Math.floor(contextWindow * 0.35));
    const promptLimit = Math.max(4096, contextWindow - reserve);
    return { contextWindow, responseReserve: reserve, promptLimit };
  }

  function assessPrompt({ model, systemPrompt = "", userPrompt = "", responseReserve } = {}) {
    const budget = promptBudget(model, responseReserve);
    const systemTokens = estimateTokens(systemPrompt);
    const userTokens = estimateTokens(userPrompt);
    const promptTokens = systemTokens + userTokens;
    return {
      ...budget,
      systemTokens,
      userTokens,
      promptTokens,
      triggerTokens: Math.floor(budget.promptLimit * COMPRESSION_TRIGGER_RATIO),
      needsCompression: promptTokens > Math.floor(budget.promptLimit * COMPRESSION_TRIGGER_RATIO),
    };
  }

  function lastItems(list, count) {
    return Array.isArray(list) ? list.slice(Math.max(0, list.length - count)) : [];
  }

  function buildCompressionRequest(plannerInput, assessment) {
    const briefHistory = plannerInput?.brief_chat_history || [];
    const recentMessages = lastItems(briefHistory, 4);
    const olderMessages = briefHistory.slice(0, Math.max(0, briefHistory.length - recentMessages.length));
    return {
      target_agent: "ppt-deck-planner",
      target_prompt_tokens: Math.max(4096, Math.floor((assessment?.promptLimit || 32768) * 0.65)),
      preserve_exact: {
        topic: plannerInput?.topic || "",
        slide_count: plannerInput?.slide_count,
        include_speaker_notes: plannerInput?.include_speaker_notes === true,
        unique_layouts_per_deck: plannerInput?.unique_layouts_per_deck === true,
        validated_brief: plannerInput?.validated_brief || null,
        user_feedback_on_previous_attempt: plannerInput?.user_feedback_on_previous_attempt || "",
        recent_brief_chat_history: recentMessages,
        layouts_catalog: plannerInput?.layouts_catalog || "",
        icons_catalog: plannerInput?.icons_catalog || "",
        logos_catalog: plannerInput?.logos_catalog || "",
      },
      compress: {
        user_content: plannerInput?.user_content || "",
        older_brief_chat_history: olderMessages,
        user_photos: plannerInput?.user_photos || null,
      },
    };
  }

  function normalizeStringList(value, max = 24) {
    if (!Array.isArray(value)) return [];
    return value.map(item => String(item || "").trim()).filter(Boolean).slice(0, max);
  }

  function normalizeCompressedContext(value) {
    const data = value && typeof value === "object" ? value : {};
    return {
      summary: String(data.summary || data.user_content_summary || "").trim(),
      facts: normalizeStringList(data.facts),
      constraints: normalizeStringList(data.constraints),
      decisions: normalizeStringList(data.decisions),
      omissions: normalizeStringList(data.omissions, 12),
      recent_messages: Array.isArray(data.recent_messages) ? data.recent_messages.slice(-6) : [],
      user_photos: data.user_photos && typeof data.user_photos === "object" ? data.user_photos : null,
    };
  }

  function buildCompressedPlannerInput(plannerInput, compressedValue) {
    const compressed = normalizeCompressedContext(compressedValue);
    const out = {
      topic: plannerInput.topic,
      slide_count: plannerInput.slide_count,
      include_speaker_notes: plannerInput.include_speaker_notes === true,
      unique_layouts_per_deck: plannerInput.unique_layouts_per_deck === true,
      compressed_context: {
        summary: compressed.summary,
        facts: compressed.facts,
        constraints: compressed.constraints,
        decisions: compressed.decisions,
        omissions: compressed.omissions,
      },
      ...(plannerInput.validated_brief ? { validated_brief: plannerInput.validated_brief } : {}),
      ...(compressed.recent_messages.length ? { brief_chat_history: compressed.recent_messages } : {}),
      layouts_catalog: plannerInput.layouts_catalog,
      icons_catalog: plannerInput.icons_catalog,
      logos_catalog: plannerInput.logos_catalog,
      ...(plannerInput.user_feedback_on_previous_attempt ? {
        user_feedback_on_previous_attempt: plannerInput.user_feedback_on_previous_attempt,
      } : {}),
      ...(compressed.user_photos || plannerInput.user_photos ? {
        user_photos: compressed.user_photos || plannerInput.user_photos,
      } : {}),
    };
    return out;
  }

  PPTGen.llmContext = {
    estimateTokens,
    modelContextWindow,
    promptBudget,
    assessPrompt,
    buildCompressionRequest,
    buildCompressedPlannerInput,
    normalizeCompressedContext,
  };
})(typeof window !== "undefined" ? window : globalThis);

// System prompt for the vision agent.
// Given a slide template image, it returns JSON zones where content
// should be placed (title, bullets, KPIs, etc.), with bounding boxes
// expressed in percentages of the image dimensions.

const PPT_VISION_SYSTEM = `You are a slide-layout analyst. You receive ONE image that is a
design template for a presentation slide (mockup, photo, diagram…).
Your job is to identify the regions where a downstream system will
place text content, and return their bounding boxes.

## Output

Return a JSON object with this shape:

\`\`\`json
{
  "suggested_name": "short 2-4 word name for this layout",
  "suggested_description": "one sentence describing when to pick this layout (≤ 120 chars)",
  "suggested_category": "structural" | "content" | "smartart" | "image" | "custom",
  "suggested_structural_role": "title" | "closing" | null,
  "category_confidence": 0.0,
  "category_rationale": "short reason for the category (≤ 120 chars)",
  "zones": [
    {
      "type":  "title" | "subtitle" | "bullets" | "text_block" | "kpi" | "image",
      "label": "short human label like 'main title' or 'product photo'",
      "x_pct": 0..100,
      "y_pct": 0..100,
      "w_pct": 0..100,
      "h_pct": 0..100,
      "align": "left" | "center" | "right",
      "color": "light" | "dark",
      "rationale": "why you chose this region (≤ 80 chars)"
    }
  ]
}
\`\`\`

## Rules

- **Coordinates are PERCENTAGES of the image**, with (0,0) at the
  top-left corner. x_pct + w_pct ≤ 100, y_pct + h_pct ≤ 100.
- **Identify 2 to 6 zones max.** A slide with 12 zones is a slide
  that can't be used — keep it focused.
- **type guidance:**
  - \`title\`     — the most visually dominant text region (big font, top or center)
  - \`subtitle\`  — secondary text under/next to the title
  - \`bullets\`   — a list-shaped region (tall, narrow-ish, can host 3..6 items)
  - \`text_block\` — a generic paragraph area
  - \`kpi\`       — a small region meant for a single big number + label
  - \`image\`     — a rectangular placeholder meant to host a photo or
                   screenshot. Identify image zones when the template
                   shows: a framed/bordered rectangle, a large empty
                   grey area, a crossed-out placeholder ("[ photo ]",
                   diagonals, camera icon…), or any region whose shape
                   and position clearly says "put a visual here".
                   Do NOT declare the whole slide background as an
                   image zone — it isn't one.
- **color** is the text color the downstream should use given the
  background at that region: \`light\` (white/pale) if background is dark,
  \`dark\` (near-black) if background is light.
- **align** is the text alignment that matches the visual intent.
- **Prefer empty/calm areas** of the image — don't put a zone where
  there's already busy visual content unless that's clearly a
  placeholder frame.
- **suggested_name** is what the user will see in the Gallery. Keep it
  punchy (e.g. "Photo + headline", "KPI on top right", "Split with
  quote").
- **suggested_description** explains when a content writer should pick
  this layout — what kind of content it's good for. Don't describe the
  image itself, describe the USE CASE.
- **suggested_category** uses exactly one value: \`structural\` only for a
  first-slide cover or final closing slide; \`content\` for text, KPI,
  table, chart or columns; \`smartart\` for a process, matrix, pyramid,
  timeline or diagram; \`image\` when a visual dominates the structure;
  \`custom\` only when none fits clearly.
- **suggested_structural_role** is \`title\` or \`closing\` only when the
  category is \`structural\`, otherwise it MUST be null.
- **category_confidence** is a number from 0 to 1. The user will review
  the suggestion before it is saved.

## Output format

Return a single JSON object. No prose wrapper, no markdown fences.`;


function visionErrorDiagnostic(error) {
  if (typeof classifyLlmError === "function") return classifyLlmError(error, { vision: true });
  const text = String(error?.message || error || "");
  if (/response_format|json_object/i.test(text)) {
    return { code: "json-mode", message: "Le provider refuse response_format=json_object pour ce modele.", detail: text.slice(0, 500) };
  }
  if (/image input|image_url|vision|multimodal/i.test(text)) {
    return { code: "non-vision", message: "Le modele configure ne semble pas supporter les images.", detail: text.slice(0, 500) };
  }
  if (/timeout/i.test(text)) return { code: "timeout", message: "Timeout : le provider n'a pas repondu a temps.", detail: text.slice(0, 500) };
  return { code: "unknown", message: text || "Erreur Vision non classifiee.", detail: text.slice(0, 500) };
}

function attachVisionDiagnostic(error) {
  const diagnostic = visionErrorDiagnostic(error);
  error.llmDiagnostic = diagnostic;
  if (!error.code) error.code = diagnostic.code;
  return error;
}

function shouldRetryVisionWithoutJson(error) {
  return visionErrorDiagnostic(error).code === "json-mode";
}

/**
 * Call the vision agent against a data URL image.
 * @param {Object} cfg           - {baseUrl, apiKey, visionModel}
 * @param {string} imageDataUrl  - "data:image/png;base64,..."
 * @param {Function} [onLog]     - optional logger (level, msg, detail?)
 * @returns {Promise<Object>}    - parsed classification, description and zones
 */
async function callVisionAgent(cfg, imageDataUrl, onLog) {
  const emit = (level, msg, detail) => { if (onLog) onLog(level, msg, detail); };

  emit("step", "Vision : downscale de l'image si nécessaire");
  const resized = await downscaleImage(imageDataUrl, 1024);
  emit("info",
    `Image prête : ~${Math.round(resized.length * 0.75 / 1024)} KB base64 ` +
    `(${resized.length} chars data URL)`);

  const userContent = [
    { type: "text", text: "Analyse this slide-layout image and return the zones JSON as specified." },
    { type: "image_url", image_url: { url: resized } },
  ];

  const model = cfg.visionModel || cfg.model;
  emit("step", `Vision : appel LLM (${model}) — response_format=json, stream=false`);

  // First try WITH json_object mode. If the model rejects it we retry without.
  const baseOpts = {
    model, temperature: 0.2, stream: false,
    reasoningFormat: null,   // vision models rarely support it
  };

  try {
    const result = await llmJson(cfg, PPT_VISION_SYSTEM, userContent,
      { ...baseOpts, useJsonMode: true });
    emit("ok", `Vision : réponse reçue (JSON mode)`, result.data);
    return result.data;
  } catch (eJson) {
    if (!shouldRetryVisionWithoutJson(eJson)) throw attachVisionDiagnostic(eJson);
    emit("warn", `Vision : json_object rejeté (${eJson.message.slice(0, 120)}) — retry en texte libre`);
    const result = await llmJson(cfg, PPT_VISION_SYSTEM, userContent,
      { ...baseOpts, useJsonMode: false });
    emit("ok", `Vision : réponse reçue (plain text mode)`, result.data);
    return result.data;
  }
}

// --------------------------------------------------------------------------
// Layout auto-describe — for silent enrichment of imported slides.
// Focuses on VISUAL STRUCTURE, not slide content, so the downstream
// layout agent can match data shapes to layouts reliably.
// --------------------------------------------------------------------------

const PPT_LAYOUT_DESCRIBE_SYSTEM = `You classify and describe ONE slide layout for a deck-building agent. Ignore the specific content words and focus on visual structure.

Return JSON: {
  "description": "one concise sentence (≤ 28 words) explaining WHEN to use it",
  "suggested_category": "structural" | "content" | "smartart" | "image" | "custom",
  "suggested_structural_role": "title" | "closing" | null,
  "category_confidence": 0.0,
  "category_rationale": "short reason (≤ 120 chars)"
}.

Use structural only for a cover or closing slide; content for text/KPI/table/chart/columns; smartart for processes/matrices/pyramids/timelines/diagrams; image when a visual dominates; custom only if none fits.`;

function normalizeLayoutVisionResult(data) {
  if (!data || typeof data !== "object") return null;
  const categories = ["structural", "content", "smartart", "image", "custom"];
  const category = categories.includes(data.suggested_category) ? data.suggested_category : "custom";
  const role = category === "structural" && ["title", "closing"].includes(data.suggested_structural_role)
    ? data.suggested_structural_role : null;
  return {
    description: typeof data.description === "string" ? data.description.trim().slice(0, 1000) : null,
    suggested_category: category,
    suggested_structural_role: role,
    category_confidence: Math.max(0, Math.min(1, Number(data.category_confidence) || 0)),
    category_rationale: typeof data.category_rationale === "string"
      ? data.category_rationale.trim().slice(0, 200) : "",
  };
}

async function analyzeLayoutThumbnail(cfg, imageDataUrl) {
  const userContent = [
    { type: "text", text: "Classify this slide layout and describe when a deck planner should use it." },
    { type: "image_url", image_url: { url: imageDataUrl } },
  ];
  const baseOpts = {
    model: cfg.visionModel || cfg.model,
    temperature: 0.2, stream: false, reasoningFormat: null, timeoutMs: 60_000,
  };
  try {
    const res = await llmJson(cfg, PPT_LAYOUT_DESCRIBE_SYSTEM, userContent,
      { ...baseOpts, useJsonMode: true });
    return normalizeLayoutVisionResult(res.data);
  } catch (error) {
    if (!shouldRetryVisionWithoutJson(error)) throw attachVisionDiagnostic(error);
    const res = await llmJson(cfg, PPT_LAYOUT_DESCRIBE_SYSTEM, userContent,
      { ...baseOpts, useJsonMode: false });
    return normalizeLayoutVisionResult(res.data);
  }
}

async function describeLayoutThumbnail(cfg, imageDataUrl) {
  return (await analyzeLayoutThumbnail(cfg, imageDataUrl))?.description || null;
}

const PPT_ICON_DESCRIBE_SYSTEM = `You describe ONE presentation icon for a deck-building agent. Explain the concept it represents and when to use it. Do not focus on colors, file format or drawing style. Return JSON: { "description": "concise sentence, ≤ 22 words" }.`;

async function describeIconThumbnail(cfg, imageDataUrl) {
  const content = [
    { type: "text", text: "Describe the semantic meaning and useful presentation contexts for this icon." },
    { type: "image_url", image_url: { url: imageDataUrl } },
  ];
  const opts = { model: cfg.visionModel || cfg.model, temperature: 0.2, stream: false, reasoningFormat: null, timeoutMs: 60_000 };
  try {
    const result = await llmJson(cfg, PPT_ICON_DESCRIBE_SYSTEM, content, { ...opts, useJsonMode: true });
    return typeof result.data?.description === "string" ? result.data.description.trim().slice(0, 1000) : null;
  } catch (error) {
    if (!shouldRetryVisionWithoutJson(error)) throw attachVisionDiagnostic(error);
    const result = await llmJson(cfg, PPT_ICON_DESCRIBE_SYSTEM, content, { ...opts, useJsonMode: false });
    return typeof result.data?.description === "string" ? result.data.description.trim().slice(0, 1000) : null;
  }
}

/**
 * Shrink an image (data URL) so its longest side ≤ maxSide pixels.
 * Drawn via an offscreen canvas that honours file:// origin.
 */
async function downscaleImage(dataUrl, maxSide = 1024, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      // If the source is already small enough AND the caller wants the
      // default quality, we can return it as-is. When the caller asked
      // for a lower quality, we must still re-encode to shrink the bytes.
      if (ratio >= 1 && quality >= 0.88) return resolve(dataUrl);
      const w = Math.round(img.naturalWidth * ratio);
      const h = Math.round(img.naturalHeight * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL("image/jpeg", quality)); }
      catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("Image load failed for downscale"));
    img.src = dataUrl;
  });
}

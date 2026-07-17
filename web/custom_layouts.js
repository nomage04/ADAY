// custom_layouts.js — full pipeline for user-uploaded layout templates.
//
// 1) User uploads an image via the modal
// 2) We call the vision LLM, which returns zones + suggested name/desc
// 3) User reviews (delete / rename / retype zones), names the layout
// 4) The local server persists one JSON file per layout in customs/layouts/.
// 5) Custom layouts flow into ALLOWED_LAYOUTS + LayoutSelection + the
//    gallery + the catalog shown to ppt-deck-planner.
//
// Each layout is referenced as `custom:<id>` in a slide_spec; the
// `_custom` renderer (builder/layouts/_custom.js) handles the draw.

let pendingImage   = null;   // data URL of the file just uploaded
let pendingImageName = "Custom layout";
let pendingZones   = [];     // zones returned by vision agent (editable)
let pendingVision  = null;   // {suggested_name, suggested_description}
let _customLayoutsCache = null;

// Categories used for grouping in the gallery. `structural` requires a
// `structural_role` ("title" | "closing") so the layout knows which slot
// it can fill. Old entries without a `category` field are treated as
  // `"custom"` (backward compatibility).
const CUSTOM_CATEGORIES = window.PPTGen.constraints.categories;
const STRUCTURAL_ROLES = window.PPTGen.constraints.structuralRoles;

// ---- persistence (repository JSON files + runtime memory mirror) -------
function getCustomLayouts() {
  if (_customLayoutsCache) return _customLayoutsCache.slice();
  const out = window.PPTGen.repoStore.getAll("layouts");
  out.sort((a, b) => String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)));
  _customLayoutsCache = out;
  return out.slice();
}

function getCustomLayoutById(id) {
  if (!id) return null;
  const entry = window.PPTGen.repoStore.get("layouts", id);
  if (entry) return entry;
  // Fall back to a custom layout declared in the asset pack.
  if (typeof getAssetLayoutMeta === "function") {
    const packed = getAssetLayoutMeta(id);
    if (packed?.renderer?.type === "custom") return packed;
  }
  return null;
}

async function _putCustomLayout(entry) {
  if (!entry || !entry.id) throw new Error("custom layout without id");
  const normalized = window.PPTGen?.security?.normalizeCustomLayout(entry);
  if (!normalized) throw new Error("invalid custom layout");
  await window.PPTGen.repoStore.put("layouts", normalized);
  _customLayoutsCache = null;
  return normalized;
}

async function _delCustomLayout(id) {
  await window.PPTGen.repoStore.remove("layouts", id);
  _customLayoutsCache = null;
}

async function _clearCustomLayouts() {
  for (const entry of getCustomLayouts()) await _delCustomLayout(entry.id);
  _customLayoutsCache = null;
}

function getCustomCategory(entry) {
  return (entry && CUSTOM_CATEGORIES.includes(entry.category))
    ? entry.category : "custom";
}

function layoutDescriptionFallback(entry) {
  const category = getCustomCategory(entry);
  const zoneTypes = [...new Set((entry?.zones || []).map(zone => zone.type))];
  return `Layout ${category}${zoneTypes.length ? ` with zones ${zoneTypes.join(", ")}` : ""}.`;
}

function _customStyleHex(value) {
  const hex = String(value || "").trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : "";
}

function _customStyleAdd(map, key, weight = 1) {
  const value = String(key || "").trim();
  if (!value) return;
  map.set(value, (map.get(value) || 0) + Math.max(0.1, weight));
}

function _customStyleRank(map) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

function _customLayoutStyleSummary(entry) {
  if (typeof describeCustomLayoutVisualStyle === "function") {
    const style = describeCustomLayoutVisualStyle(entry);
    const colors = (style.colors || []).slice(0, 4).map(color => "#" + color).join(", ");
    return `Visual style: colors ${colors || "#" + style.accent}; font ${style.fontFace || "Calibri"}.`;
  }

  const colors = new Map();
  const fonts = new Map();
  for (const shape of entry?.background?.shapes || []) {
    const area = Math.max(1, (Number(shape.w_pct) || 0) * (Number(shape.h_pct) || 0));
    const fill = _customStyleHex(shape.fill);
    const color = _customStyleHex(shape.color);
    if (fill) _customStyleAdd(colors, fill, Math.min(5, area / 150));
    if (color) _customStyleAdd(colors, color, shape.kind === "text" ? 1.2 : 0.5);
    if (shape.fontFace) _customStyleAdd(fonts, shape.fontFace, shape.kind === "text" ? 1.5 : 0.5);
  }
  for (const zone of entry?.zones || []) {
    const style = zone.style || {};
    const color = _customStyleHex(style.color);
    const weight = zone.type === "title" || zone.type === "kpi" ? 2 : 1;
    if (color) _customStyleAdd(colors, color, weight);
    if (style.fontFace) _customStyleAdd(fonts, style.fontFace, weight);
  }
  const colorText = _customStyleRank(colors).slice(0, 4).map(color => "#" + color).join(", ");
  const fontText = _customStyleRank(fonts)[0] || "Calibri";
  return `Visual style: colors ${colorText || "#00915A"}; font ${fontText}.`;
}

function llmDiagnostic(error, { vision = true } = {}) {
  if (error?.llmDiagnostic) return error.llmDiagnostic;
  if (typeof classifyLlmError === "function") return classifyLlmError(error, { vision });
  if (typeof visionErrorDiagnostic === "function") return visionErrorDiagnostic(error);
  const message = String(error?.message || error || "Unknown Vision error");
  return { code: "unknown", message, detail: message.slice(0, 500) };
}

function analysisFailure(error, base = {}) {
  const diagnostic = llmDiagnostic(error, { vision: true });
  return {
    ...base,
    errorCode: diagnostic.code || "unknown",
    errorMessage: (diagnostic.message || diagnostic.detail || String(error?.message || error || "Unknown Vision error")).slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
}

function clearAnalysisError(analysis = {}) {
  const next = { ...analysis };
  delete next.errorCode;
  delete next.errorMessage;
  return next;
}

function diagnosticText(error) {
  const diagnostic = llmDiagnostic(error, { vision: true });
  return diagnostic.message + (diagnostic.detail ? " " + diagnostic.detail : "");
}

async function updateCustomLayoutMeta(id, { name, description, category, structural_role }) {
  const entry = getCustomLayoutById(id);
  if (!entry) return null;
  const next = { ...entry };
  if (typeof name === "string" && name.trim()) next.name = name.trim();
  if (typeof description === "string" && description.trim()) {
    next.description = description.trim();
    next.analysis = { ...(next.analysis || {}), descriptionStatus: "manual", updatedAt: new Date().toISOString() };
  }
  if (CUSTOM_CATEGORIES.includes(category)) next.category = category;
  if (next.category === "structural") {
    next.structural_role = STRUCTURAL_ROLES.includes(structural_role)
      ? structural_role : "title";
  } else {
    delete next.structural_role;
  }
  next.analysis = { ...(next.analysis || {}), classificationStatus: "manual", updatedAt: new Date().toISOString() };
  await _putCustomLayout(next);
  return next;
}

// Resolve which custom layout (if any) should play a given structural
// role. Used by repairPlan/validatePlan to substitute the built-in
// title/closing slots. Filters by gallery-active state and picks the
// oldest createdAt for determinism when multiple candidates exist.
function pickActiveStructuralCustom(role) {
  if (!STRUCTURAL_ROLES.includes(role)) return null;
  const candidates = getCustomLayouts().filter(c =>
    c.category === "structural" && c.structural_role === role
  );
  if (!candidates.length) return null;
  const active = candidates.filter(c => {
    if (typeof LayoutSelection === "undefined") return true;
    return LayoutSelection.has("custom:" + c.id);
  });
  const pool = active.length ? active : [];
  if (!pool.length) return null;
  pool.sort((a, b) =>
    String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return pool[0];
}

function isStructuralCustomLayout(layoutKey) {
  if (typeof layoutKey !== "string" || !layoutKey.startsWith("custom:")) return false;
  const entry = getCustomLayoutById(layoutKey.slice("custom:".length));
  return !!(entry && entry.category === "structural");
}

function isStructuralRoleCustomLayout(layoutKey, role) {
  if (typeof layoutKey !== "string" || !layoutKey.startsWith("custom:")) return false;
  const entry = getCustomLayoutById(layoutKey.slice("custom:".length));
  return !!(entry && entry.category === "structural" && entry.structural_role === role);
}

window.pickActiveStructuralCustom    = pickActiveStructuralCustom;
window.isStructuralCustomLayout      = isStructuralCustomLayout;
window.isStructuralRoleCustomLayout  = isStructuralRoleCustomLayout;
window.getCustomCategory             = getCustomCategory;

// ---- catalog integration -----------------------------------------------
// Called by catalogs.js and gallery.js to surface customs alongside the
// built-in layouts. We prefix their id with `custom:` so the main agent
// can distinguish them.
function getCustomLayoutIds() {
  return getCustomLayouts().map(c => "custom:" + c.id);
}

function buildCustomCatalogSection() {
  return _renderCustomCatalog(getCustomLayouts());
}

function _customZoneExampleValue(zone) {
  if (zone.type === "bullets") return ["item 1", "item 2"];
  if (zone.type === "kpi") return "42%\nKey metric";
  if (zone.type === "image") return "photo:<id>";
  return "text content";
}

function _renderCustomSlideExample(layout) {
  const zones = {};
  for (const zone of layout.zones) {
    zones[zone.label] = _customZoneExampleValue(zone);
  }
  return JSON.stringify({
    layout: `custom:${layout.id}`,
    title: "Slide title",
    zones,
  }, null, 2);
}

function _renderCustomCatalog(list) {
  if (!list.length) return "";
  const lines = ["", "## Custom layouts (user-uploaded)", ""];
  lines.push("**Hard rule for every `custom:*` layout:** `spec.zones` must");
  lines.push("contain an entry for EVERY zone listed below — no exceptions.");
  lines.push("If you can't produce real content for all of them, pick a");
  lines.push("different layout (standard ones are fine). Last-resort fallback:");
  lines.push("use the string `\"To define\"` for the missing zones.");
  lines.push("");
  for (const c of list) {
    const hasImageZone = c.zones.some(z => z.type === "image");
    const description = c.description || layoutDescriptionFallback(c);
    const role = c.category === "structural" && c.structural_role ? `; role: ${c.structural_role}` : "";
    const styleSummary = _customLayoutStyleSummary(c);
    lines.push("- `custom:" + c.id + "` – **" + c.name + "** – category: `" + getCustomCategory(c) + "`" + role + " – " + description);
    lines.push("  - `" + c.zones.length + "` zone(s) – ALL must be populated.");
    lines.push("  - " + styleSummary + " Prefer layouts whose colors and font are compatible with the rest of the deck.");
    lines.push("  - exact slide object (copy the `zones` keys exactly):");
    lines.push("    ```json");
    for (const line of _renderCustomSlideExample(c).split("\n")) {
      lines.push("    " + line);
    }
    lines.push("    ```");
    lines.push("  - `title` is a top-level field; do NOT put it inside `zones` unless it appears as an exact zone key below.");
    if (hasImageZone) {
      lines.push("  - **accepts images** – this layout has one or more `image` zones; you MUST put a `photo:<id>` there if the user uploaded photos (see `user_photos`).");
    }
    lines.push("  - zones (use these exact keys in `spec.zones`):");
    for (const z of c.zones) {
      const example =
        z.type === "bullets" ? '["item 1", "item 2", ...]'
      : z.type === "kpi"     ? '"42%\\nKey metric"'
      : z.type === "image"   ? '"photo:<id>"   ← reference a user-uploaded photo from user_photos'
      : '"text content"';
      const pos = `x:${Math.round(z.x_pct)}% y:${Math.round(z.y_pct)}% ${Math.round(z.w_pct)}×${Math.round(z.h_pct)}%`;
      lines.push("    - `" + z.label + "` (" + z.type + ") [" + pos + "] → " + example);
    }
  }
  return lines.join("\n");
}

// ---- modal flow ---------------------------------------------------------
function openCustomModal() {
  window.PPTGen.ui.openModal("customModal");
  // reset to step 1
  document.getElementById("customStep1").classList.remove("hidden");
  document.getElementById("customStep2").classList.add("hidden");
  document.getElementById("customImage").value = "";
  document.getElementById("customPreview").classList.add("hidden");
  document.getElementById("btnAnalyzeImage").disabled = true;
  pendingImage = null;
  pendingImageName = "Custom layout";
  pendingZones = [];
  pendingVision = null;
}

function closeCustomModal() {
  window.PPTGen.ui.closeModal("customModal");
}

async function onImageSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  pendingImageName = String(file.name || "Custom layout").replace(/\.[^.]+$/, "");
  pendingImage = await fileToDataUrl(file);
  document.getElementById("customImgPreview").src = pendingImage;
  document.getElementById("customPreview").classList.remove("hidden");
  document.getElementById("btnAnalyzeImage").disabled = false;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function analyzeImage() {
  if (!pendingImage) return;
  if (typeof window.savePrefs === "function") {
    try { await window.savePrefs(); }
    catch (error) { window.PPTGen.ui.notify(`Settings were not saved: ${error.message}`, "warn"); }
  }
  const c = cfg();
  if (!c.apiKey) {
    if (!confirm("No Vision API key is configured. Continue with manual classification and zones?")) return;
    pendingVision = {
      suggested_name: pendingImageName,
      suggested_description: "Custom layout to describe.",
      suggested_category: "custom", suggested_structural_role: "title",
      category_confidence: 0, category_rationale: "Manual classification.", failed: true,
      errorCode: "auth", errorMessage: "Configure an API key to analyze this layout with Vision.",
    };
    pendingZones = [];
    showReviewStep();
    return;
  }

  const visionCfg = { ...c, model: c.visionModel || c.model };
  const btn = document.getElementById("btnAnalyzeImage");

  const emit = (typeof log === "function") ? log : () => {};

  // Upfront warning: if the vision model is the same as the main (text-only)
  // model, the call will 404 on OpenRouter with "No endpoints found that
  // support image input". Prompt the user before spending the request.
  if (!c.visionModel) {
    const proceed = confirm(
      "The Settings 'Vision Model' field is empty.\n\n" +
      "The main model (\"" + c.model + "\") will be used for analysis. It must support vision or the call will fail.\n\n" +
      "Recommended free Vision model for OpenRouter:\n" +
      "   nvidia/nemotron-nano-12b-v2-vl:free\n\n" +
      "Continue with \"" + c.model + "\" anyway?"
    );
    if (!proceed) return;
  }

  btn.disabled = true; btn.textContent = "Analyzing...";

  // Hard timeout: if the provider hangs for more than 90 s, give up and
  // reset the UI so the user isn't stuck on "Analyzing...".
  const ANALYSIS_TIMEOUT_MS = 90_000;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Timeout after ${ANALYSIS_TIMEOUT_MS / 1000}s. The provider did not respond. Try another Vision Model or check your connection.`)),
      ANALYSIS_TIMEOUT_MS);
  });

  emit("step", `Vision: starting custom layout analysis`);
  emit("info", `Base URL : ${c.baseUrl}`);
  emit("info", `Vision Model: ${visionCfg.model} ${c.visionModel ? "(dedicated)" : "(fallback to main model - may 404 if not multimodal)"}`);
  emit("info", `Image : ${Math.round(pendingImage.length * 0.75 / 1024)} KB (data URL ${pendingImage.length} chars)`);

  const t0 = performance.now();
  try {
    // Race the actual vision call against the hard timeout.
    const result = await Promise.race([
      callVisionAgent(visionCfg, pendingImage, emit),
      timeoutPromise,
    ]);
    clearTimeout(timeoutId);
    const dt = Math.round(performance.now() - t0);

    if (!result || typeof result !== "object") {
      throw new Error("Invalid Vision response (not an object)");
    }
    if (!Array.isArray(result.zones)) {
      emit("error", "The response does not contain a 'zones' array", result);
      throw new Error("Invalid Vision response: missing 'zones' array");
    }

    const security = window.PPTGen?.security;
    pendingVision = {
      suggested_name: security?.boundedString(result.suggested_name, 200) || "Custom layout",
      suggested_description: security?.boundedString(result.suggested_description, 2000)
        || "Imported custom layout",
      suggested_category: CUSTOM_CATEGORIES.includes(result.suggested_category)
        ? result.suggested_category : "custom",
      suggested_structural_role: STRUCTURAL_ROLES.includes(result.suggested_structural_role)
        ? result.suggested_structural_role : "title",
      category_confidence: Math.max(0, Math.min(1, Number(result.category_confidence) || 0)),
      category_rationale: security?.boundedString(result.category_rationale, 200) || "",
    };
    pendingZones = (result.zones || []).slice(0, 64).map((z, i) => {
      const candidate = {
        id: "z" + i,
        type: ["title", "subtitle", "bullets", "text_block", "kpi", "image"].includes(z?.type)
          ? z.type : "text_block",
        label: security?.boundedString(z?.label, 80) || ("zone " + (i + 1)),
        x_pct: clamp01(z?.x_pct), y_pct: clamp01(z?.y_pct),
        w_pct: Math.max(1, clamp01(z?.w_pct)), h_pct: Math.max(1, clamp01(z?.h_pct)),
        align: ["left", "center", "right"].includes(z?.align) ? z.align : "left",
        color: security?.boundedString(z?.color, 32) || "dark",
      };
      return security?.normalizeZone(candidate, i) || candidate;
    });

    emit("ok", `Vision finished in ${dt} ms - ${pendingZones.length} zones detected`, {
      suggested_name: pendingVision.suggested_name,
      zones: pendingZones.map(z => `${z.type}:${z.label} (${z.x_pct}%,${z.y_pct}% · ${z.w_pct}×${z.h_pct}%)`),
    });
    showReviewStep();
  } catch (e) {
    console.error(e);
    emit("error", `Vision failed after ${Math.round(performance.now() - t0)} ms: ${e.message}`);

    const diagnostic = llmDiagnostic(e, { vision: true });
    let helpful = diagnostic.message + (diagnostic.detail ? "\n\n" + diagnostic.detail : "");
    if (/No endpoints found that support image input/i.test(e.message)) {
      helpful =
        "The model \"" + visionCfg.model + "\" does not support vision.\n\n" +
        "Go to Settings and fill the 'Vision Model' field with a multimodal model.\n\n" +
        "Free OpenRouter suggestions:\n" +
        "  - nvidia/nemotron-nano-12b-v2-vl:free   (recommended)\n" +
        "  - google/gemma-4-31b-it:free\n" +
        "  - google/gemma-4-26b-a4b-it:free\n\n" +
        "For Groq: meta-llama/llama-4-scout-17b-16e-instruct\n" +
        "For OpenAI: gpt-4o-mini or gpt-4o";
    } else if (/401|Unauthorized/i.test(e.message)) {
      helpful = "Invalid or unrecognized API key for " + c.baseUrl +
                ". Check Settings.";
    } else if (/429|rate limit/i.test(e.message)) {
      helpful = "Rate limit reached on " + visionCfg.model +
                ". Wait a few seconds or change the Vision model.";
    } else if (/Timeout/i.test(e.message)) {
      helpful = e.message;
    }

    const manual = confirm("Vision analysis failed:\n\n" + helpful + "\n\nContinue manually?");
    if (manual) {
      pendingVision = {
        suggested_name: "Custom layout",
        suggested_description: "Custom layout to describe.",
        suggested_category: "custom",
        suggested_structural_role: "title",
        category_confidence: 0,
        category_rationale: "Vision analysis unavailable - manual classification.",
        failed: true,
        errorCode: diagnostic.code,
        errorMessage: helpful.slice(0, 500),
      };
      pendingZones = [];
      showReviewStep();
    }
  } finally {
    // ALWAYS reset the button and clear the timeout, even on unexpected
    // throws or browser-level weirdness.
    clearTimeout(timeoutId);
    btn.disabled = false;
    btn.textContent = "Analyze image";
  }
}

function clamp01(v) { const n = Number(v) || 0; return Math.max(0, Math.min(100, n)); }

function showReviewStep() {
  document.getElementById("customStep1").classList.add("hidden");
  document.getElementById("customStep2").classList.remove("hidden");
  document.getElementById("customCanvasImg").src = pendingImage;
  document.getElementById("customName").value = pendingVision?.suggested_name || "";
  document.getElementById("customDesc").value = pendingVision?.suggested_description || "";
  const category = document.getElementById("customCategory");
  category.value = pendingVision?.suggested_category || "custom";
  const role = document.getElementById("customRole");
  role.value = pendingVision?.suggested_structural_role || "title";
  const rationale = document.getElementById("customCategoryRationale");
  const confidence = Math.round((pendingVision?.category_confidence || 0) * 100);
  rationale.textContent = `${pendingVision?.category_rationale || "Vision suggestion"} - confidence ${confidence}%`;
  _toggleCustomRoleVisibility();
  renderPendingZones();
}

function _toggleCustomRoleVisibility() {
  document.getElementById("customRoleWrap")?.classList.toggle(
    "hidden", document.getElementById("customCategory")?.value !== "structural",
  );
}

function renderPendingZones() {
  const overlay = document.getElementById("customZoneOverlay");
  const list = document.getElementById("customZoneList");

  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  overlay.innerHTML = pendingZones.map((z, i) => `
    <div class="zone-rect" data-zone-id="${z.id}" data-role="move" style="
      left:${z.x_pct}%; top:${z.y_pct}%;
      width:${z.w_pct}%; height:${z.h_pct}%;">
      <div class="zone-tag">${i + 1} · ${z.type}</div>
      ${handles.map(h => `<div class="zone-handle ${h}" data-zone-id="${z.id}" data-role="${h}"></div>`).join("")}
    </div>
  `).join("");

  // Wire up drag + resize on every rect + handle.
  overlay.querySelectorAll("[data-role]").forEach(el => {
    el.addEventListener("mousedown", onZoneInteractStart);
    el.addEventListener("touchstart", onZoneInteractStart, { passive: false });
  });

  list.innerHTML = pendingZones.map((z, i) => `
    <li class="zone-row" data-zone-id="${z.id}">
      <span class="zone-num">${i + 1}</span>
      <select data-field="type">
        ${["title", "subtitle", "bullets", "text_block", "kpi", "image"].map(t =>
          `<option value="${t}"${z.type === t ? " selected" : ""}>${t}</option>`).join("")}
      </select>
      <input type="text" data-field="label" value="${escAttr(z.label)}">
      <button class="secondary" data-action="delete">Delete</button>
    </li>
  `).join("");

  list.querySelectorAll(".zone-row").forEach(row => {
    const id = row.dataset.zoneId;
    row.querySelector('[data-field="type"]').addEventListener("change", e => {
      const z = pendingZones.find(z => z.id === id);
      if (z) { z.type = e.target.value; renderPendingZones(); }
    });
    row.querySelector('[data-field="label"]').addEventListener("input", e => {
      const z = pendingZones.find(z => z.id === id);
      if (z) z.label = e.target.value;
    });
    row.querySelector('[data-action="delete"]').addEventListener("click", () => {
      pendingZones = pendingZones.filter(z => z.id !== id);
      renderPendingZones();
    });
  });
}

// ---- Drag / resize (option B) ------------------------------------------
// Pointer-based direct manipulation of zone rectangles in the overlay.
// Uses percentage coordinates (relative to the image container) so the
// state stays resolution-independent.
function onZoneInteractStart(e) {
  const el = e.currentTarget;
  const zoneId = el.dataset.zoneId;
  const role   = el.dataset.role;    // "move" | "nw" | "n" | ... | "w"
  const wrap = document.querySelector(".custom-canvas-wrap");
  if (!wrap) return;
  const zone = pendingZones.find(z => z.id === zoneId);
  if (!zone) return;

  e.preventDefault();
  e.stopPropagation();

  const wrapRect = wrap.getBoundingClientRect();
  const start = { ...pointerXY(e) };
  const snap  = { ...zone };

  const MIN_SIZE = 3;   // %

  function onMove(ev) {
    const p = pointerXY(ev);
    const dxPct = ((p.x - start.x) / wrapRect.width)  * 100;
    const dyPct = ((p.y - start.y) / wrapRect.height) * 100;

    if (role === "move") {
      zone.x_pct = clamp01(snap.x_pct + dxPct);
      zone.y_pct = clamp01(snap.y_pct + dyPct);
      if (zone.x_pct + zone.w_pct > 100) zone.x_pct = 100 - zone.w_pct;
      if (zone.y_pct + zone.h_pct > 100) zone.y_pct = 100 - zone.h_pct;
    } else {
      // Resize: each compass letter moves one edge.
      if (role.includes("w")) {
        const newX = clamp(snap.x_pct + dxPct, 0, snap.x_pct + snap.w_pct - MIN_SIZE);
        zone.w_pct = snap.w_pct - (newX - snap.x_pct);
        zone.x_pct = newX;
      }
      if (role.includes("e")) {
        const maxW = 100 - snap.x_pct;
        zone.w_pct = clamp(snap.w_pct + dxPct, MIN_SIZE, maxW);
      }
      if (role.includes("n")) {
        const newY = clamp(snap.y_pct + dyPct, 0, snap.y_pct + snap.h_pct - MIN_SIZE);
        zone.h_pct = snap.h_pct - (newY - snap.y_pct);
        zone.y_pct = newY;
      }
      if (role.includes("s")) {
        const maxH = 100 - snap.y_pct;
        zone.h_pct = clamp(snap.h_pct + dyPct, MIN_SIZE, maxH);
      }
    }
    updateZoneRectDom(zone);
    ev.preventDefault();
  }

  function onEnd() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup",   onEnd);
    window.removeEventListener("touchmove", onMove);
    window.removeEventListener("touchend",  onEnd);
  }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup",   onEnd);
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("touchend",  onEnd);
}

function pointerXY(e) {
  if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Fast DOM update during drag — avoids re-running renderPendingZones() on
// every frame (which would rebuild the list and steal focus from inputs).
function updateZoneRectDom(zone) {
  const rect = document.querySelector(`.zone-rect[data-zone-id="${zone.id}"]`);
  if (!rect) return;
  rect.style.left   = zone.x_pct + "%";
  rect.style.top    = zone.y_pct + "%";
  rect.style.width  = zone.w_pct + "%";
  rect.style.height = zone.h_pct + "%";
}

function escAttr(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function saveCustomFromModal() {
  const name = document.getElementById("customName").value.trim();
  const desc = document.getElementById("customDesc").value.trim();
  const category = document.getElementById("customCategory").value;
  const structuralRole = document.getElementById("customRole").value;
  if (!name) { alert("Give this layout a name."); return; }
  if (!pendingZones.length) { alert("At least one zone is required."); return; }
  if (!pendingImage) { alert("No image available."); return; }

  const btn = document.getElementById("btnSaveCustom");
  btn.disabled = true; btn.textContent = "Cleaning image...";

  const emit = (typeof log === "function") ? log : () => {};
  let cleanDataUrl = pendingImage;
  try {
    emit("step", "Cleaning image (masking zones by sampling nearby edges)");
    const t0 = performance.now();
    cleanDataUrl = await cleanImage(pendingImage, pendingZones);
    emit("ok", `Image cleaned in ${Math.round(performance.now() - t0)} ms (${Math.round(cleanDataUrl.length * 0.75 / 1024)} KB)`);
  } catch (e) {
    console.error("cleanImage failed:", e);
    emit("warn", `Image cleanup failed - keeping original image: ${e.message}`);
    cleanDataUrl = pendingImage;
  }

  const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = {
    id,
    name,
    description: desc || "Custom layout.",
    category,
    ...(category === "structural" ? { structural_role: structuralRole } : {}),
    imageDataUrl: cleanDataUrl,
    zones: pendingZones.map(z => ({
      type: z.type,
      label: z.label,
      x_pct: z.x_pct, y_pct: z.y_pct,
      w_pct: z.w_pct, h_pct: z.h_pct,
      align: z.align, color: z.color,
    })),
    createdAt: new Date().toISOString(),
    analysis: {
      classificationStatus: pendingVision?.failed || category !== pendingVision?.suggested_category ? "manual" : "complete",
      descriptionStatus: desc !== pendingVision?.suggested_description ? "manual" : (pendingVision?.failed ? "failed" : "complete"),
      ...(pendingVision?.errorCode ? { errorCode: pendingVision.errorCode } : {}),
      ...(pendingVision?.errorMessage ? { errorMessage: pendingVision.errorMessage } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
  try {
    await _putCustomLayout(entry);
    const fullId = "custom:" + id;
    LayoutSelection.add(fullId);
    try { await persistGallerySelection(); }
    catch (error) {
      emit("warn", `Layout saved, Gallery preference not persisted: ${error.message}`);
      window.PPTGen.ui.notify("Layout saved; Gallery selection will be retried later.", "warn");
    }
    emit("ok", `Custom layout saved: ${name}`);
    closeCustomModal();
    renderLayoutGallery(document.getElementById("layoutGrid"));
  } catch (e) {
    console.error("custom layout save failed:", e);
    emit("error", `Custom layout save failed: ${e.message}`);
    alert(`Save failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save this layout";
  }
}

// ---- Image cleaning (Plan 4) ------------------------------------------
// Wipe each zone by sampling the colour of pixels just outside the rect
// (top/bottom/left/right edges with small padding) and filling the zone
// with the median sample. Zones are processed largest-first so overlaps
// don't leak dirty pixels into smaller zones.

async function cleanImage(dataUrl, zones) {
  const img = await loadImgEl(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const sorted = [...zones].sort((a, b) =>
    (b.w_pct * b.h_pct) - (a.w_pct * a.h_pct));

  for (const zone of sorted) {
    const x = Math.round((zone.x_pct / 100) * canvas.width);
    const y = Math.round((zone.y_pct / 100) * canvas.height);
    const w = Math.round((zone.w_pct / 100) * canvas.width);
    const h = Math.round((zone.h_pct / 100) * canvas.height);
    if (w < 2 || h < 2) continue;
    const bg = sampleEdgeColor(ctx, x, y, w, h, canvas.width, canvas.height);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
  }
  return canvas.toDataURL("image/jpeg", 0.92);
}

function loadImgEl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("cannot load image for clean"));
    img.src = dataUrl;
  });
}

// Sample ~40 points along the rim just outside the zone (pad px). Returns
// an "rgb(...)" string using the median per channel — robust to outliers
// like the tip of a text glyph sticking past the detected zone.
function sampleEdgeColor(ctx, x, y, w, h, imgW, imgH) {
  const pad = 4;
  const N = 12;
  const reds = [], greens = [], blues = [];
  const push = (sx, sy) => {
    if (sx < 0 || sy < 0 || sx >= imgW || sy >= imgH) return;
    const p = ctx.getImageData(sx, sy, 1, 1).data;
    reds.push(p[0]); greens.push(p[1]); blues.push(p[2]);
  };
  for (let i = 0; i < N; i++) {
    const t = (N === 1) ? 0.5 : i / (N - 1);
    push(Math.round(x + t * w), y - pad);                 // top
    push(Math.round(x + t * w), y + h + pad);             // bottom
    push(x - pad,               Math.round(y + t * h));   // left
    push(x + w + pad,           Math.round(y + t * h));   // right
  }
  if (!reds.length) return "#ffffff";
  const median = arr => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return `rgb(${median(reds)},${median(greens)},${median(blues)})`;
}

async function deleteCustomLayout(id) {
  if (!confirm("Delete this custom layout?")) return;
  try {
    await _delCustomLayout(id);
    LayoutSelection.delete("custom:" + id);
    await persistGallerySelection();
    renderLayoutGallery(document.getElementById("layoutGrid"));
  } catch (error) {
    alert(`Delete failed: ${error.message}`);
  }
}

// ---- Edit metadata modal ----------------------------------------------
// Opens a small modal to rename the custom layout and reassign it to a
// category (and a structural role if category=structural). Save mutates
// the repository entry and re-renders the gallery so the card lands
// in the new group.
function openEditCustomModal(id) {
  const entry = getCustomLayoutById(id);
  if (!entry) return;
  const modal = document.getElementById("editCustomModal");
  if (!modal) return;
  document.getElementById("editCustomId").value = id;
  document.getElementById("editCustomName").value = entry.name || "";
  document.getElementById("editCustomDescription").value = entry.description || layoutDescriptionFallback(entry);
  const catSel = document.getElementById("editCustomCategory");
  catSel.value = getCustomCategory(entry);
  const roleSel = document.getElementById("editCustomRole");
  roleSel.value = STRUCTURAL_ROLES.includes(entry.structural_role)
    ? entry.structural_role : "title";
  _toggleEditCustomRoleVisibility();
  window.PPTGen.ui.openModal(modal);
}

function closeEditCustomModal() {
  const modal = document.getElementById("editCustomModal");
  if (modal) window.PPTGen.ui.closeModal(modal);
}

function _toggleEditCustomRoleVisibility() {
  const cat = document.getElementById("editCustomCategory")?.value;
  const wrap = document.getElementById("editCustomRoleWrap");
  if (!wrap) return;
  wrap.classList.toggle("hidden", cat !== "structural");
}

async function saveEditCustomFromModal() {
  const id = document.getElementById("editCustomId").value;
  const name = document.getElementById("editCustomName").value;
  const category = document.getElementById("editCustomCategory").value;
  const description = document.getElementById("editCustomDescription").value;
  const role = document.getElementById("editCustomRole").value;
  try {
    const updated = await updateCustomLayoutMeta(id, {
      name, description, category, structural_role: role,
    });
    if (!updated) {
      alert("Custom layout not found.");
      return;
    }
    closeEditCustomModal();
    renderLayoutGallery(document.getElementById("layoutGrid"));
  } catch (e) {
    console.error("custom layout metadata save failed:", e);
    if (typeof log === "function") log("error", `Custom layout edit failed: ${e.message}`);
    alert(`Change not saved: ${e.message}`);
  }
}

async function retryLayoutVisionFromModal() {
  const id = document.getElementById("editCustomId").value;
  const entry = getCustomLayoutById(id);
  if (!entry) return;
  if (entry.analysis?.descriptionStatus === "manual"
      && !confirm("Replace the manual description with a Vision suggestion?")) return;
  const c = cfg();
  if (!c.apiKey) { window.PPTGen.ui.notify("Configure an API key to rerun Vision.", "warn"); return; }
  const button = document.getElementById("btnRetryLayoutVision");
  button.disabled = true; button.textContent = "Analyzing...";
  try {
    const result = await analyzeLayoutThumbnail(c, entry.thumbnailDataUrl || entry.imageDataUrl);
    if (!result?.description) throw new Error("Vision description missing");
    await _putCustomLayout({
      ...entry,
      description: result.description,
      analysis: { ...clearAnalysisError(entry.analysis), descriptionStatus: "complete", updatedAt: new Date().toISOString() },
    });
    document.getElementById("editCustomDescription").value = result.description;
    renderLayoutGallery(document.getElementById("layoutGrid"));
    window.PPTGen.ui.notify("Vision description updated.", "ok");
  } catch (error) {
    await _putCustomLayout({
      ...entry,
      analysis: analysisFailure(error, { ...(entry.analysis || {}), descriptionStatus: "failed" }),
    }).catch(() => {});
    window.PPTGen.ui.notify(`Description not generated: ${diagnosticText(error)}`, "warn");
  } finally {
    button.disabled = false; button.textContent = "Rerun Vision";
  }
}

// ---- wiring -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await window.PPTGen.repoReady;
  // Main dropdown — replaces the old single button behaviour.
  const addBtn  = document.getElementById("btnAddCustom");
  const addMenu = document.getElementById("addCustomMenu");
  addBtn.addEventListener("click", e => {
    e.stopPropagation();
    addMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", e => {
    if (!e.target.closest(".dropdown")) addMenu.classList.add("hidden");
  });
  addMenu.querySelectorAll("button[data-import]").forEach(b => {
    b.addEventListener("click", () => {
      addMenu.classList.add("hidden");
      const mode = b.dataset.import;
      if (mode === "image")     openCustomModal();
      else if (mode === "slide")    openImportPptxSlideFlow();
    });
  });

  document.getElementById("customImage").addEventListener("change", onImageSelected);
  document.getElementById("btnAnalyzeImage").addEventListener("click", analyzeImage);
  document.getElementById("btnSaveCustom").addEventListener("click", saveCustomFromModal);
  document.getElementById("customCategory").addEventListener("change", _toggleCustomRoleVisibility);
  document.getElementById("btnAddZone").addEventListener("click", addBlankZone);

  // Close buttons specific to each modal (data-close-modal optionally
  // carries the modal id; default = the image+vision modal).
  document.querySelectorAll("[data-close-modal]").forEach(el =>
    el.addEventListener("click", () => {
      const target = el.dataset.closeModal;
      if (!target) closeCustomModal();
      else if (target === "importSlide") window.PPTGen.ui.closeModal("importSlideModal");
    }));

  // .pptx slide import flow
  document.getElementById("pptxSlideInput")
    .addEventListener("change", onPptxSlideFileSelected);
  document.getElementById("btnSelectAllSlides")
    .addEventListener("click", () => toggleAllSlides(true));
  document.getElementById("btnDeselectAllSlides")
    .addEventListener("click", () => toggleAllSlides(false));
  document.getElementById("btnImportSelectedSlides")
    .addEventListener("click", importSelectedSlidesBatch);

  // Edit-custom modal wiring (rename + recategorize)
  const editModal = document.getElementById("editCustomModal");
  if (editModal) {
    document.getElementById("editCustomCategory")
      .addEventListener("change", _toggleEditCustomRoleVisibility);
    document.getElementById("btnSaveEditCustom")
      .addEventListener("click", saveEditCustomFromModal);
    document.getElementById("btnRetryLayoutVision")
      .addEventListener("click", retryLayoutVisionFromModal);
    editModal.querySelectorAll("[data-close-edit-custom]").forEach(el =>
      el.addEventListener("click", closeEditCustomModal));
  }
});

// ---- Import slide from .pptx -------------------------------------------

let pendingPptxParse = null;   // holds the parsePptxFile result
let _pptxReviewReady = false;

function openImportPptxSlideFlow() {
  const modal = document.getElementById("importSlideModal");
  window.PPTGen.ui.openModal(modal);
  document.getElementById("importSlideStep1").classList.remove("hidden");
  document.getElementById("importSlideStep2").classList.add("hidden");
  document.getElementById("pptxSlideInput").value = "";
  const status = document.getElementById("pptxSlideStatus");
  status.classList.add("hidden"); status.textContent = "";
  pendingPptxParse = null;
  _pptxReviewReady = false;
}

async function onPptxSlideFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const status = document.getElementById("pptxSlideStatus");
  status.classList.remove("hidden");
  status.textContent = "Parsing...";
  try {
    pendingPptxParse = await parsePptxFile(file);
    status.textContent = `${pendingPptxParse.slides.length} slide(s) detected. Rendering previews...`;
    await renderSlidePicker(pendingPptxParse);
    document.getElementById("importSlideStep1").classList.add("hidden");
    document.getElementById("importSlideStep2").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    status.textContent = "Error: " + err.message;
  }
}

// Per-slide state in the picker (keyed by slide.index).
// selected: bool, thumbDataUrl: string, customThumb: boolean (true if user uploaded one)
const _slidePickState = new Map();

async function renderSlidePicker(parsed) {
  const grid = document.getElementById("slidePickerGrid");
  _slidePickState.clear();
  _pptxReviewReady = false;

  grid.innerHTML = parsed.slides.map(s =>
    `<div class="slide-pick-card" data-slide-index="${s.index}">
       <input type="checkbox" class="slide-check" data-slide-check="${s.index}">
       <button class="slide-thumb-override" data-thumb-override="${s.index}" title="Replace with PNG">IMG</button>
       <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" data-thumb-input="${s.index}">
       <img data-placeholder="${s.index}" alt="slide ${s.index}">
       <input type="text" data-slide-name="${s.index}" value="Slide ${s.index}" placeholder="Name">
       <div class="slide-pick-label">${s.shapes.length} shape(s)</div>
     </div>`
  ).join("");

  // Progressively fill schematic thumbs (non-blocking).
  for (const s of parsed.slides) {
    _slidePickState.set(s.index, { selected: false, thumbDataUrl: null, customThumb: false });
    try {
      const url = await renderSlideThumbnail(s);
      _slidePickState.get(s.index).thumbDataUrl = url;
      const img = grid.querySelector(`img[data-placeholder="${s.index}"]`);
      if (img) img.src = url;
    } catch (e) { console.warn("thumb failed for slide", s.index, e); }
  }

  // Wire up checkboxes
  grid.querySelectorAll("[data-slide-check]").forEach(cb => {
    cb.addEventListener("change", e => {
      const idx = parseInt(e.target.dataset.slideCheck, 10);
      const st = _slidePickState.get(idx);
      if (st) st.selected = e.target.checked;
      _pptxReviewReady = false;
      e.target.closest(".slide-pick-card").classList.toggle("selected", e.target.checked);
      updateSlidePickCounter();
    });
  });

  // Wire up per-slide thumbnail override buttons
  grid.querySelectorAll("[data-thumb-override]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = btn.dataset.thumbOverride;
      grid.querySelector(`[data-thumb-input="${idx}"]`).click();
    });
  });
  grid.querySelectorAll("[data-thumb-input]").forEach(input => {
    input.addEventListener("change", async e => {
      const idx = parseInt(e.target.dataset.thumbInput, 10);
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const raw = await fileToDataUrl(file);
        const compressed = await downscaleImage(raw, 1280, 0.7);
        const img = grid.querySelector(`img[data-placeholder="${idx}"]`);
        if (img) img.src = compressed;
        const st = _slidePickState.get(idx);
        if (st) { st.thumbDataUrl = compressed; st.customThumb = true; }
      } catch (err) {
        alert("Could not load this PNG: " + err.message);
      }
    });
  });

  updateSlidePickCounter();
}

function updateSlidePickCounter() {
  const selected = [..._slidePickState.values()].filter(s => s.selected).length;
  const counter = document.getElementById("slidePickCounter");
  if (counter) counter.textContent = `${selected} slide(s) selected`;
  const btn = document.getElementById("btnImportSelectedSlides");
  if (btn) {
    btn.disabled = selected === 0;
    btn.textContent = selected === 0
      ? "Import selection"
      : (_pptxReviewReady ? `Confirm import (${selected})` : `Analyze ${selected} slide(s) with Vision`);
  }
}

function toggleAllSlides(selected) {
  const grid = document.getElementById("slidePickerGrid");
  grid.querySelectorAll("[data-slide-check]").forEach(cb => {
    cb.checked = selected;
    const idx = parseInt(cb.dataset.slideCheck, 10);
    const st = _slidePickState.get(idx);
    if (st) st.selected = selected;
    cb.closest(".slide-pick-card").classList.toggle("selected", selected);
  });
  _pptxReviewReady = false;
  updateSlidePickCounter();
}

/**
 * Batch import of all selected slides. Each one is saved as a custom
 * layout directly (no per-slide review) — the user can tune them later
 * by opening the custom modal individually.
 */
function renderPptxVisionReview(slide, result, error = null) {
  const state = _slidePickState.get(slide.index);
  if (!state) return;
  state.vision = result;
  state.visionError = error ? llmDiagnostic(error, { vision: true }) : null;
  const card = document.querySelector(`[data-slide-index="${slide.index}"]`);
  card.querySelector(".slide-vision-review")?.remove();
  const review = document.createElement("div");
  review.className = "slide-vision-review";
  const category = document.createElement("select");
  category.dataset.slideCategory = slide.index;
  for (const value of CUSTOM_CATEGORIES) {
    const option = document.createElement("option"); option.value = value; option.textContent = value;
    category.appendChild(option);
  }
  category.value = result?.suggested_category || "custom";
  const role = document.createElement("select");
  role.dataset.slideRole = slide.index;
  for (const value of STRUCTURAL_ROLES) {
    const option = document.createElement("option"); option.value = value; option.textContent = value;
    role.appendChild(option);
  }
  role.value = result?.suggested_structural_role || "title";
  role.classList.toggle("hidden", category.value !== "structural");
  category.addEventListener("change", () => {
    state.categoryManual = true;
    role.classList.toggle("hidden", category.value !== "structural");
  });
  const description = document.createElement("textarea");
  description.rows = 2;
  description.dataset.slideDescription = slide.index;
  description.value = result?.description || `Layout ${category.value} imported from slide ${slide.index}.`;
  description.addEventListener("input", () => { state.descriptionManual = true; });
  const rationale = document.createElement("small");
  rationale.className = "muted";
  rationale.textContent = state.visionError
    ? `Vision unavailable: ${state.visionError.message}`
    : result
    ? `${result.category_rationale || "Vision suggestion"} - confidence ${Math.round(result.category_confidence * 100)}%`
    : "Vision unavailable: manually verify the category and description.";
  review.append(category, role, description, rationale);
  card.appendChild(review);
}

async function preparePptxVisionReview(slides, button) {
  const c = typeof cfg === "function" ? cfg() : null;
  const queue = [...slides];
  let done = 0;
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      const slide = queue.shift();
      const state = _slidePickState.get(slide.index);
      let result = null;
      let visionError = null;
      if (c?.apiKey && state?.thumbDataUrl) {
        try { result = await analyzeLayoutThumbnail(c, state.thumbDataUrl); }
        catch (error) {
          visionError = error;
          console.warn("Vision classification failed", slide.index, error);
        }
      }
      renderPptxVisionReview(slide, result, visionError);
      done++;
      button.textContent = `Vision analysis ${done}/${slides.length}...`;
    }
  });
  await Promise.all(workers);
  _pptxReviewReady = true;
}

async function importSelectedSlidesBatch() {
  const parsed = pendingPptxParse;
  if (!parsed) return;
  const grid = document.getElementById("slidePickerGrid");
  const toImport = parsed.slides.filter(slide => _slidePickState.get(slide.index)?.selected);
  if (!toImport.length) return;
  const button = document.getElementById("btnImportSelectedSlides");
  button.disabled = true;
  try {
    if (!_pptxReviewReady) {
      button.textContent = `Vision analysis 0/${toImport.length}...`;
      await preparePptxVisionReview(toImport, button);
      window.PPTGen.ui.notify("Review the proposed categories and descriptions, then confirm import.", "info");
      return;
    }

    const savedEntries = [];
    const failed = [];
    let done = 0;
    for (const slide of toImport) {
      try {
        const state = _slidePickState.get(slide.index);
        const thumb = state?.thumbDataUrl || await renderSlideThumbnail(slide);
        const tight = await downscaleImage(thumb, 960, 0.65);
        const { zones, decorativeShapes } = classifySlideAsLayout(slide.shapes);
        const category = grid.querySelector(`[data-slide-category="${slide.index}"]`)?.value || "custom";
        const role = grid.querySelector(`[data-slide-role="${slide.index}"]`)?.value || "title";
        const description = grid.querySelector(`[data-slide-description="${slide.index}"]`)?.value.trim()
          || `Layout ${category} with zones ${[...new Set(zones.map(zone => zone.type))].join(", ")}.`;
        const name = grid.querySelector(`[data-slide-name="${slide.index}"]`)?.value.trim() || `Slide ${slide.index}`;
        const entry = {
          id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name, description, category,
          ...(category === "structural" ? { structural_role: role } : {}),
          source: "pptx", thumbnailDataUrl: tight,
          background: { shapes: decorativeShapes },
          zones: zones.map(zone => ({
            type: zone.type, label: zone.label,
            x_pct: zone.x_pct, y_pct: zone.y_pct, w_pct: zone.w_pct, h_pct: zone.h_pct,
            align: zone.align, color: zone.color, ...(zone.style ? { style: zone.style } : {}),
          })),
          createdAt: new Date().toISOString(),
          analysis: {
            classificationStatus: state?.categoryManual ? "manual" : (state?.vision ? "complete" : "failed"),
            descriptionStatus: state?.descriptionManual ? "manual" : (state?.vision?.description ? "complete" : "failed"),
            ...(state?.visionError?.code ? { errorCode: state.visionError.code } : {}),
            ...(state?.visionError?.message ? { errorMessage: state.visionError.message.slice(0, 500) } : {}),
            updatedAt: new Date().toISOString(),
          },
        };
        await _putCustomLayout(entry);
        savedEntries.push(entry);
        LayoutSelection.add("custom:" + entry.id);
      } catch (error) {
        failed.push(`slide ${slide.index}: ${error.message}`);
      }
      done++;
      button.textContent = `Importing ${done}/${toImport.length}...`;
    }
    if (savedEntries.length) {
      try { await persistGallerySelection(); }
      catch (error) { window.PPTGen.ui.notify(`Layouts saved, selection not persisted: ${error.message}`, "warn"); }
    }
    renderLayoutGallery(document.getElementById("layoutGrid"));
    window.PPTGen.ui.closeModal("importSlideModal");
    window.PPTGen.ui.notify(
      `${savedEntries.length} layout(s) imported${failed.length ? `, ${failed.length} failed` : ""}.`,
      failed.length ? "warn" : "ok",
    );
  } finally {
    button.disabled = false;
    updateSlidePickCounter();
  }
}

// ---- Silent vision enrichment -------------------------------------------
//
// Runs in the background after a batch import. Each entry gets a
// proper structural description from the vision LLM so the layout
// agent can match it intelligently during generation. The user
// keeps full control of the UI while this runs.

async function enrichCustomLayoutsWithVision(ids) {
  if (!ids || !ids.length) return;
  const c = (typeof cfg === "function") ? cfg() : null;
  if (!c || !c.apiKey) return;          // silently skip if no API key
  const visionCfg = { ...c, model: c.visionModel || c.model };

  // Mark all targets as pending so the gallery shows an indicator.
  _markEnriching(ids, "pending");
  _updateEnrichBadge();

  const emit = (typeof log === "function") ? log : () => {};
  emit("info", `Vision (silent): enriching ${ids.length} custom layout(s) in the background`);

  // Worker pool of 2 — avoids hammering the provider while keeping
  // overall throughput reasonable on a 60-slide import.
  const queue = [...ids];
  const CONC = 2;
  const workers = Array.from({ length: Math.min(CONC, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      const entry = _getCustomLayoutEntry(id);
      if (!entry) { _markEnriching([id], "skip"); continue; }
      try {
        const desc = await describeLayoutThumbnail(
          visionCfg, entry.thumbnailDataUrl || entry.imageDataUrl);
        if (desc && desc.trim()) {
          await _updateLayoutDescription(id, desc.trim());
        } else {
          throw new Error("Vision description missing");
        }
        _markEnriching([id], "done");
      } catch (e) {
        console.warn("vision enrich failed for", id, e);
        emit("warn", `Vision (silent): ${id} not enriched - ${diagnosticText(e)}`);
        const failedEntry = getCustomLayoutById(id);
        if (failedEntry) await _putCustomLayout({
          ...failedEntry,
          analysis: analysisFailure(e, { ...(failedEntry.analysis || {}), descriptionStatus: "failed" }),
        }).catch(() => {});
        _markEnriching([id], "failed");
      }
      // Update the badge + gallery after each one so the user sees progress.
      _updateEnrichBadge();
      renderLayoutGallery(document.getElementById("layoutGrid"));
    }
  });
  await Promise.all(workers);

  emit("ok", `Vision (silent): ${ids.length} custom layout(s) enriched`);
  _updateEnrichBadge();
}

// In-memory status tracker — keyed by custom layout id.
const _enrichStatus = new Map();   // id → "pending" | "done" | "failed" | "skip"

function _markEnriching(ids, status) {
  for (const id of ids) _enrichStatus.set(id, status);
  renderLayoutGallery(document.getElementById("layoutGrid"));
}

function _getCustomLayoutEntry(id) {
  return getCustomLayouts().find(c => c.id === id) || null;
}

async function _updateLayoutDescription(id, newDesc) {
  const entry = getCustomLayoutById(id);
  if (!entry) return;
  entry.description = newDesc;
  entry.analysis = { ...clearAnalysisError(entry.analysis), descriptionStatus: "complete", updatedAt: new Date().toISOString() };
  await _putCustomLayout(entry);
}

function _updateEnrichBadge() {
  const n = [..._enrichStatus.values()].filter(s => s === "pending").length;
  const tab = document.querySelector('.sub-tab[data-sub-tab="panelLayouts"]');
  if (!tab) return;
  const existing = tab.querySelector(".enrich-badge");
  if (n > 0) {
    if (existing) existing.textContent = "🔄 " + n;
    else tab.insertAdjacentHTML("beforeend", ` <span class="enrich-badge">🔄 ${n}</span>`);
  } else if (existing) {
    existing.remove();
  }
}

// Exposed for gallery.js so the layout tile can show a "enriching…" hint.
function getEnrichStatus(id) { return _enrichStatus.get(id) || null; }
window.getEnrichStatus = getEnrichStatus;

/**
 * Heuristic classification: pick a type for each shape based on font
 * size, shape kind, text content. Largest font → title; second largest
 * → subtitle; multi-line text blocks → bullets; short % / number → kpi;
 * pictures → image.
 */
function classifySlideShapes(shapes) {
  const textShapes = shapes.filter(s => s.kind === "text" && s.text);
  textShapes.sort((a, b) => (b.fontSize || 0) - (a.fontSize || 0));

  return shapes
    .filter(s => s.w_pct > 2 && s.h_pct > 2)    // drop zero-size markers
    .map((s, i) => {
      let type = "text_block";
      let label = s.name || ("zone " + (i + 1));
      if (s.kind === "image" || s.kind === "smart") {
        type = "image";
      } else if (s.kind === "text") {
        const rank = textShapes.indexOf(s);
        if (rank === 0) type = "title";
        else if (rank === 1 && textShapes.length > 2) type = "subtitle";
        else if (/^\s*[-+•\d\w.]/.test(s.text) && s.text.includes("\n")) type = "bullets";
        else if (/^[\d+\-.,%€$]{1,10}\s*$/.test(s.text)) type = "kpi";
      }
      return {
        id: "z" + i,
        type, label,
        x_pct: s.x_pct, y_pct: s.y_pct,
        w_pct: s.w_pct, h_pct: s.h_pct,
        align: "left", color: "dark",
      };
    });
}

// Grid-based label ("kpi_top_left", "title_top_center", ...) so the LLM
// can tell zones apart even when the original pptx shape names are
// generic ("Rectangle 1", "TextBox 3"). Falls back to the author's
// shape name only when it looks meaningful.
function _zoneLabel(s, type, i) {
  const name = (s.name || "").trim();
  const generic = /^(Rectangle|Text|TextBox|Text Box|Shape|Picture|Oval|Ellipse|Content Placeholder|Text Placeholder|Title \d*|Group)\s*\d*$/i;
  if (name && !generic.test(name)) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (slug) return slug.slice(0, 40);
  }
  const col = s.x_pct < 33 ? "left" : s.x_pct < 66 ? "center" : "right";
  const row = s.y_pct < 33 ? "top"  : s.y_pct < 66 ? "mid"    : "bottom";
  return `${type}_${row}_${col}_${i + 1}`;
}

function _uniqueZoneLabel(label, used) {
  const base = label || "zone";
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${index++}`;
  }
  used.add(candidate);
  return candidate;
}

// Bounding box of a shape list in EMU space. Used to rescale SmartArt
// sub-shapes (which live in the diagram's own EMU coordinates) to
// percentages relative to their frame on the slide.
function _bboxEmu(shapes) {
  if (!shapes.length) return { x: 0, y: 0, w: 1, h: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    x0 = Math.min(x0, s.x_emu);
    y0 = Math.min(y0, s.y_emu);
    x1 = Math.max(x1, s.x_emu + s.w_emu);
    y1 = Math.max(y1, s.y_emu + s.h_emu);
  }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * Split a parsed-slide shape list into:
 *   - zones: large text blocks the LLM will fill (title/subtitle/bullets/text_block/kpi).
 *     Their original text is DROPPED so the build only shows the agent's
 *     output — no phantom overlap with the source slide.
 *   - decorativeShapes: everything else (small labels, lower-page navigation, rects,
 *     images, smart frames) that we redraw verbatim at build time to
 *     preserve the visual identity of the slide.
 *
 * Threshold heuristic:
 *   - `w_pct * h_pct < 6` → small label, keep as decorative text
 *   - `y_pct > 88`        → lower-page zone, keep as decorative
 *   - anything else with text content → fillable zone (text stripped)
 */
function classifySlideAsLayout(shapes) {
  const zones = [];
  const decorativeShapes = [];
  const usedZoneLabels = new Set();

  // Rank non-trivial text shapes by font size for title/subtitle picking.
  const textWithContent = shapes.filter(s => s.kind === "text" && s.text);
  const sortedText = [...textWithContent]
    .sort((a, b) => (b.fontSize || 0) - (a.fontSize || 0));

  shapes.forEach((s, i) => {
    if (s.w_pct < 2 || s.h_pct < 2) return;          // drop ticks / 0-size
    const area = s.w_pct * s.h_pct;
    const isFooter = s.y_pct > 88;
    const isSmall  = area < 6;
    const baseBox = {
      x_pct: s.x_pct, y_pct: s.y_pct,
      w_pct: s.w_pct, h_pct: s.h_pct,
    };

    // Images + SmartArt frames + shapes without text → always decorative
    if (s.kind === "image") {
      decorativeShapes.push({ kind: "image", ...baseBox, dataUrl: s.dataUrl || null });
      return;
    }
    if (s.kind === "smart") {
      // Explode the SmartArt's drawingXml into primitive shapes (rects,
      // ovals, text) so the original diagram is faithfully redrawn at
      // build time instead of collapsing to a gray placeholder.
      if (s.drawingXml && typeof extractShapesFromDrawingXml === "function") {
        try {
          const sub = extractShapesFromDrawingXml(s.drawingXml);
          if (sub.length) {
            const bbox = _bboxEmu(sub);
            for (const ss of sub) {
              const rx = (ss.x_emu - bbox.x) / bbox.w;
              const ry = (ss.y_emu - bbox.y) / bbox.h;
              const rw = ss.w_emu / bbox.w;
              const rh = ss.h_emu / bbox.h;
              const x_pct = s.x_pct + rx * s.w_pct;
              const y_pct = s.y_pct + ry * s.h_pct;
              const w_pct = rw * s.w_pct;
              const h_pct = rh * s.h_pct;
              const isOval = ss.preset === "ellipse" || ss.preset === "oval"
                          || ss.preset === "circle";
              if (ss.fill) {
                decorativeShapes.push({
                  kind: isOval ? "oval" : "shape",
                  x_pct, y_pct, w_pct, h_pct,
                  fill: ss.fill,
                });
              }
              if (ss.text) {
                decorativeShapes.push({
                  kind: "text",
                  x_pct, y_pct, w_pct, h_pct,
                  text: ss.text,
                  fontSize: ss.fontSize ? Math.round(ss.fontSize / 100) : 10,
                  color: ss.textColor || null,
                  bold: !!ss.bold,
                  italic: !!ss.italic,
                  fontFace: ss.fontFace || null,
                  align: ss.align || "center",
                });
              }
            }
            return;
          }
        } catch (e) {
          console.warn("SmartArt extraction failed — falling back:", e);
        }
      }
      // Fallback: light tinted rectangle at the frame position.
      decorativeShapes.push({ kind: "shape", ...baseBox, fill: "#f1f5f9" });
      return;
    }
    const preset = s.preset || "rect";
    const isOvalPreset = preset === "ellipse" || preset === "oval" || preset === "circle";
    const isNonRect = preset !== "rect" && preset !== "none";

    if (s.kind === "shape" || (s.kind === "text" && !s.text)) {
      if (s.fill) {
        decorativeShapes.push({
          kind: isOvalPreset ? "oval" : "shape",
          ...baseBox,
          fill: s.fill,
        });
      }
      return;
    }

    // Non-rectangular text shape (ellipse, circle, badge…) — almost
    // always a graphic label. Keep it decorative: redraw the shape AND
    // its original text together so we don't break the visual identity.
    if (s.kind === "text" && isNonRect) {
      if (s.fill) {
        decorativeShapes.push({
          kind: isOvalPreset ? "oval" : "shape",
          ...baseBox,
          fill: s.fill,
        });
      }
      if (s.text) {
        decorativeShapes.push({
          kind: "text",
          ...baseBox,
          text: s.text,
          fontSize: s.fontSize ? Math.round(s.fontSize / 100) : 14,
          color: s.textColor || null,
          bold: !!s.bold,
          italic: !!s.italic,
          fontFace: s.fontFace || null,
          align: s.align || "center",
        });
      }
      return;
    }

    // Text shape with actual content.
    if (isSmall || isFooter) {
      // Footer / nav / page number / tiny label → keep the original text
      // + its formatting, verbatim.
      decorativeShapes.push({
        kind: "text",
        ...baseBox,
        text: s.text,
        fontSize: s.fontSize ? Math.round(s.fontSize / 100) : 10,
        color: s.textColor || null,
        bold: !!s.bold,
        italic: !!s.italic,
        fontFace: s.fontFace || null,
        align: s.align || "left",
      });
      return;
    }

    // Fillable zone — strip the original text; keep the placeholder box
    // AND the typography so new content inherits the slide's visual tone.
    let type = "text_block";
    const rank = sortedText.indexOf(s);
    if (rank === 0) type = "title";
    else if (rank === 1 && sortedText.length > 2) type = "subtitle";
    else if (/^\s*[-+•\d\w.]/.test(s.text) && s.text.includes("\n")) type = "bullets";
    else if (/^[\d+\-.,%€$]{1,10}\s*$/.test(s.text)) type = "kpi";

    zones.push({
      id: "z" + i,
      type,
      label: _uniqueZoneLabel(_zoneLabel(s, type, i), usedZoneLabels),
      ...baseBox,
      align: s.align || "left",
      color: "dark",
      style: {
        fontSize: s.fontSize ? Math.round(s.fontSize / 100) : null,
        color: s.textColor || null,
        bold: !!s.bold,
        italic: !!s.italic,
        fontFace: s.fontFace || null,
      },
    });
  });

  return { zones, decorativeShapes };
}

// Add a blank zone at a reasonable position. Tries to avoid the existing
// zones by cascading the default origin by a few percent per zone.
function addBlankZone() {
  const i = pendingZones.length;
  const offset = (i * 6) % 50;          // cascade 0, 6, 12... capped at 50
  const defaults = {
    id: "z" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
    type: "text_block",
    label: "zone " + (i + 1),
    x_pct: 10 + offset,
    y_pct: 20 + offset,
    w_pct: 30,
    h_pct: 15,
    align: "left",
    color: "dark",
  };
  pendingZones.push(defaults);
  renderPendingZones();
  // Scroll the new row into view in the zones list.
  const row = document.querySelector(`.zone-row[data-zone-id="${defaults.id}"]`);
  if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

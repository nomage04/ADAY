// custom_icons.js — user-imported PNG icons stored alongside the 63
// bundled ones. They flow into ALLOWED_ICONS + filteredIconsCatalog +
// addIcon() the same way as the built-ins.
//
// One JSON file per icon is persisted by the local server.
const CI_CAP = window.PPTGen.constraints.collectionCaps.icons;
const CI_SIDE = 128;
const CI_QUALITY = 0.9;
let _customIconsCache = null;

// Scan all pptgen.ci.* keys. Corrupt JSON / invalid entries are skipped with
// a console.warn so one bad key never breaks the icon gallery.
function getCustomIcons() {
  if (_customIconsCache) return _customIconsCache.slice();
  const out = window.PPTGen.repoStore.getAll("icons");
  out.sort((a, b) => String(a.addedAt || a.id).localeCompare(String(b.addedAt || b.id)));
  _customIconsCache = out;
  return out.slice();
}
function getCustomIconById(id) {
  if (!id) return null;
  return window.PPTGen.repoStore.get("icons", id);
}
async function _putCustomIcon(entry) {
  if (!entry || !entry.id) throw new Error("custom icon without id");
  const normalized = window.PPTGen?.security?.normalizeCustomIcon(entry);
  if (!normalized) throw new Error("invalid custom icon");
  await window.PPTGen.repoStore.put("icons", normalized);
  _customIconsCache = null;
  return normalized;
}
async function _delCustomIcon(id) {
  await window.PPTGen.repoStore.remove("icons", id);
  _customIconsCache = null;
}
async function deleteCustomIcon(id) {
  await _delCustomIcon(id);
}
function getCustomIconStems() { return getCustomIcons().map(c => c.id); }

function customIconDescriptionFallback(entry) {
  const concept = String(entry?.id || entry?.name || "icon")
    .replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return `Icon to represent ${concept || "this concept"}.`;
}

function iconLlmDiagnostic(error) {
  if (error?.llmDiagnostic) return error.llmDiagnostic;
  if (typeof classifyLlmError === "function") return classifyLlmError(error, { vision: true });
  if (typeof visionErrorDiagnostic === "function") return visionErrorDiagnostic(error);
  const message = String(error?.message || error || "Unknown Vision error");
  return { code: "unknown", message, detail: message.slice(0, 500) };
}

function iconAnalysisFailure(error, base = {}) {
  const diagnostic = iconLlmDiagnostic(error);
  return {
    ...base,
    errorCode: diagnostic.code || "unknown",
    errorMessage: (diagnostic.message || diagnostic.detail || String(error?.message || error || "Unknown Vision error")).slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
}

function clearIconAnalysisError(analysis = {}) {
  const next = { ...analysis };
  delete next.errorCode;
  delete next.errorMessage;
  return next;
}

function iconDiagnosticText(error) {
  const diagnostic = iconLlmDiagnostic(error);
  return diagnostic.message + (diagnostic.detail ? " " + diagnostic.detail : "");
}

// Normalize a filename into a stem that plays well with the LLM catalog
// and the addIcon() resolver (must be lowercase alnum + underscore).
function _normalizeIconStem(name) {
  const base = String(name || "icon")
    .replace(/\.[a-z0-9]+$/i, "")          // strip extension
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || "icon";
}

function _uniqueStem(base) {
  const taken = new Set([
    ...(typeof ALLOWED_ICONS !== "undefined" ? Array.from(ALLOWED_ICONS) : []),
    ...getCustomIconStems(),
  ]);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 999; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base + "_" + Date.now().toString(36);
}

async function ingestIconFile(file) {
  if (getCustomIcons().length >= CI_CAP) throw new Error(`Limit reached — ${CI_CAP} icons max.`);
  const raw = await _fileToDataUrl(file);
  const thumb = await _squareDownscale(raw, CI_SIDE, CI_QUALITY);
  const id = _uniqueStem(_normalizeIconStem(file.name));
  const canAnalyze = typeof cfg === "function" && !!cfg().apiKey;
  const entry = {
    id,                        // used as stem by addIcon() + catalog
    name: file.name,
    description: customIconDescriptionFallback({ id, name: file.name }),
    dataUrl: thumb,
    addedAt: new Date().toISOString(),
    analysis: {
      descriptionStatus: canAnalyze ? "pending" : "failed",
      ...(!canAnalyze ? { errorCode: "auth", errorMessage: "Configure an API key to generate the Vision description." } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
  await _putCustomIcon(entry);
  return entry;
}

async function enrichCustomIconsWithVision(ids, { force = false } = {}) {
  const c = typeof cfg === "function" ? cfg() : null;
  if (!c?.apiKey || !ids?.length) return;
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      const entry = getCustomIconById(id);
      if (!entry || (!force && entry.analysis?.descriptionStatus === "manual")) continue;
      try {
        const description = await describeIconThumbnail(c, entry.dataUrl);
        if (!description) throw new Error("Vision description missing");
        await _putCustomIcon({
          ...entry, description,
          analysis: { ...clearIconAnalysisError(entry.analysis), descriptionStatus: "complete", updatedAt: new Date().toISOString() },
        });
      } catch (error) {
        if (typeof log === "function") log("warn", `Vision icon ${id}: ${iconDiagnosticText(error)}`);
        await _putCustomIcon({
          ...entry,
          analysis: iconAnalysisFailure(error, { descriptionStatus: "failed" }),
        }).catch(() => {});
      }
      renderIconGallery(document.getElementById("iconGrid"));
    }
  });
  await Promise.all(workers);
}

function openEditCustomIconModal(id) {
  const entry = getCustomIconById(id);
  if (!entry) return;
  document.getElementById("editCustomIconId").value = id;
  document.getElementById("editCustomIconDescription").value = entry.description || customIconDescriptionFallback(entry);
  window.PPTGen.ui.openModal("editCustomIconModal");
}

async function saveEditCustomIcon() {
  const id = document.getElementById("editCustomIconId").value;
  const entry = getCustomIconById(id);
  const description = document.getElementById("editCustomIconDescription").value.trim();
  if (!entry || !description) return;
  await _putCustomIcon({
    ...entry, description,
    analysis: { descriptionStatus: "manual", updatedAt: new Date().toISOString() },
  });
  window.PPTGen.ui.closeModal("editCustomIconModal");
  renderIconGallery(document.getElementById("iconGrid"));
}

async function retryCustomIconVision() {
  const id = document.getElementById("editCustomIconId").value;
  const entry = getCustomIconById(id);
  if (!entry) return;
  if (entry.analysis?.descriptionStatus === "manual"
      && !confirm("Replace the manual description with a Vision suggestion?")) return;
  const button = document.getElementById("btnRetryIconVision");
  button.disabled = true; button.textContent = "Analyzing...";
  try {
    await enrichCustomIconsWithVision([id], { force: true });
    const updated = getCustomIconById(id);
    document.getElementById("editCustomIconDescription").value = updated?.description || "";
    const complete = updated?.analysis?.descriptionStatus === "complete";
    window.PPTGen.ui.notify(complete
      ? "Vision description updated."
      : `Description not generated: ${updated?.analysis?.errorMessage || "diagnostic unavailable"}.`,
      complete ? "ok" : "warn");
  } finally {
    button.disabled = false; button.textContent = "Rerun Vision";
  }
}

window.openEditCustomIconModal = openEditCustomIconModal;

function _fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Fit the image into a 128×128 square canvas, centered, keeping
// transparency for PNG sources. JPEG-encoded so file sizes stay small.
async function _squareDownscale(dataUrl, side, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = side;
      const ctx = canvas.getContext("2d");
      // White background so PNG transparent bits don't go to black on JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, side, side);
      const ratio = Math.min(side / img.naturalWidth, side / img.naturalHeight);
      const w = img.naturalWidth * ratio;
      const h = img.naturalHeight * ratio;
      ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
      try { resolve(canvas.toDataURL("image/jpeg", quality)); }
      catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("cannot load icon image"));
    img.src = dataUrl;
  });
}

// ---- UI --------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  await window.PPTGen.repoReady;
  const input = document.getElementById("customIconInput");
  if (!input) return;
  const btn = document.getElementById("btnImportIcons");
  if (btn) btn.addEventListener("click", () => input.click());
  input.addEventListener("change", async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const slotsLeft = CI_CAP - getCustomIcons().length;
    if (slotsLeft <= 0) {
      alert(`Limit reached — ${CI_CAP} icons max.`);
      return;
    }
    const toAdd = files.slice(0, slotsLeft);
    if (files.length > slotsLeft) {
      alert(`${slotsLeft} icon(s) added (cap ${CI_CAP} reached).`);
    }
    const saved = [];
    for (const f of toAdd) {
      try { saved.push(await ingestIconFile(f)); }
      catch (err) { alert(err.message); break; }
    }
    // Re-render the icon gallery + refresh in-memory selection.
    if (typeof initSelections === "function") initSelections();
    if (typeof renderIconGallery === "function") {
      renderIconGallery(document.getElementById("iconGrid"));
    }
    enrichCustomIconsWithVision(saved.map(icon => icon.id));
  });
  document.getElementById("btnSaveEditCustomIcon")?.addEventListener("click", saveEditCustomIcon);
  document.getElementById("btnRetryIconVision")?.addEventListener("click", retryCustomIconVision);
  document.querySelectorAll("[data-close-edit-custom-icon]").forEach(element =>
    element.addEventListener("click", () => window.PPTGen.ui.closeModal("editCustomIconModal")));
});

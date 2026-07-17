(function initSecurity(global) {
  "use strict";

  const PPTGen = global.PPTGen = global.PPTGen || {};
  const CONSTRAINTS = PPTGen.constraints;
  const ID_RE = /^[a-z0-9_]{1,64}$/;
  const IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;
  const ZONE_TYPES = new Set(["title", "subtitle", "text", "text_block", "bullets", "kpi", "image"]);
  const CATEGORIES = new Set(CONSTRAINTS.categories);
  const ALIGNS = new Set(["left", "center", "right"]);
  const ANALYSIS_STATUSES = new Set(CONSTRAINTS.analysisStatuses);

  function isRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function boundedString(value, maxLength, { required = false, trim = true } = {}) {
    if (typeof value !== "string") return required ? null : undefined;
    const result = trim ? value.trim() : value;
    if ((required && !result) || result.length > maxLength) return null;
    return result;
  }

  function imageDataUrlInfo(value, maxBytes = 4 * 1024 * 1024) {
    if (typeof value !== "string") return null;
    const match = IMAGE_RE.exec(value);
    if (!match) return null;
    const encoded = match[2];
    if (encoded.length % 4 !== 0) return null;
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const bytes = (encoded.length / 4) * 3 - padding;
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > maxBytes) return null;
    let decoded;
    try {
      if (typeof global.atob !== "function") return null;
      decoded = global.atob(encoded);
    } catch {
      return null;
    }
    const data = Uint8Array.from(decoded, character => character.charCodeAt(0));
    const mime = match[1];
    let width = 0, height = 0;
    if (mime === "png" && data.length >= 24 && [137,80,78,71,13,10,26,10].every((v, i) => data[i] === v)) {
      const view = new DataView(data.buffer);
      width = view.getUint32(16); height = view.getUint32(20);
    } else if (mime === "gif" && data.length >= 10 && String.fromCharCode(...data.slice(0, 6)).match(/^GIF8[79]a$/)) {
      const view = new DataView(data.buffer);
      width = view.getUint16(6, true); height = view.getUint16(8, true);
    } else if (mime === "jpeg" && data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255) {
      let offset = 2;
      while (offset + 9 < data.length) {
        if (data[offset] !== 255) { offset++; continue; }
        const marker = data[offset + 1]; offset += 2;
        if (marker === 216 || marker === 217) continue;
        const length = (data[offset] << 8) | data[offset + 1];
        if (length < 2 || offset + length > data.length) break;
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
          height = (data[offset + 3] << 8) | data[offset + 4];
          width = (data[offset + 5] << 8) | data[offset + 6];
          break;
        }
        offset += length;
      }
    } else if (mime === "webp" && data.length >= 30
        && String.fromCharCode(...data.slice(0, 4)) === "RIFF"
        && String.fromCharCode(...data.slice(8, 12)) === "WEBP") {
      const kind = String.fromCharCode(...data.slice(12, 16));
      if (kind === "VP8X") {
        width = 1 + data[24] + (data[25] << 8) + (data[26] << 16);
        height = 1 + data[27] + (data[28] << 8) + (data[29] << 16);
      }
    }
    if (!width || !height || width > CONSTRAINTS.maxImageSide || height > CONSTRAINTS.maxImageSide
        || width * height > CONSTRAINTS.maxImagePixels) return null;
    return { mime: `image/${mime}`, bytes, width, height };
  }

  function normalizeImageDataUrl(value, maxBytes) {
    return imageDataUrlInfo(value, maxBytes) ? value : null;
  }

  function finitePercent(value, positive = false) {
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;
    if (positive && value === 0) return null;
    return value;
  }

  function normalizeStyle(raw) {
    if (!isRecord(raw)) return undefined;
    const out = {};
    if (Number.isFinite(raw.fontSize)) out.fontSize = Math.max(6, Math.min(96, raw.fontSize));
    const color = boundedString(raw.color, 32);
    const fontFace = boundedString(raw.fontFace, 80);
    if (color) out.color = color;
    if (fontFace) out.fontFace = fontFace;
    if (typeof raw.bold === "boolean") out.bold = raw.bold;
    if (typeof raw.italic === "boolean") out.italic = raw.italic;
    if (ALIGNS.has(raw.align)) out.align = raw.align;
    return Object.keys(out).length ? out : undefined;
  }

  function normalizeZone(raw, index = 0) {
    if (!isRecord(raw)) return null;
    const label = boundedString(raw.label, 80, { required: true });
    const type = ZONE_TYPES.has(raw.type) ? raw.type : null;
    const x = finitePercent(raw.x_pct);
    const y = finitePercent(raw.y_pct);
    const w = finitePercent(raw.w_pct, true);
    const h = finitePercent(raw.h_pct, true);
    if (!label || !type || x === null || y === null || w === null || h === null) return null;
    const out = { label, type, x_pct: x, y_pct: y, w_pct: w, h_pct: h };
    const id = boundedString(raw.id, 32);
    const color = boundedString(raw.color, 32);
    if (id && /^z[a-z0-9_-]*$/i.test(id)) out.id = id;
    else if (index >= 0) out.id = `z${index}`;
    if (ALIGNS.has(raw.align)) out.align = raw.align;
    if (color) out.color = color;
    const style = normalizeStyle(raw.style);
    if (style) out.style = style;
    return out;
  }

  function normalizeBackgroundShape(raw) {
    if (!isRecord(raw) || !["image", "shape", "oval", "text"].includes(raw.kind)) return null;
    const x = finitePercent(raw.x_pct);
    const y = finitePercent(raw.y_pct);
    const w = finitePercent(raw.w_pct, true);
    const h = finitePercent(raw.h_pct, true);
    if (x === null || y === null || w === null || h === null) return null;
    const out = { kind: raw.kind, x_pct: x, y_pct: y, w_pct: w, h_pct: h };
    if (raw.kind === "image") {
      const dataUrl = normalizeImageDataUrl(raw.dataUrl);
      if (!dataUrl) return null;
      out.dataUrl = dataUrl;
    }
    for (const key of ["fill", "color", "fontFace"]) {
      const value = boundedString(raw[key], key === "fontFace" ? 80 : 32);
      if (value) out[key] = value;
    }
    const text = boundedString(raw.text, 5000, { trim: false });
    if (text !== undefined && text !== null) out.text = text;
    if (Number.isFinite(raw.fontSize)) out.fontSize = Math.max(6, Math.min(96, raw.fontSize));
    if (typeof raw.bold === "boolean") out.bold = raw.bold;
    if (typeof raw.italic === "boolean") out.italic = raw.italic;
    if (ALIGNS.has(raw.align)) out.align = raw.align;
    return out;
  }

  function normalizeAnalysis(raw, { classification = false, legacyDescription = false } = {}) {
    if (!isRecord(raw)) {
      if (!legacyDescription) return undefined;
      return {
        ...(classification ? { classificationStatus: "manual" } : {}),
        descriptionStatus: "manual",
      };
    }
    const out = {};
    if (classification && ANALYSIS_STATUSES.has(raw.classificationStatus)) {
      out.classificationStatus = raw.classificationStatus;
    }
    if (ANALYSIS_STATUSES.has(raw.descriptionStatus)) out.descriptionStatus = raw.descriptionStatus;
    const updatedAt = boundedString(raw.updatedAt, 64);
    if (updatedAt) out.updatedAt = updatedAt;
    const errorCode = boundedString(raw.errorCode, 40);
    if (errorCode && /^[a-z0-9_-]{1,40}$/.test(errorCode)) out.errorCode = errorCode;
    const errorMessage = boundedString(raw.errorMessage, 500);
    if (errorMessage) out.errorMessage = errorMessage;
    return Object.keys(out).length ? out : undefined;
  }

  function normalizeCustomIcon(raw) {
    if (!isRecord(raw) || !ID_RE.test(raw.id || "")) return null;
    const name = boundedString(raw.name, 200, { required: true });
    const dataUrl = normalizeImageDataUrl(raw.dataUrl);
    if (!name || !dataUrl) return null;
    const out = { id: raw.id, name, dataUrl };
    const description = boundedString(raw.description, 1000);
    const addedAt = boundedString(raw.addedAt, 64);
    if (description) out.description = description;
    if (addedAt) out.addedAt = addedAt;
    const analysis = normalizeAnalysis(raw.analysis, { legacyDescription: !!description });
    if (analysis) out.analysis = analysis;
    return out;
  }

  function normalizePhoto(raw) {
    if (!isRecord(raw)) return null;
    const id = boundedString(raw.id, 80, { required: true });
    const name = boundedString(raw.name, 300, { required: true });
    const dataUrl = normalizeImageDataUrl(raw.dataUrl, 8 * 1024 * 1024);
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !name || !dataUrl) return null;
    const description = boundedString(raw.description || "", 5000, { trim: false });
    const addedAt = boundedString(raw.addedAt || "", 64);
    if (description === null) return null;
    return { id, name, description: description || "", dataUrl, addedAt: addedAt || "" };
  }

  function normalizeCustomLayout(raw) {
    if (!isRecord(raw) || !ID_RE.test(raw.id || "")) return null;
    const name = boundedString(raw.name, 200, { required: true });
    if (!name || !Array.isArray(raw.zones) || raw.zones.length > 64) return null;
    const zones = raw.zones.map(normalizeZone);
    if (zones.some(zone => !zone)) return null;
    const out = { id: raw.id, name, zones };
    const description = boundedString(raw.description, 2000);
    const category = CATEGORIES.has(raw.category) ? raw.category : "custom";
    const createdAt = boundedString(raw.createdAt, 64);
    if (description) out.description = description;
    out.category = category;
    if (category === "structural") {
      if (!["title", "closing"].includes(raw.structural_role)) return null;
      out.structural_role = raw.structural_role;
    }
    if (raw.source === "pptx") out.source = "pptx";
    if (createdAt) out.createdAt = createdAt;
    for (const key of ["imageDataUrl", "thumbnailDataUrl"]) {
      if (raw[key] !== undefined) {
        const dataUrl = normalizeImageDataUrl(raw[key]);
        if (!dataUrl) return null;
        out[key] = dataUrl;
      }
    }
    if (raw.background !== undefined) {
      if (!isRecord(raw.background) || !Array.isArray(raw.background.shapes)
          || raw.background.shapes.length > 500) return null;
      const shapes = raw.background.shapes.map(normalizeBackgroundShape);
      if (shapes.some(shape => !shape)) return null;
      out.background = { shapes };
    }
    const analysis = normalizeAnalysis(raw.analysis, { classification: true, legacyDescription: !!description });
    if (analysis) out.analysis = analysis;
    return out;
  }

  function normalizePrefs(raw) {
    if (!isRecord(raw)) return null;
    const out = {};
    for (const [key, max] of [["baseUrl", 2048], ["model", 200], ["visionModel", 200], ["apiKey", 4096]]) {
      const value = boundedString(raw[key], max, { trim: key !== "apiKey" });
      if (value !== undefined && value !== null) out[key] = value;
    }
    if (typeof raw.rememberKey === "boolean") out.rememberKey = raw.rememberKey;
    if (typeof raw.debugLogs === "boolean") out.debugLogs = raw.debugLogs;
    return out;
  }

  function normalizeGallery(raw) {
    if (!isRecord(raw)) return null;
    const normalizeIds = value => Array.isArray(value)
      ? [...new Set(value.filter(id => typeof id === "string"
          && /^(?:custom:)?[a-z0-9_]{1,64}$/.test(id)).slice(0, 500))]
      : [];
    return {
      disabledIcons: normalizeIds(raw.disabledIcons),
      disabledLayouts: normalizeIds(raw.disabledLayouts),
    };
  }

  function normalizeHistoryEntry(raw) {
    if (!isRecord(raw) || !Array.isArray(raw.plan) || raw.plan.length > 100) return null;
    const id = boundedString(raw.id, 80, { required: true });
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
    const topic = boundedString(raw.topic || "(sans titre)", 500, { required: true });
    const savedAt = boundedString(raw.savedAt || "", 64);
    const display = boundedString(raw.display || "", 1024 * 1024, { trim: false });
    if (!topic || display === null) return null;
    const warnings = Array.isArray(raw.warnings)
      ? raw.warnings.map(value => boundedString(value, 2000)).filter(Boolean).slice(0, 100)
      : [];
    const plan = raw.plan.map(slide => {
      if (!isRecord(slide)) return slide;
      const normalized = { ...slide };
      delete normalized.breadcrumb;
      return normalized;
    });
    return {
      id,
      savedAt: savedAt || "",
      topic,
      slideCount: plan.length,
      plan,
      display: display || "",
      warnings,
    };
  }

  function normalizeConfigBackup(raw) {
    if (!isRecord(raw) || ![1, 2].includes(raw.version)) return null;
    const prefs = raw.prefs === undefined ? undefined : normalizePrefs(raw.prefs);
    const gallery = raw.gallery === undefined ? undefined : normalizeGallery(raw.gallery);
    if (raw.prefs !== undefined && !prefs) return null;
    if (raw.gallery !== undefined && !gallery) return null;
    const history = raw.plansHistory === undefined ? []
      : Array.isArray(raw.plansHistory)
        ? raw.plansHistory.map(normalizeHistoryEntry)
        : null;
    if (!history || history.some(entry => !entry)) return null;
    return { version: raw.version, prefs, gallery, plansHistory: history };
  }

  PPTGen.security = {
    ID_RE,
    isRecord,
    boundedString,
    imageDataUrlInfo,
    normalizeImageDataUrl,
    normalizeZone,
    normalizeCustomIcon,
    normalizePhoto,
    normalizeCustomLayout,
    normalizePrefs,
    normalizeGallery,
    normalizeHistoryEntry,
    normalizeConfigBackup,
  };
})(window);

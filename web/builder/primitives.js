// Low-level drawing helpers — thin wrappers around pptxgenjs.
// All positions in inches, all colors as hex without '#'.

function addRect(slide, x, y, w, h, fillHex, lineHex) {
  const opts = {
    x, y, w, h,
    fill: { color: fillHex },
    line: lineHex ? { color: lineHex, width: 1 } : { type: "none" },
  };
  slide.addShape("rect", opts);
}

function addRule(slide, x, y, w, color, thickness = 0.06) {
  addRect(slide, x, y, w, thickness, color);
}

function addOval(slide, x, y, w, h, fillHex) {
  slide.addShape("ellipse", {
    x, y, w, h,
    fill: { color: fillHex },
    line: { type: "none" },
  });
}

function addTextbox(slide, text, x, y, w, h, opts = {}) {
  const {
    fontSize = 14,
    color = THEME.NEUTRAL_TITLE,
    bold = false,
    italic = false,
    align = "left",
    valign = "top",
    fontFace = THEME.FONT_FACE || "Calibri",
  } = opts;
  slide.addText(text || "", {
    x, y, w, h,
    fontSize, color,
    bold, italic,
    align,
    valign,
    fontFace,
    wrap: true,
    margin: 0.05,
  });
}

function addBulletList(slide, items, x, y, w, h, opts = {}) {
  const {
    fontSize = 14,
    color = THEME.NEUTRAL_BODY,
    bold = false,
    fontFace = THEME.FONT_FACE || "Calibri",
  } = opts;
  const safe = (items || []).slice(0, MAX_BULLETS);
  if (safe.length === 0) return;
  slide.addText(
    safe.map(t => ({ text: t, options: { bullet: { code: "25A0" }, paraSpaceAfter: 6 } })),
    {
      x, y, w, h,
      fontSize, color, bold, fontFace,
      valign: "top",
      margin: 0.05,
    }
  );
}

/**
 * Insert a bundled icon (PNG). Silently no-ops if the name isn't in
 * ALLOWED_ICONS — caller should have validated earlier.
 * Uses the preloaded data URL cache to avoid pptxgenjs's XHR loader
 * (which fails on file:// origin).
 */
function addIcon(slide, name, x, y, size) {
  // 1. Built-in icon → served from the embedded assets cache.
  if (ALLOWED_ICONS.has(name)) {
    const data = getAssetIconDataUrl(name);
    if (!data) return false;
    slide.addImage({ x, y, w: size, h: size, data });
    return true;
  }
  // 2. User-imported custom icon → inlined base64 from repository JSON.
  if (typeof getCustomIconById === "function") {
    const custom = getCustomIconById(name);
    if (custom && custom.dataUrl) {
      slide.addImage({ x, y, w: size, h: size, data: custom.dataUrl });
      return true;
    }
  }
  return null;   // unknown stem — caller decides (layout silently skips)
}

/**
 * Insert a bundled logo (PNG). Returns true if added, false if unknown
 * stem — caller can fall back to an initials badge.
 */
function addLogo(slide, name, x, y, w, h) {
  if (!ALLOWED_LOGOS.has(name)) return false;
  const data = getAssetLogoDataUrl(name);
  if (!data) return false;
  slide.addImage({ x, y, w, h, data });
  return true;
}

/**
 * Initials-badge fallback when a logo isn't available.
 */
function addLogoFallback(slide, label, x, y, w, h, colorIdx = 0) {
  const color = CATEGORY_ACCENTS[colorIdx % CATEGORY_ACCENTS.length];
  addRect(slide, x, y, w, h, color);
  const initials = (label || "?").trim().split(/\s+/)
    .map(s => s[0]?.toUpperCase() || "")
    .join("")
    .slice(0, 3);
  addTextbox(slide, initials, x, y + h * 0.2, w, h * 0.6, {
    fontSize: Math.floor(Math.min(w, h) * 36),
    color: THEME.WHITE,
    bold: true,
    align: "center",
    valign: "middle",
  });
}

function paintBg(slide, color) {
  addRect(slide, 0, 0, SLIDE_W, SLIDE_H, color);
}

function normalizeHexColor(value) {
  const hex = String(value || "").trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : "";
}

function hexToRgb(hex) {
  const safe = normalizeHexColor(hex);
  if (!safe) return null;
  return {
    r: parseInt(safe.slice(0, 2), 16),
    g: parseInt(safe.slice(2, 4), 16),
    b: parseInt(safe.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
  return [clamp(r), clamp(g), clamp(b)]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function blendHex(a, b, amount = 0.5) {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  if (!left) return normalizeHexColor(b);
  if (!right) return normalizeHexColor(a);
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex({
    r: left.r * (1 - t) + right.r * t,
    g: left.g * (1 - t) + right.g * t,
    b: left.b * (1 - t) + right.b * t,
  });
}

function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = value => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function colorDistance(a, b) {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  if (!left || !right) return Infinity;
  return Math.sqrt(
    Math.pow(left.r - right.r, 2)
    + Math.pow(left.g - right.g, 2)
    + Math.pow(left.b - right.b, 2)
  );
}

function colorSaturation(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const values = [rgb.r, rgb.g, rgb.b].map(v => v / 255);
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === 0) return 0;
  return (max - min) / max;
}

function isAccentColor(hex) {
  const safe = normalizeHexColor(hex);
  if (!safe) return false;
  const lum = relativeLuminance(safe);
  return colorSaturation(safe) >= 0.28 && lum > 0.08 && lum < 0.88;
}

function addColorWeight(weights, color, weight = 1) {
  const hex = normalizeHexColor(color);
  if (!hex) return;
  weights.set(hex, (weights.get(hex) || 0) + Math.max(0.1, weight));
}

function addFontWeight(weights, fontFace, weight = 1) {
  const font = String(fontFace || "").trim();
  if (!font) return;
  weights.set(font, (weights.get(font) || 0) + Math.max(0.1, weight));
}

function rankedWeightKeys(weights, filter = () => true) {
  return Array.from(weights.entries())
    .filter(([key]) => filter(key))
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

function chooseDistinctColor(colors, fallback, previous = []) {
  const blocked = previous.map(normalizeHexColor).filter(Boolean);
  const found = colors.find(color =>
    !blocked.some(prev => colorDistance(color, prev) < 36)
  );
  return found || normalizeHexColor(fallback);
}

function describeCustomLayoutVisualStyle(definition = {}) {
  const colorWeights = new Map();
  const fontWeights = new Map();
  const shapes = Array.isArray(definition.background?.shapes)
    ? definition.background.shapes : [];
  for (const shape of shapes) {
    const area = Math.max(1, (Number(shape.w_pct) || 0) * (Number(shape.h_pct) || 0));
    if (shape.fill) addColorWeight(colorWeights, shape.fill, Math.min(5, area / 150));
    if (shape.color) addColorWeight(colorWeights, shape.color, shape.kind === "text" ? 1.2 : 0.5);
    if (shape.fontFace) addFontWeight(fontWeights, shape.fontFace, shape.kind === "text" ? 1.5 : 0.5);
  }
  const zones = Array.isArray(definition.zones) ? definition.zones : [];
  for (const zone of zones) {
    const style = zone.style || {};
    const weight = zone.type === "title" || zone.type === "kpi" ? 2 : 1;
    if (style.color) addColorWeight(colorWeights, style.color, weight);
    if (style.fontFace) addFontWeight(fontWeights, style.fontFace, weight);
  }

  const accentCandidates = rankedWeightKeys(colorWeights, isAccentColor);
  const allColors = rankedWeightKeys(colorWeights);
  const accent = chooseDistinctColor(accentCandidates, THEME.ACCENT);
  const secondary = chooseDistinctColor(accentCandidates.concat(allColors), THEME.ACCENT_2, [accent]);
  const fontFace = rankedWeightKeys(fontWeights)[0] || "Calibri";
  return {
    accent,
    secondary,
    fontFace,
    colors: allColors.slice(0, 5),
  };
}

function buildDeckVisualProfile(plan = []) {
  const colorWeights = new Map();
  const layouts = {};
  for (const spec of Array.isArray(plan) ? plan : []) {
    if (!spec || typeof spec.layout !== "string" || !spec.layout.startsWith("custom:")) continue;
    const definition = typeof getCustomLayoutById === "function"
      ? getCustomLayoutById(spec.layout.slice("custom:".length)) : null;
    if (!definition) continue;
    const style = describeCustomLayoutVisualStyle(definition);
    layouts[spec.layout] = style;
    addColorWeight(colorWeights, style.accent, 2);
    addColorWeight(colorWeights, style.secondary, 1);
    for (const color of style.colors || []) addColorWeight(colorWeights, color, 0.3);
  }

  const accentCandidates = rankedWeightKeys(colorWeights, isAccentColor);
  const allColors = rankedWeightKeys(colorWeights);
  const accent = chooseDistinctColor(accentCandidates, THEME.ACCENT);
  const secondary = chooseDistinctColor(accentCandidates.concat(allColors), THEME.ACCENT_2, [accent]);
  return {
    accent,
    secondary,
    fontFace: THEME.FONT_FACE || "Calibri",
    layouts,
  };
}

function harmonizeAccentColor(source, target) {
  const src = normalizeHexColor(source);
  const dst = normalizeHexColor(target);
  if (!src) return dst;
  if (!dst) return src;
  if (colorDistance(src, dst) < 88) return src;
  return blendHex(src, dst, 0.66);
}

function resolveSlideVisualProfile(spec = {}, deckProfile = null) {
  const base = deckProfile || buildDeckVisualProfile([]);
  const layoutStyle = spec?.layout ? base.layouts?.[spec.layout] : null;
  const accent = normalizeHexColor(layoutStyle?.accent) || base.accent;
  const secondary = harmonizeAccentColor(layoutStyle?.secondary, base.secondary) || base.secondary;
  return {
    ...base,
    accent,
    secondary,
    fontFace: base.fontFace || THEME.FONT_FACE || "Calibri",
  };
}

function harmonizeDecorativeShapeFill(color, shape = {}, visualProfile = null) {
  const hex = normalizeHexColor(color);
  if (!hex || !visualProfile || !isAccentColor(hex)) return hex || color;
  const area = Math.max(0, (Number(shape.w_pct) || 0) * (Number(shape.h_pct) || 0));
  const isSmall = area <= 8 || Number(shape.h_pct) <= 5 || Number(shape.w_pct) <= 5;
  return isSmall ? harmonizeAccentColor(hex, visualProfile.secondary || visualProfile.accent) : hex;
}

function resolveCustomTextColor(source, zone = {}, visualProfile = null, fallback = THEME.NEUTRAL_TITLE) {
  const original = normalizeHexColor(source);
  const base = normalizeHexColor(fallback) || THEME.NEUTRAL_TITLE;
  if (zone.color === "light" && (!original || relativeLuminance(original) < 0.72)) return THEME.WHITE;
  if (!original) return base;
  if (!visualProfile || !isAccentColor(original)) return original;
  const target = (zone.type === "title" || zone.type === "kpi")
    ? visualProfile.accent : (visualProfile.secondary || visualProfile.accent);
  return harmonizeAccentColor(original, target) || original;
}

function resolveCustomFontFace(source, visualProfile = null) {
  return visualProfile?.fontFace || THEME.FONT_FACE || String(source || "").trim() || "Calibri";
}

function clampFontSize(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function resolveCustomFontSize(zone = {}, boxH = 0, fallback = 13) {
  const type = zone.type || "text_block";
  if (type === "title") {
    const byBox = Math.floor((Number(boxH) || 1) * 16);
    return clampFontSize(Math.max(24, Math.min(34, byBox || fallback)), 22, 34);
  }
  if (type === "subtitle") {
    const byBox = Math.floor((Number(boxH) || 1) * 13);
    return clampFontSize(Math.max(14, Math.min(20, byBox || fallback)), 13, 20);
  }
  if (type === "kpi") {
    const byBox = Math.floor((Number(boxH) || 1) * 30);
    return clampFontSize(Math.max(30, Math.min(56, byBox || fallback)), 28, 56);
  }
  if (type === "bullets") return 13;
  return 13;
}

function resolveCustomLabelFontSize(boxH = 0) {
  const byBox = Math.floor((Number(boxH) || 1) * 10);
  return clampFontSize(byBox || 12, 11, 14);
}

function resolveCustomBold(zone = {}, source = {}) {
  if (zone.type === "title" || zone.type === "kpi") return true;
  return false;
}

function resolveCustomItalic(zone = {}, source = {}) {
  return false;
}

function resolveDecorativeTextStyle(shape = {}, visualProfile = null) {
  return {
    fontSize: clampFontSize(Number(shape.fontSize) || 10, 8, 14),
    color: (typeof resolveCustomTextColor === "function")
      ? resolveCustomTextColor(shape.color, { type: "text_block", color: "dark" }, visualProfile, THEME.NEUTRAL_BODY)
      : (normalizeHexColor(shape.color) || THEME.NEUTRAL_BODY),
    bold: false,
    italic: false,
    fontFace: resolveCustomFontFace(shape.fontFace, visualProfile),
  };
}

/**
 * Standard content-slide header: thin accent rule under a large title.
 */
function renderHeader(slide, title, opts = {}) {
  const { onDark = false } = opts;
  const titleColor = onDark ? THEME.WHITE : THEME.NEUTRAL_TITLE;
  addTextbox(slide, title, SIDE_PAD, TITLE_Y, SLIDE_W - SIDE_PAD * 2, TITLE_H, {
    fontSize: 32, color: titleColor, bold: true,
  });
  addRule(slide, SIDE_PAD, RULE_Y, 1.0, THEME.ACCENT, 0.05);
}

function splitTitle(title) {
  if (!title || title.length <= 22) return [title || ""];
  const mid = Math.floor(title.length / 2);
  const left = title.lastIndexOf(" ", mid + 5);
  const right = title.indexOf(" ", mid - 5);
  const cut = Math.abs(mid - left) <= Math.abs(mid - right) ? left : right;
  if (cut <= 0) return [title];
  return [title.slice(0, cut).trim(), title.slice(cut).trim()];
}

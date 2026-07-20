// build_deck — validates a plan against the V1 contract and renders it
// via pptxgenjs. Returns a Promise<Blob> (the .pptx file content).
// LAYOUT_REGISTRY + registerLayout are declared in theme.js so layout
// files loaded before this one can already register.

// Custom layouts are identified by the `custom:` prefix; their definition
// is loaded from the repository JSON store via custom_layouts.js.
function isCustomLayout(name) {
  if (typeof name !== "string") return false;
  if (name.startsWith("custom:")) return true;
  return typeof isAssetCustomLayout === "function" && isAssetCustomLayout(name);
}

function isStructuralRoleLayout(name, role) {
  if (role === "title"   && name === "title")   return true;
  if (role === "closing" && name === "closing") return true;
  if (typeof isAssetStructuralRoleLayout === "function" && isAssetStructuralRoleLayout(name, role)) {
    return true;
  }
  if (typeof isStructuralRoleCustomLayout === "function") {
    return isStructuralRoleCustomLayout(name, role);
  }
  return false;
}

function _presentZoneValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function _coerceCustomZoneValue(zone, value) {
  if (!_presentZoneValue(value)) return undefined;
  if (zone.type === "bullets") {
    if (Array.isArray(value)) {
      const items = value.filter(item => typeof item === "string" && item.trim());
      return items.length ? items : undefined;
    }
    if (typeof value === "string" || typeof value === "number") return [String(value)];
    return undefined;
  }
  if (zone.type === "image") {
    return typeof value === "string" && /^photo:[A-Za-z0-9_-]+$/.test(value)
      ? value : undefined;
  }
  return (typeof value === "string" || typeof value === "number") ? value : undefined;
}

/** Normalize a custom slide against the layout's exact repository keys. */
function repairCustomSlideZones(spec, definition) {
  if (!spec || !definition || !Array.isArray(definition.zones)) return spec;
  const sourceZones = spec.zones && typeof spec.zones === "object" && !Array.isArray(spec.zones)
    ? spec.zones : {};
  const expected = new Set(definition.zones.map(zone => zone.label));
  const consumed = new Set();
  const tokens = [];
  const addToken = (key, value) => {
    if (_presentZoneValue(value)) tokens.push({ key, value });
  };

  for (const [key, value] of Object.entries(sourceZones)) {
    if (!expected.has(key)) addToken(`zones:${key}`, value);
  }
  for (const key of ["title", "subtitle", "message", "cta", "heading", "body", "content", "text", "value", "image", "photo"]) {
    addToken(`spec:${key}`, spec[key]);
  }

  const aliasesByType = {
    title: ["title", "heading"],
    subtitle: ["subtitle", "message"],
    bullets: ["bullets", "body", "content", "message"],
    kpi: ["kpi", "value", "message", "title"],
    image: ["image", "photo"],
    text_block: ["body", "content", "text", "message", "subtitle", "cta", "title"],
  };
  const takeToken = (zone) => {
    const aliases = aliasesByType[zone.type] || aliasesByType.text_block;
    const preferred = tokens.find(token => !consumed.has(token.key)
      && aliases.some(alias => token.key.endsWith(`:${alias}`))
      && _coerceCustomZoneValue(zone, token.value) !== undefined);
    const token = preferred || tokens.find(candidate => !consumed.has(candidate.key)
      && _coerceCustomZoneValue(zone, candidate.value) !== undefined);
    if (!token) return undefined;
    consumed.add(token.key);
    return _coerceCustomZoneValue(zone, token.value);
  };

  const zones = {};
  for (const zone of definition.zones) {
    const exact = _coerceCustomZoneValue(zone, sourceZones[zone.label]);
    if (exact !== undefined) {
      zones[zone.label] = exact;
      continue;
    }
    const mapped = takeToken(zone);
    if (mapped !== undefined) zones[zone.label] = mapped;
    else if (zone.type === "bullets") zones[zone.label] = ["To be defined"];
    else if (zone.type !== "image") zones[zone.label] = "To be defined";
  }
  return { ...spec, zones };
}

/**
 * Silently fix structural mistakes the synth agent occasionally makes.
 * Returns a repaired deep copy and never mutates the caller's value.
 * Called before validatePlan so validation always passes for these
 * specific rules — the generator doesn't waste a round-trip.
 */
function repairPlan(plan) {
  if (!Array.isArray(plan) || plan.length < 2) return plan;
  plan = JSON.parse(JSON.stringify(plan));
  plan.forEach(spec => {
    if (spec && typeof spec === "object") delete spec.breadcrumb;
  });

  const pickStructural = (typeof pickActiveStructuralCustom === "function")
    ? pickActiveStructuralCustom : () => null;

  // --- Slide 0 — title role.
  // If the user has at least one active custom marked structural-title,
  // it wins over the built-in. The agents always emit `layout: "title"`
  // for slide 1 (per their prompts), so the substitution is post-hoc.
  const first = plan[0];
  if (first) {
    const titleCustom = pickStructural("title");
    if (titleCustom) {
      const title    = first.title    || first.heading    || "Presentation";
      const subtitle = first.subtitle || "";
      plan[0] = {
        layout: "custom:" + titleCustom.id,
        title,
        ...(subtitle ? { subtitle } : {}),
        zones: first.zones && typeof first.zones === "object" ? { ...first.zones } : {},
      };
    } else if (typeof pickActiveStructuralAsset === "function" && pickActiveStructuralAsset("title")) {
      const titleAsset = pickActiveStructuralAsset("title");
      const title    = first.title    || first.heading || "Presentation";
      const subtitle = first.subtitle || "";
      if (first.layout !== titleAsset.id) plan[0] = { layout: titleAsset.id, title, subtitle };
    } else if (first.layout !== "title") {
      const title    = first.title    || first.heading || "Presentation";
      const subtitle = first.subtitle || "";
      plan[0] = { layout: "title", title, subtitle };
    }
  }

  // --- Slide N-1 — closing role.
  const lastIdx = plan.length - 1;
  const last = plan[lastIdx];
  if (last) {
    const closingCustom = pickStructural("closing");
    if (closingCustom) {
      const title   = last.title   || "Thank you";
      const message = last.message || last.subtitle || "";
      plan[lastIdx] = {
        layout: "custom:" + closingCustom.id,
        title,
        ...(message ? { message } : {}),
        ...(last.cta ? { cta: last.cta } : {}),
        zones: last.zones && typeof last.zones === "object" ? { ...last.zones } : {},
      };
    } else if (typeof pickActiveStructuralAsset === "function" && pickActiveStructuralAsset("closing")) {
      const closingAsset = pickActiveStructuralAsset("closing");
      const title   = last.title   || "Thank you";
      const message = last.message || last.subtitle || "";
      if (last.layout !== closingAsset.id) {
        const out = { layout: closingAsset.id, title };
        if (message) out.message = message;
        if (last.cta) out.cta = last.cta;
        plan[lastIdx] = out;
      }
    } else if (last.layout !== "closing") {
      const title   = last.title   || "Thank you";
      const message = last.message || last.subtitle || "";
      const out = { layout: "closing", title };
      if (message) out.message = message;
      if (last.cta) out.cta = last.cta;
      plan[lastIdx] = out;
    }
  }

  plan = plan.map(spec => {
    if (!spec || typeof spec.layout !== "string" || !spec.layout.startsWith("custom:")) return spec;
    const definition = typeof getCustomLayoutById === "function"
      ? getCustomLayoutById(spec.layout.slice("custom:".length)) : null;
    return definition ? repairCustomSlideZones(spec, definition) : spec;
  });

  return plan;
}

function validatePlan(plan, context = {}) {
  if (!window.PPTGen?.contracts) throw new Error("Module de contrats indisponible");
  return window.PPTGen.contracts.validatePlan(plan, context);
}

// Stamp a build step on an error so the UI can tell the user *where* the
// deck rendering failed (validate / preload / renderer / slide / export).
// The original message and stack are preserved — we only attach metadata.
function tagStage(err, stage, extra = {}) {
  if (err && typeof err === "object") {
    err.stage = stage;
    if (extra.slideIndex !== undefined) err.slideIndex = extra.slideIndex;
    if (extra.layout !== undefined)     err.layout    = extra.layout;
  }
  return err;
}

/**
 * Build the deck. Returns a Promise<Blob>.
 * @param {Array} plan  - validated slide specs.
 * @param {string} [filename] - suggested name passed to saveAs.
 */
async function buildDeck(plan, filename = "deck.pptx") {
  try {
    validatePlan(plan);
  } catch (e) { throw tagStage(e, "validate"); }

  // Preload every icon/logo referenced by the plan as base64 data URLs.
  // pptxgenjs on file:// can't XHR-fetch relative paths; the cache feeds
  // it inline `data:` blobs instead.
  try {
    await preloadPlanAssets(plan);
  } catch (e) { throw tagStage(e, "preload"); }

  const pres = new PptxGenJS();
  pres._pptgenVisualProfile = (typeof buildDeckVisualProfile === "function")
    ? buildDeckVisualProfile(plan) : null;
  pres.layout = "LAYOUT_WIDE";   // 13.333 x 7.5 — built-in 16:9.

  for (let i = 0; i < plan.length; i++) {
    const spec = plan[i];
    let render;
    if (isCustomLayout(spec.layout)) {
      render = (typeof layoutCustom === "function") ? layoutCustom : null;
    } else {
      render = LAYOUT_REGISTRY[spec.layout];
    }
    if (!render) {
      throw tagStage(
        new Error(`slide ${i + 1}: no renderer for layout '${spec.layout}'`),
        "renderer",
        { slideIndex: i + 1, layout: spec.layout }
      );
    }
    const slide = pres.addSlide();
    try {
      render(slide, spec, pres);

      if (typeof spec.speakerNotes === "string" && spec.speakerNotes.trim()) {
        slide.addNotes(spec.speakerNotes);
      }
    } catch (e) {
      throw tagStage(e, "slide", { slideIndex: i + 1, layout: spec.layout });
    }
  }

  // pptxgenjs → Blob for browser download
  try {
    const blob = await pres.write({ outputType: "blob" });
    return { blob, filename };
  } catch (e) { throw tagStage(e, "export"); }
}

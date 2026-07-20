(function initContracts(global) {
  "use strict";

  const PPTGen = global.PPTGen = global.PPTGen || {};
  const CARDS_CAP = 2;
  const MAX_LAYOUT_SHARE = 0.40;
  const SHARE_CHECK_MIN = 7;
  const MIN_DISTINCT_LAYOUTS = 3;
  const MAX_SPEAKER_NOTES_LENGTH = 1200;

  function actualType(value) {
    if (Array.isArray(value)) return "array";
    if (value === null) return "null";
    if (Number.isInteger(value)) return "integer";
    return typeof value;
  }

  function matchesType(value, expected) {
    const types = Array.isArray(expected) ? expected : [expected];
    return types.some(type => {
      if (type === "number") return typeof value === "number" && Number.isFinite(value);
      if (type === "integer") return Number.isInteger(value);
      if (type === "array") return Array.isArray(value);
      if (type === "object") return !!value && typeof value === "object" && !Array.isArray(value);
      return typeof value === type;
    });
  }

  function validateValue(value, schema, path, errors) {
    if (!schema || typeof schema !== "object") return;
    if (schema.type && !matchesType(value, schema.type)) {
      errors.push(`${path}: invalid type ${actualType(value)} (expected ${[].concat(schema.type).join("|")})`);
      return;
    }
    if (typeof value === "string") {
      if (schema.minLength !== undefined && value.trim().length < schema.minLength) {
        errors.push(`${path}: text too short`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path}: text too long`);
      }
      if (schema.pattern) {
        try { if (!(new RegExp(schema.pattern)).test(value)) errors.push(`${path}: invalid format`); }
        catch { errors.push(`${path}: invalid schema pattern`); }
      }
    }
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: value not allowed`);
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: at least ${schema.minItems} item(s)`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: at most ${schema.maxItems} item(s)`);
      if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`, errors));
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const properties = schema.properties || {};
      for (const key of schema.required || []) {
        if (value[key] === undefined || value[key] === null || value[key] === "") {
          errors.push(`${path}.${key}: missing required field`);
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        if (value[key] !== undefined) validateValue(value[key], child, `${path}.${key}`, errors);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key}: unknown field`);
        }
      }
    }
  }

  function layoutDefinition(layout) {
    if (typeof layout !== "string") return null;
    if (layout.startsWith("custom:")) {
      return typeof global.getCustomLayoutById === "function"
        ? global.getCustomLayoutById(layout.slice(7)) : null;
    }
    return typeof global.getAssetLayoutMeta === "function" ? global.getAssetLayoutMeta(layout) : null;
  }

  function validateCustomSlide(spec, definition, path, errors) {
    const allowed = new Set(["layout", "title", "subtitle", "message", "cta", "zones", "speakerNotes"]);
    for (const key of Object.keys(spec)) if (!allowed.has(key)) errors.push(`${path}.${key}: unknown field`);
    if (!spec.zones || typeof spec.zones !== "object" || Array.isArray(spec.zones)) {
      errors.push(`${path}.zones: object required`);
      return;
    }
    const expectedLabels = new Set(definition.zones.map(zone => zone.label));
    for (const zone of definition.zones) {
      const value = spec.zones[zone.label];
      const zonePath = `${path}.zones.${zone.label}`;
      if (value === undefined || value === null || value === "") {
        errors.push(`${zonePath}: missing required zone`);
      } else if (zone.type === "bullets") {
        if (!Array.isArray(value) || value.some(item => typeof item !== "string")) errors.push(`${zonePath}: expected an array of strings`);
      } else if (zone.type === "image") {
        if (typeof value !== "string" || !/^photo:[A-Za-z0-9_-]+$/.test(value)) errors.push(`${zonePath}: expected photo:<id> reference`);
      } else if (typeof value !== "string" && typeof value !== "number") {
        errors.push(`${zonePath}: expected text`);
      }
    }
    for (const label of Object.keys(spec.zones)) if (!expectedLabels.has(label)) errors.push(`${path}.zones.${label}: unknown zone`);
  }

  function validateSlideMetadata(spec, path, errors) {
    if (spec.speakerNotes === undefined) return;
    if (typeof spec.speakerNotes !== "string") {
      errors.push(`${path}.speakerNotes: expected text`);
      return;
    }
    if (spec.speakerNotes.length > MAX_SPEAKER_NOTES_LENGTH) {
      errors.push(`${path}.speakerNotes: text too long`);
    }
  }

  function collectPhotoRefs(value, refs, seen = new Set()) {
    if (typeof value === "string" && /^photo:[A-Za-z0-9_-]+$/.test(value)) refs.add(value);
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) value.forEach(item => collectPhotoRefs(item, refs, seen));
    else Object.values(value).forEach(item => collectPhotoRefs(item, refs, seen));
  }

  function collectIconRefs(value, refs, key = "", seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const [childKey, child] of Object.entries(value)) {
      if (/icon/i.test(childKey) && typeof child === "string") refs.add(child);
      else collectIconRefs(child, refs, childKey, seen);
    }
  }

  function collectSelectionIssues(context = {}) {
    const errors = [];
    const warnings = [];
    const expectedSlideCount = context.expectedSlideCount;
    const enabledSource = context.enabledLayouts;
    if (!Number.isInteger(expectedSlideCount) || !enabledSource) {
      return { errors, warnings, contentLayoutCount: 0, requiredContentLayouts: 0 };
    }

    const enabledLayouts = [...new Set(Array.from(enabledSource).filter(layout => typeof layout === "string"))];
    const roleCheck = typeof global.isStructuralRoleLayout === "function"
      ? global.isStructuralRoleLayout
      : (layout, role) => {
          const definition = layoutDefinition(layout);
          return layout === role || (definition?.category === "structural" && definition.structural_role === role);
        };
    const isStructural = layout => {
      const definition = layoutDefinition(layout);
      return definition?.category === "structural"
        || roleCheck(layout, "title") || roleCheck(layout, "closing");
    };

    if (!enabledLayouts.some(layout => roleCheck(layout, "title"))) {
      errors.push("selection: no active structural title layout");
    }
    if (!enabledLayouts.some(layout => roleCheck(layout, "closing"))) {
      errors.push("selection: no active structural closing layout");
    }

    const contentSlides = Math.max(0, expectedSlideCount - 2);
    const contentLayouts = enabledLayouts.filter(layout => layoutDefinition(layout) && !isStructural(layout));
    const uniqueLayoutsPerDeck = context.uniqueLayoutsPerDeck === true;
    let requiredContentLayouts = uniqueLayoutsPerDeck ? contentSlides : (contentSlides > 1 ? 2 : contentSlides);
    if (!uniqueLayoutsPerDeck && contentSlides >= 5) requiredContentLayouts = Math.max(requiredContentLayouts, MIN_DISTINCT_LAYOUTS);
    if (!uniqueLayoutsPerDeck && contentSlides >= SHARE_CHECK_MIN) {
      const perLayoutCapacity = Math.floor(contentSlides * MAX_LAYOUT_SHARE);
      if (perLayoutCapacity > 0) {
        requiredContentLayouts = Math.max(requiredContentLayouts, Math.ceil(contentSlides / perLayoutCapacity));
      }
    }
    if (contentLayouts.length < requiredContentLayouts) {
      const prefix = uniqueLayoutsPerDeck ? "selection: unique layout mode" : "selection";
      errors.push(`${prefix}: ${requiredContentLayouts} distinct content layouts required for ${expectedSlideCount} slides, ${contentLayouts.length} active`);
    }

    // Photos are a hard placement requirement: with none of the enabled
    // layouts able to hold an image, generation can never validate.
    const requiredPhotoCount = Number.isInteger(context.requiredPhotoCount) ? context.requiredPhotoCount : 0;
    if (requiredPhotoCount > 0) {
      const supportsImage = layout => {
        const definition = layoutDefinition(layout);
        if (!definition) return false;
        if (Array.isArray(definition.zones) && definition.zones.some(zone => zone.type === "image")) return true;
        return !!definition.schema?.properties?.image;
      };
      if (!enabledLayouts.some(supportsImage)) {
        errors.push(`selection: ${requiredPhotoCount} required photo(s) but no enabled layout can hold an image — enable photo_hero or split_image_text (or a custom layout with an image zone), or remove the photos`);
      }
    }
    return { errors, warnings, contentLayoutCount: contentLayouts.length, requiredContentLayouts };
  }

  function collectPlanIssues(plan, context = {}) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(plan)) return { errors: ["plan: expected an array"], warnings };
    if (plan.length < 4) errors.push(`plan: at least 4 slides required (got ${plan.length})`);
    if (Number.isInteger(context.expectedSlideCount) && plan.length !== context.expectedSlideCount) {
      errors.push(`plan: expected ${context.expectedSlideCount} slides, got ${plan.length}`);
    }
    const enabledLayouts = context.enabledLayouts || (typeof global.LayoutSelection !== "undefined" ? global.LayoutSelection : null);
    const enabledIcons = context.enabledIcons || (typeof global.IconSelection !== "undefined" ? global.IconSelection : null);
    const isStructuralRole = typeof global.isStructuralRoleLayout === "function"
      ? global.isStructuralRoleLayout : (layout, role) => layout === role;
    if (plan.length && !isStructuralRole(plan[0]?.layout, "title")) errors.push("slide 1: structural title layout required");
    if (plan.length && !isStructuralRole(plan[plan.length - 1]?.layout, "closing")) errors.push(`slide ${plan.length}: structural closing layout required`);

    const iconRefs = new Set();
    for (let index = 0; index < plan.length; index++) {
      const spec = plan[index];
      const path = `slide ${index + 1}`;
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
        errors.push(`${path}: expected an object`);
        continue;
      }
      if (typeof spec.layout !== "string" || !spec.layout) {
        errors.push(`${path}.layout: missing required field`);
        continue;
      }
      const definition = layoutDefinition(spec.layout);
      if (!definition) {
        errors.push(`${path}.layout: unknown layout "${spec.layout}"`);
        continue;
      }
      if (enabledLayouts && !enabledLayouts.has?.(spec.layout) && !Array.from(enabledLayouts).includes(spec.layout)) {
        errors.push(`${path}.layout: disabled layout "${spec.layout}"`);
      }
      validateSlideMetadata(spec, path, errors);
      if (spec.layout.startsWith("custom:") || definition.renderer?.type === "custom") {
        validateCustomSlide(spec, definition, path, errors);
      } else {
        const payload = { ...spec };
        delete payload.layout;
        delete payload.speakerNotes;
        validateValue(payload, definition.schema, path, errors);
        if (spec.layout === "chart_bar" && Array.isArray(spec.categories) && Array.isArray(spec.values)
            && spec.categories.length !== spec.values.length) {
          errors.push(`${path}: categories and values must have the same length`);
        }
      }
      collectIconRefs(spec, iconRefs);
    }

    if (context.uniqueLayoutsPerDeck === true) {
      const layoutCounts = {};
      for (const spec of plan) if (spec?.layout) layoutCounts[spec.layout] = (layoutCounts[spec.layout] || 0) + 1;
      for (const [layout, count] of Object.entries(layoutCounts)) {
        if (count > 1) errors.push(`layout_unique_repetition: layout "${layout}" used ${count} times`);
      }
    }

    if (enabledIcons) {
      for (const icon of iconRefs) {
        if (!enabledIcons.has?.(icon) && !Array.from(enabledIcons).includes(icon)) warnings.push(`disabled icon "${icon}"`);
      }
    }
    const photoRefs = new Set();
    collectPhotoRefs(plan, photoRefs);
    for (const id of context.requiredPhotoIds || []) {
      const ref = String(id).startsWith("photo:") ? String(id) : `photo:${id}`;
      if (!photoRefs.has(ref)) errors.push(`required photo unused "${ref}"`);
    }

    const content = plan.slice(1, -1).filter(Boolean);
    const counts = {};
    for (const spec of content) if (spec.layout) counts[spec.layout] = (counts[spec.layout] || 0) + 1;
    if ((counts.cards || 0) > CARDS_CAP) errors.push(`cards_cap_exceeded: ${counts.cards} utilisations (maximum ${CARDS_CAP})`);
    if (content.length >= SHARE_CHECK_MIN && Object.keys(counts).length) {
      const maxShare = Math.max(...Object.values(counts)) / content.length;
      if (maxShare > MAX_LAYOUT_SHARE) errors.push(`layout_repetition: part maximale ${Math.round(maxShare * 100)}%`);
    }
    if (content.length >= 5 && Object.keys(counts).length < MIN_DISTINCT_LAYOUTS) errors.push(`layout_monotony: at least ${MIN_DISTINCT_LAYOUTS} distinct layouts required`);
    for (let index = 1; index < content.length; index++) {
      if (content[index].layout === content[index - 1].layout) errors.push(`slides ${index + 1} and ${index + 2}: identical consecutive layouts`);
    }
    return { errors, warnings };
  }

  function validatePlan(plan, context = {}) {
    const issues = collectPlanIssues(plan, context);
    if (issues.errors.length) {
      const error = new Error(issues.errors.join("\n"));
      error.issues = issues;
      throw error;
    }
    return issues;
  }

  PPTGen.contracts = { collectPlanIssues, collectSelectionIssues, validatePlan, validateValue };
})(window);


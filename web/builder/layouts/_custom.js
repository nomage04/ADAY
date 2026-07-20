// _custom — renderer for user-uploaded layouts.
//
// Spec shape:
//   { layout: "custom:<id>",
//     title: "...",        // optional (mapped to any zone of type "title")
//     zones: { <zone_label>: <string|list> } }
//
// The custom layout definition (image + zone boxes) comes from
// customs/layouts/<id>.json. At render time we:
//   1) paint the stored image full-bleed as background
//   2) walk each declared zone and place text on top of it
//
// Supported zone types: title, subtitle, bullets, text_block, kpi.

function layoutCustom(slide, spec, pres = {}) {
  const id = spec.layout.startsWith("custom:")
    ? spec.layout.slice("custom:".length)
    : spec.layout;
  const def = (typeof getCustomLayoutById === "function")
    ? getCustomLayoutById(id) : null;
  const visualProfile = (typeof resolveSlideVisualProfile === "function")
    ? resolveSlideVisualProfile(spec, pres._pptgenVisualProfile) : null;
  if (!def) {
    // Shouldn't happen: build_deck validation catches missing customs.
    paintBg(slide, THEME.LIGHT_BG);
    addTextbox(slide, `[custom layout ${id} not found]`,
               0.5, 0.5, SLIDE_W - 1, 1, {
      fontSize: 18, color: THEME.CAT_RED, bold: true, align: "center",
    });
    return;
  }

  // 1) Background
  //
  // Two flows are supported:
  //   A) `source === "pptx"` → the layout was imported from a real slide.
  //      We DON'T bake the source slide's content into a PNG (that would
  //      cause ghost overlap under the agent's new text). Instead we
  //      redraw the decorative shapes (logos, lower-page navigation, colored boxes)
  //      on a fresh canvas — zones are drawn on top in step 2.
  //   B) `imageDataUrl` set (legacy: image + vision flow, or old .pptx
  //      imports). Paint the stored image full-bleed, as before.
  if (def.source === "pptx" && Array.isArray(def.background?.shapes)) {
    paintBg(slide, THEME.WHITE);
    for (const s of def.background.shapes) {
      const x = (s.x_pct / 100) * SLIDE_W;
      const y = (s.y_pct / 100) * SLIDE_H;
      const w = (s.w_pct / 100) * SLIDE_W;
      const h = (s.h_pct / 100) * SLIDE_H;
      if (w <= 0 || h <= 0) continue;
      if (s.kind === "image" && s.dataUrl) {
        try {
          slide.addImage({
            data: s.dataUrl,
            x, y, w, h,
            sizing: { type: "cover", w, h },
          });
        } catch (e) { console.warn("custom bg image failed", e); }
      } else if (s.kind === "shape") {
        if (s.fill) {
          const fill = (typeof harmonizeDecorativeShapeFill === "function")
            ? harmonizeDecorativeShapeFill(s.fill, s, visualProfile)
            : _hexNoHash(s.fill);
          addRect(slide, x, y, w, h, fill);
        }
      } else if (s.kind === "oval") {
        if (s.fill) {
          const fill = (typeof harmonizeDecorativeShapeFill === "function")
            ? harmonizeDecorativeShapeFill(s.fill, s, visualProfile)
            : _hexNoHash(s.fill);
          addOval(slide, x, y, w, h, fill);
        }
      } else if (s.kind === "text" && s.text) {
        const textStyle = (typeof resolveDecorativeTextStyle === "function")
          ? resolveDecorativeTextStyle(s, visualProfile)
          : {
              fontSize: Math.max(8, Math.min(14, Number(s.fontSize) || 10)),
              color: s.color ? _hexNoHash(s.color) : THEME.NEUTRAL_BODY,
              bold: false,
              italic: false,
              fontFace: s.fontFace || "Calibri",
            };
        addTextbox(slide, s.text, x, y, w, h, {
          fontSize: textStyle.fontSize,
          color: textStyle.color,
          bold:     textStyle.bold,
          italic:   textStyle.italic,
          fontFace: textStyle.fontFace,
          align:    s.align || "left",
          valign:   "middle",
        });
      }
    }
  } else if (def.imageDataUrl) {
    slide.addImage({
      data: def.imageDataUrl,
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      sizing: { type: "cover", w: SLIDE_W, h: SLIDE_H },
    });
  } else {
    paintBg(slide, THEME.LIGHT_BG);
  }

  // 2) zones — match by label first (exact), then by type if label missing
  //    so the LLM can emit either shape.
  const zoneData = spec.zones || {};
  for (const zone of def.zones) {
    let text = zoneData[zone.label];
    // Structural-role fallbacks — when the layout plays a title or closing
    // slot, repairPlan stuffs the standard fields (title/subtitle/message/
    // cta) into spec.zones, but legacy callers may pass them flat. These
    // fallbacks let the renderer pull from spec.* if the corresponding
    // zone wasn't filled by label.
    if (text == null && zone.type === "title"    && spec.title)    text = spec.title;
    if (text == null && zone.type === "subtitle" && spec.subtitle) text = spec.subtitle;
    if (text == null && zone.label === "subtitle" && spec.subtitle) text = spec.subtitle;
    if (text == null && zone.label === "message"  && spec.message)  text = spec.message;
    if (text == null && zone.label === "cta"      && spec.cta)      text = spec.cta;
    // Hard fallback: any zone the LLM didn't fill still gets SOMETHING
    // drawn so the slide never ships a blank hole. The user explicitly
    // asked for this: empty zones must still show placeholder text.
    if (text == null || text === "") {
      if (zone.type === "image") continue;          // skip image fallback
      if (zone.type === "bullets") text = ["To be defined"];
      else                          text = "To be defined";
    }

    const x = (zone.x_pct / 100) * SLIDE_W;
    const y = (zone.y_pct / 100) * SLIDE_H;
    const w = (zone.w_pct / 100) * SLIDE_W;
    const h = (zone.h_pct / 100) * SLIDE_H;

    // For .pptx-imported layouts we carry the source shape's typography
    // in zone.style. When present, it takes precedence over the legacy
    // heuristics so the new text inherits the original slide's tone.
    const st = zone.style || {};
    const themeColor = zone.color === "light" ? THEME.WHITE : THEME.NEUTRAL_TITLE;
    const color    = (typeof resolveCustomTextColor === "function")
      ? resolveCustomTextColor(st.color, zone, visualProfile, themeColor)
      : (st.color ? _hexNoHash(st.color) : themeColor);
    const align    = st.align || zone.align || "left";
    const fontFace = (typeof resolveCustomFontFace === "function")
      ? resolveCustomFontFace(st.fontFace, visualProfile)
      : (st.fontFace || "Calibri");
    const fontSize = (typeof resolveCustomFontSize === "function")
      ? resolveCustomFontSize(zone, h, st.fontSize || 13)
      : (st.fontSize || 13);
    const bold = (typeof resolveCustomBold === "function")
      ? resolveCustomBold(zone, st) : !!st.bold;
    const italic = (typeof resolveCustomItalic === "function")
      ? resolveCustomItalic(zone, st) : !!st.italic;

    if (zone.type === "image") {
      const src = (typeof resolveImageSource === "function")
        ? resolveImageSource(text) : null;
      if (src) {
        slide.addImage({
          data: src, x, y, w, h,
          sizing: { type: "cover", w, h },
        });
      } else {
        addRect(slide, x, y, w, h, THEME.CARD_BG);
        addTextbox(slide, "[ photo manquante ]", x, y + h / 2 - 0.2, w, 0.4, {
          fontSize: 12, color: THEME.NEUTRAL_BODY, align: "center",
        });
      }
    } else if (zone.type === "bullets" && Array.isArray(text)) {
      addBulletList(slide, text.slice(0, MAX_BULLETS), x, y, w, h, {
        fontSize,
        color,
        bold,
        fontFace,
      });
    } else if (zone.type === "kpi") {
      const lines = String(text).split("\n");
      const value = lines[0];
      const label = lines.slice(1).join(" ");
      addTextbox(slide, value, x, y, w, h * 0.6, {
        fontSize,
        color,
        bold,
        italic, fontFace, align, valign: "middle",
      });
      if (label) {
        addTextbox(slide, label, x, y + h * 0.6, w, h * 0.4, {
          fontSize: typeof resolveCustomLabelFontSize === "function" ? resolveCustomLabelFontSize(h * 0.4) : 14,
          color, align, fontFace, valign: "top",
        });
      }
    } else if (zone.type === "title") {
      addTextbox(slide, String(text), x, y, w, h, {
        fontSize,
        color,
        bold,
        italic, fontFace, align, valign: "middle",
      });
    } else if (zone.type === "subtitle") {
      addTextbox(slide, String(text), x, y, w, h, {
        fontSize,
        color,
        bold, italic, fontFace, align, valign: "middle",
      });
    } else {
      addTextbox(slide, String(text), x, y, w, h, {
        fontSize,
        color,
        bold, italic, fontFace, align, valign: "top",
      });
    }
  }
}

function _hexNoHash(v) {
  return String(v || "").replace(/^#/, "").toUpperCase();
}

// We don't register_layout("custom", ...) because it's dispatched dynamically
// in build_deck for any `custom:*` prefix. Expose the function globally so
// build_deck can find it.
window.layoutCustom = layoutCustom;

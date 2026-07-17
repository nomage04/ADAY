// photo_hero — full-bleed image with an overlay title bar on top.
// spec: { title, image: "photo:<id>"|dataUrl, caption? }

function layoutPhotoHero(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);

  const src = resolveImageSource(spec.image);
  if (src) {
    slide.addImage({
      data: src,
      x: 0, y: 0, w: SLIDE_W, h: 5.8,
      sizing: { type: "cover", w: SLIDE_W, h: 5.8 },
    });
  } else {
    addRect(slide, 0, 0, SLIDE_W, 5.8, THEME.CARD_BG);
    addTextbox(slide, "[ image manquante ]", 0, 2.5, SLIDE_W, 1, {
      fontSize: 16, color: THEME.NEUTRAL_BODY, align: "center",
    });
  }

  // Dark title overlay at the top
  addRect(slide, 0, 0, SLIDE_W, 1.2, THEME.PRIMARY);
  addTextbox(slide, spec.title || "", 0.7, 0.3, SLIDE_W - 1.4, 0.7, {
    fontSize: 32, color: THEME.WHITE, bold: true,
  });
  addRule(slide, 0.7, 1.0, 1.0, THEME.ACCENT, 0.05);

  if (spec.caption) {
    addTextbox(slide, spec.caption, 0.7, 6.0, SLIDE_W - 1.4, 0.6, {
      fontSize: 14, color: THEME.NEUTRAL_BODY, align: "center",
    });
  }
}

// Accept either a user-uploaded photo reference ("photo:<id>") or a raw
// data URL. Other strings (http paths) are ignored in this app because we
// have no way to fetch them under file://.
function resolveImageSource(ref) {
  if (!ref) return null;
  if (typeof ref !== "string") return null;
  if (ref.startsWith("data:")) return ref;
  if (ref.startsWith("photo:") && typeof getPhotoById === "function") {
    const id = ref.slice("photo:".length);
    const p = getPhotoById(id);
    return p ? p.dataUrl : null;
  }
  return null;
}

// expose for other layouts / future renderers
window.resolveImageSource = resolveImageSource;
registerLayout("photo_hero", layoutPhotoHero);

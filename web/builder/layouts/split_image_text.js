// split_image_text — image on the left (50 %), bullets on the right.
// spec: { title, image: "photo:<id>"|dataUrl, bullets: [str] }

function layoutSplitImageText(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const src = resolveImageSource(spec.image);
  if (src) {
    slide.addImage({
      data: src,
      x: 0.7, y: 1.9, w: 5.8, h: 4.6,
      sizing: { type: "cover", w: 5.8, h: 4.6 },
    });
  } else {
    addRect(slide, 0.7, 1.9, 5.8, 4.6, THEME.CARD_BG);
    addTextbox(slide, "[ image manquante ]", 0.7, 3.9, 5.8, 0.8, {
      fontSize: 16, color: THEME.NEUTRAL_BODY, align: "center",
    });
  }

  addBulletList(slide, spec.bullets || [], 6.8, 2.1, 5.8, 4.2, {
    fontSize: 16, color: THEME.NEUTRAL_TITLE,
  });
}

registerLayout("split_image_text", layoutSplitImageText);

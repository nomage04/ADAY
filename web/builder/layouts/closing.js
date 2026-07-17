// closing — dark bg, big thank-you, optional message + cta.

function layoutClosing(slide, spec) {
  paintBg(slide, THEME.PRIMARY);
  const cx = SLIDE_W / 2;
  const w = SLIDE_W - 2.4;
  addTextbox(slide, spec.title || "Merci", 1.2, 2.2, w, 1.2, {
    fontSize: 48, color: THEME.WHITE, bold: true, align: "center",
  });
  addRule(slide, cx - 0.75, 3.7, 1.5, THEME.ACCENT, 0.06);
  if (spec.message) {
    addTextbox(slide, spec.message, 1.2, 4.0, w, 0.9, {
      fontSize: 18, color: THEME.NEUTRAL_LIGHT, align: "center",
    });
  }
  if (spec.cta) {
    addTextbox(slide, spec.cta, 1.2, 5.2, w, 0.6, {
      fontSize: 14, color: THEME.NEUTRAL_LIGHT, bold: true, align: "center",
    });
  }
}

registerLayout("closing", layoutClosing);

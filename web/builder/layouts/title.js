// title — dark teal bg with accent stripe on the right.

function layoutTitle(slide, spec /*, pres */) {
  paintBg(slide, THEME.PRIMARY);
  const stripeW = 4.0;
  addRect(slide, SLIDE_W - stripeW, 0, stripeW, SLIDE_H, THEME.ACCENT);

  const titleX = 1.0;
  const titleW = SLIDE_W - stripeW - 1.5;

  const lines = splitTitle(spec.title || "");
  addTextbox(slide, lines[0], titleX, 1.8, titleW, 1.2, {
    fontSize: 48, color: THEME.WHITE, bold: true,
  });
  let ruleTop = 3.2;
  if (lines.length > 1) {
    addTextbox(slide, lines[1], titleX, 2.9, titleW, 1.2, {
      fontSize: 48, color: THEME.WHITE, bold: true,
    });
    ruleTop = 4.3;
  }
  addRule(slide, titleX, ruleTop, 1.5, THEME.ACCENT, 0.06);

  if (spec.subtitle) {
    addTextbox(slide, spec.subtitle, titleX, ruleTop + 0.3, titleW, 0.7, {
      fontSize: 16, color: THEME.NEUTRAL_LIGHT,
    });
  }
  if (spec.role) {
    addTextbox(slide, spec.role, titleX, ruleTop + 1.1, titleW, 0.5, {
      fontSize: 18, color: THEME.NEUTRAL_LIGHT, bold: true,
    });
  }
  if (spec.attribution) {
    addTextbox(slide, spec.attribution, titleX, 6.3, titleW, 0.5, {
      fontSize: 11, color: THEME.NEUTRAL_LIGHT,
    });
  }
}

registerLayout("title", layoutTitle);

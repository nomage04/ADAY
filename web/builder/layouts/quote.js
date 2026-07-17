// quote — editorial pull-quote with optional attribution.

function layoutQuote(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  addRect(slide, 1.2, 2.2, 0.08, 3.2, THEME.ACCENT);
  addOval(slide, 1.45, 2.15, 0.28, 0.28, THEME.ACCENT);
  addTextbox(slide, spec.quote || "", 1.9, 2.2, SLIDE_W - 2.6, 3.0, {
    fontSize: 26, color: THEME.NEUTRAL_TITLE, italic: true,
  });
  if (spec.attribution) {
    addRule(slide, 1.9, 5.4, 1.0, THEME.ACCENT, 0.04);
    addTextbox(slide, spec.attribution, 1.9, 5.55, SLIDE_W - 2.6, 0.5, {
      fontSize: 14, color: THEME.NEUTRAL_BODY, bold: true,
    });
  }
}

registerLayout("quote", layoutQuote);

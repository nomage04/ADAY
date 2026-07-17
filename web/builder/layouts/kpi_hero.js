// kpi_hero — one colossal number centered, with label + optional sublabel.

function layoutKpiHero(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  // backdrop circle
  addOval(slide, 4.17, 2.2, 5.0, 3.8, THEME.CARD_BG);
  addTextbox(slide, spec.value || "", 1.0, 2.7, SLIDE_W - 2.0, 2.5, {
    fontSize: 120, color: THEME.ACCENT, bold: true, align: "center", valign: "middle",
  });
  addTextbox(slide, spec.label || "", 1.0, 5.3, SLIDE_W - 2.0, 0.6, {
    fontSize: 22, color: THEME.NEUTRAL_TITLE, bold: true, align: "center",
  });
  if (spec.sublabel) {
    addTextbox(slide, spec.sublabel, 1.0, 5.95, SLIDE_W - 2.0, 0.5, {
      fontSize: 14, color: THEME.NEUTRAL_BODY, align: "center",
    });
  }
}

registerLayout("kpi_hero", layoutKpiHero);

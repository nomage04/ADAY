// compare_two — 50/50 split with heading + bullets per side.

function layoutCompareTwo(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const mid = SLIDE_W / 2;
  const colW = 5.5;
  const colH = 4.6;
  const y = 1.9;
  const gap = 0.3;

  function panel(x, data, color) {
    addRect(slide, x, y, colW, colH, THEME.CARD_BG);
    addRule(slide, x, y, colW, color, 0.08);
    addTextbox(slide, data?.heading || "", x + 0.2, y + 0.25, colW - 0.4, 0.55, {
      fontSize: 22, color, bold: true,
    });
    addBulletList(slide, data?.bullets || [], x + 0.2, y + 1.0, colW - 0.4, colH - 1.3, {
      fontSize: 14, color: THEME.NEUTRAL_TITLE,
    });
  }

  panel(0.7, spec.left, THEME.CAT_ORANGE);
  panel(mid + gap, spec.right, THEME.CAT_GREEN);
}

registerLayout("compare_two", layoutCompareTwo);

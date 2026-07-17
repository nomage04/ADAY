// stats — compact KPI row of 2..4 value+label blocks.

function layoutStats(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const stats = (spec.stats || []).slice(0, 4);
  const n = stats.length;
  if (n === 0) return;

  const gutter = 0.25;
  const totalW = SLIDE_W - 2 * SIDE_PAD;
  const blockW = (totalW - gutter * (n - 1)) / n;
  const y = 2.4;

  stats.forEach((s, i) => {
    const x = SIDE_PAD + i * (blockW + gutter);
    const color = CATEGORY_ACCENTS[i % CATEGORY_ACCENTS.length];
    addRect(slide, x, y, blockW, 3.2, THEME.CARD_BG);
    addRule(slide, x, y, blockW, color, 0.06);
    addTextbox(slide, s.value || "", x, y + 0.7, blockW, 1.3, {
      fontSize: 54, color, bold: true, align: "center",
    });
    addTextbox(slide, s.label || "", x + 0.15, y + 2.2, blockW - 0.3, 0.8, {
      fontSize: 13, color: THEME.NEUTRAL_TITLE, align: "center",
    });
  });
}

registerLayout("stats", layoutStats);

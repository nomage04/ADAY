// big_stats — 1..3 hero KPIs with optional icon and caption.

function layoutBigStats(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const stats = (spec.stats || []).slice(0, 3);
  const n = stats.length;
  if (n === 0) return;

  const gutter = 0.4;
  const totalW = SLIDE_W - 2 * SIDE_PAD;
  const blockW = (totalW - gutter * (n - 1)) / n;
  const y = 2.2;

  stats.forEach((s, i) => {
    const x = SIDE_PAD + i * (blockW + gutter);
    const color = CATEGORY_ACCENTS[i % CATEGORY_ACCENTS.length];
    addRect(slide, x, y, blockW, 4.2, THEME.CARD_BG);
    addRule(slide, x, y, blockW, color, 0.08);
    let ty = y + 0.3;
    if (s.icon && ALLOWED_ICONS.has(s.icon)) {
      addIcon(slide, s.icon, x + blockW / 2 - 0.35, ty, 0.7);
      ty += 1.0;
    }
    addTextbox(slide, s.value || "", x, ty, blockW, 1.2, {
      fontSize: 64, color, bold: true, align: "center",
    });
    addTextbox(slide, s.label || "", x + 0.2, ty + 1.4, blockW - 0.4, 0.5, {
      fontSize: 16, color: THEME.NEUTRAL_TITLE, bold: true, align: "center",
    });
    if (s.caption) {
      addTextbox(slide, s.caption, x + 0.2, ty + 2.0, blockW - 0.4, 0.9, {
        fontSize: 12, color: THEME.NEUTRAL_BODY, align: "center",
      });
    }
  });
}

registerLayout("big_stats", layoutBigStats);

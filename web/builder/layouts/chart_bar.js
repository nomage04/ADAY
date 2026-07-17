// chart_bar — simple vertical bars using rectangles (no pptxgenjs chart).
// 3..6 bars on the left half, commentary bullets on the right.

function layoutChartBar(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const cats = (spec.categories || []).slice(0, 6);
  const vals = (spec.values || []).slice(0, 6);
  const n = Math.min(cats.length, vals.length);

  const chartX = 0.9, chartY = 2.2, chartW = 6.5, chartH = 4.3;
  addRect(slide, chartX, chartY, chartW, chartH, THEME.CARD_BG);
  addRule(slide, chartX, chartY + chartH - 0.05, chartW, THEME.NEUTRAL_MUTED, 0.02);

  if (n > 0) {
    const barGap = 0.25;
    const barW = (chartW - barGap * (n + 1)) / n;
    const maxVal = Math.max(...vals.slice(0, n), 1);
    for (let i = 0; i < n; i++) {
      const h = 3.6 * (vals[i] / maxVal);
      const x = chartX + barGap + i * (barW + barGap);
      const y = chartY + chartH - 0.4 - h;
      const color = CATEGORY_ACCENTS[i % CATEGORY_ACCENTS.length];
      addRect(slide, x, y, barW, h, color);
      addTextbox(slide, String(vals[i]), x, y - 0.35, barW, 0.3, {
        fontSize: 11, color: THEME.NEUTRAL_TITLE, bold: true, align: "center",
      });
      addTextbox(slide, cats[i], x, chartY + chartH - 0.32, barW, 0.3, {
        fontSize: 10, color: THEME.NEUTRAL_BODY, align: "center",
      });
    }
  }

  addBulletList(slide, spec.commentary || [], 7.6, 2.3, 5.0, 4.2, {
    fontSize: 14, color: THEME.NEUTRAL_TITLE,
  });
}

registerLayout("chart_bar", layoutChartBar);

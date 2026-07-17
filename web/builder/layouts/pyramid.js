// pyramid — 3..5 horizontal trapezoid bands (widest on top).

function layoutPyramid(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const levels = (spec.levels || []).slice(0, 5);
  const n = Math.min(Math.max(levels.length, 3), 5);
  const baseW = 9.0;
  const rowH = 4.4 / n;
  const topY = 2.0;

  for (let i = 0; i < n; i++) {
    const bandW = baseW - i * 0.9;
    const x = (SLIDE_W - bandW) / 2;
    const color = CATEGORY_ACCENTS[i % CATEGORY_ACCENTS.length];
    slide.addShape("trapezoid", {
      x, y: topY + i * rowH, w: bandW, h: rowH - 0.05,
      fill: { color }, line: { type: "none" },
    });
    addTextbox(slide, levels[i]?.label || "", x, topY + i * rowH + rowH / 2 - 0.2,
               bandW, 0.5, {
                 fontSize: 16, color: THEME.WHITE, bold: true, align: "center",
               });
  }
}

registerLayout("pyramid", layoutPyramid);

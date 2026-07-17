// funnel — conversion funnel, 3..5 shrinking horizontal bands.

function layoutFunnel(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const stages = (spec.stages || []).slice(0, 5);
  const n = Math.min(Math.max(stages.length, 3), 5);
  const topY = 2.0;
  const rowH = 4.4 / n;
  const baseW = 10.0;

  for (let i = 0; i < n; i++) {
    const bandW = Math.max(2.0, baseW - i * 1.3);
    const x = (SLIDE_W - bandW) / 2;
    const color = CATEGORY_ACCENTS[i % CATEGORY_ACCENTS.length];
    addRect(slide, x, topY + i * rowH, bandW, rowH - 0.08, color);
    const label = stages[i]?.label || "";
    const metric = stages[i]?.metric || "";
    const combined = [label, metric].filter(Boolean).join("  —  ");
    addTextbox(slide, combined, x + 0.4, topY + i * rowH + rowH / 2 - 0.18,
               bandW - 0.8, 0.4, {
                 fontSize: 15, color: THEME.WHITE, bold: true, align: "center",
               });
  }
}

registerLayout("funnel", layoutFunnel);

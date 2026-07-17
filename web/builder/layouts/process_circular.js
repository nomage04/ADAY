// process_circular — 4..6 nodes arranged in a circle around a center label.

function layoutProcessCircular(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const steps = (spec.steps || []).slice(0, 6);
  const n = Math.min(Math.max(steps.length, 4), 6);
  const cx = SLIDE_W / 2, cy = 4.4;
  const r = 2.2, node = 1.1;

  for (let i = 0; i < n; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const nx = cx + r * Math.cos(theta) - node / 2;
    const ny = cy + r * Math.sin(theta) - node / 2;
    const color = CATEGORY_ACCENTS[i % CATEGORY_ACCENTS.length];
    addOval(slide, nx, ny, node, node, color);
    addTextbox(slide, String(i + 1), nx, ny + 0.25, node, 0.5, {
      fontSize: 22, color: THEME.WHITE, bold: true, align: "center",
    });
    const lx = Math.max(0.1, cx + (r + 1.1) * Math.cos(theta) - 1.2);
    const ly = Math.max(1.9, cy + (r + 1.1) * Math.sin(theta) - 0.25);
    addTextbox(slide, steps[i]?.label || "", lx, ly, 2.4, 0.5, {
      fontSize: 12, color: THEME.NEUTRAL_TITLE, bold: true, align: "center",
    });
  }

  addOval(slide, cx - 0.9, cy - 0.55, 1.8, 1.1, THEME.ACCENT);
  addTextbox(slide, spec.center || "Cycle", cx - 0.9, cy - 0.25, 1.8, 0.5, {
    fontSize: 14, color: THEME.WHITE, bold: true, align: "center",
  });
}

registerLayout("process_circular", layoutProcessCircular);

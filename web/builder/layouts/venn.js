// venn — 2 or 3 overlapping circles with labels.

function layoutVenn(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const sets = (spec.sets || []).slice(0, 3);
  const n = Math.min(Math.max(sets.length, 2), 3);
  const r = 2.1, cy = 4.2;
  let cxs = [SLIDE_W / 2 - r * 0.6, SLIDE_W / 2 + r * 0.6, SLIDE_W / 2];
  let cys = [cy, cy, cy + r * 0.55];
  if (n === 3) {
    cxs = [SLIDE_W / 2 - r * 0.7, SLIDE_W / 2 + r * 0.7, SLIDE_W / 2];
    cys = [cy - r * 0.35, cy - r * 0.35, cy + r * 0.55];
  }

  for (let i = 0; i < n; i++) {
    const color = CATEGORY_ACCENTS[i % CATEGORY_ACCENTS.length];
    addOval(slide, cxs[i] - r, cys[i] - r, r * 2, r * 2, color);
    addTextbox(slide, sets[i]?.label || "",
               cxs[i] - 1.5, cys[i] - 1.8 - (i === 2 ? 0.1 : 0),
               3.0, 0.4, {
                 fontSize: 16, color: THEME.WHITE, bold: true, align: "center",
               });
  }
  if (spec.intersection) {
    addTextbox(slide, spec.intersection, SLIDE_W / 2 - 1.5, cy - 0.2, 3.0, 0.4, {
      fontSize: 13, color: THEME.WHITE, bold: true, align: "center",
    });
  }
}

registerLayout("venn", layoutVenn);

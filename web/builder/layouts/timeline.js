// timeline — 3..5 steps in a horizontal row with numbered circles.

function layoutTimeline(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const steps = (spec.steps || []).slice(0, 5);
  const n = steps.length;
  if (n === 0) return;

  const y = 2.5;
  const totalW = SLIDE_W - 2 * SIDE_PAD;
  const slotW = totalW / n;

  // axis rule
  addRule(slide, SIDE_PAD + slotW / 2, y + 0.35, totalW - slotW, THEME.ACCENT, 0.04);

  steps.forEach((s, i) => {
    const cx = SIDE_PAD + slotW * (i + 0.5);
    const color = CATEGORY_ACCENTS[i % CATEGORY_ACCENTS.length];
    addOval(slide, cx - 0.4, y, 0.8, 0.8, color);
    addTextbox(slide, String(i + 1), cx - 0.4, y + 0.15, 0.8, 0.5, {
      fontSize: 22, color: THEME.WHITE, bold: true, align: "center",
    });
    addTextbox(slide, s.title || "", cx - slotW / 2 + 0.1, y + 1.0,
               slotW - 0.2, 0.5, {
                 fontSize: 15, color: THEME.NEUTRAL_TITLE, bold: true, align: "center",
               });
    addTextbox(slide, s.body || "", cx - slotW / 2 + 0.2, y + 1.55,
               slotW - 0.4, 2.4, {
                 fontSize: 12, color: THEME.NEUTRAL_BODY, align: "center",
               });
  });
}

registerLayout("timeline", layoutTimeline);

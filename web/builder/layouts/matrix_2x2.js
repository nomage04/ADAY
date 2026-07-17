// matrix_2x2 — BCG-style quadrant.
// spec: { axes: {x: [neg, pos], y: [neg, pos]}, items: [{quadrant, label}] }

function layoutMatrix2x2(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const ox = 2.5, oy = 2.2, W = 8.5, H = 4.4;
  const midX = ox + W / 2, midY = oy + H / 2;

  const fills = { tl: THEME.CARD_BG, tr: "EBF3ED", bl: "F3EBE7", br: THEME.CARD_BG };
  const cells = {
    tl: [ox, oy], tr: [midX, oy], bl: [ox, midY], br: [midX, midY],
  };
  for (const [q, [x, y]] of Object.entries(cells)) {
    addRect(slide, x, y, W / 2, H / 2, fills[q]);
  }
  // axes
  addRule(slide, ox, midY, W, THEME.NEUTRAL_MUTED, 0.02);
  addRect(slide, midX - 0.01, oy, 0.02, H, THEME.NEUTRAL_MUTED);

  const axes = spec.axes || { x: ["-", "+"], y: ["-", "+"] };
  addTextbox(slide, axes.x?.[0] || "", ox - 0.1, midY - 0.3, 2.2, 0.3,
             { fontSize: 11, color: THEME.NEUTRAL_BODY, bold: true });
  addTextbox(slide, axes.x?.[1] || "", ox + W - 2.1, midY - 0.3, 2.2, 0.3,
             { fontSize: 11, color: THEME.NEUTRAL_BODY, bold: true, align: "right" });
  addTextbox(slide, axes.y?.[1] || "", midX + 0.1, oy - 0.35, 2.0, 0.3,
             { fontSize: 11, color: THEME.NEUTRAL_BODY, bold: true });
  addTextbox(slide, axes.y?.[0] || "", midX + 0.1, oy + H + 0.05, 2.0, 0.3,
             { fontSize: 11, color: THEME.NEUTRAL_BODY, bold: true });

  // items
  const offs = {
    tl: [ox + 0.4, oy + 0.4],
    tr: [midX + 0.4, oy + 0.4],
    bl: [ox + 0.4, midY + 0.4],
    br: [midX + 0.4, midY + 0.4],
  };
  for (const item of (spec.items || []).slice(0, 8)) {
    const q = item.quadrant;
    if (!offs[q]) continue;
    const [lx, ly] = offs[q];
    const color = CATEGORY_ACCENTS[Math.abs(hashStr(item.label || "")) % 4];
    addOval(slide, lx, ly, 0.35, 0.35, color);
    addTextbox(slide, item.label || "", lx + 0.5, ly, 3.2, 0.35, {
      fontSize: 12, color: THEME.NEUTRAL_TITLE, bold: true,
    });
    offs[q] = [lx, ly + 0.5];
  }
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

registerLayout("matrix_2x2", layoutMatrix2x2);

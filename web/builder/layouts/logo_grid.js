// logo_grid — 3..8 tools arranged in a 2x4 grid with logo + name + caption.

function layoutLogoGrid(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const tools = (spec.tools || []).slice(0, 8);
  const n = tools.length;
  if (n === 0) return;

  const cols = n > 4 ? 4 : n;
  const rows = Math.ceil(n / cols);
  const gap = 0.25;
  const totalW = SLIDE_W - 2 * SIDE_PAD;
  const cellW = (totalW - gap * (cols - 1)) / cols;
  const cellH = (4.7 - gap * (rows - 1)) / rows;
  const oy = 1.95;

  tools.forEach((t, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = SIDE_PAD + c * (cellW + gap);
    const y = oy + r * (cellH + gap);
    addRect(slide, x, y, cellW, cellH, THEME.CARD_BG);

    const logoSize = Math.min(1.1, cellH - 1.0);
    const logoX = x + cellW / 2 - logoSize / 2;
    const logoY = y + 0.3;
    const ok = t.logo && addLogo(slide, t.logo, logoX, logoY, logoSize, logoSize);
    if (!ok) {
      addLogoFallback(slide, t.name || "?", logoX, logoY, logoSize, logoSize, i);
    }

    addTextbox(slide, t.name || "", x, y + logoSize + 0.4, cellW, 0.4, {
      fontSize: 13, color: THEME.NEUTRAL_TITLE, bold: true, align: "center",
    });
    if (t.caption) {
      addTextbox(slide, t.caption, x, y + logoSize + 0.8, cellW, 0.4, {
        fontSize: 10, color: THEME.NEUTRAL_BODY, align: "center",
      });
    }
  });
}

registerLayout("logo_grid", layoutLogoGrid);

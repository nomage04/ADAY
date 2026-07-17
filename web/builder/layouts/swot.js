// swot — 2x2 with fixed color convention.

function layoutSwot(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const data = [
    ["Forces",         THEME.CAT_GREEN,      spec.strengths     || []],
    ["Faiblesses",     THEME.CAT_ORANGE,     spec.weaknesses    || []],
    ["Opportunités",   THEME.CAT_DARK_GREEN, spec.opportunities || []],
    ["Menaces",        THEME.CAT_RED,        spec.threats       || []],
  ];
  const cells = [[0.7, 2.0], [6.85, 2.0], [0.7, 4.4], [6.85, 4.4]];

  for (let i = 0; i < 4; i++) {
    const [x, y] = cells[i];
    const [heading, color, bullets] = data[i];
    addRect(slide, x, y, 5.8, 2.3, THEME.CARD_BG);
    addRect(slide, x, y, 5.8, 0.5, color);
    addTextbox(slide, heading, x, y + 0.1, 5.8, 0.35, {
      fontSize: 14, color: THEME.WHITE, bold: true, align: "center",
    });
    if (bullets.length) {
      addBulletList(slide, bullets.slice(0, 4), x + 0.2, y + 0.65, 5.4, 1.6, {
        fontSize: 11, color: THEME.NEUTRAL_TITLE,
      });
    }
  }
}

registerLayout("swot", layoutSwot);

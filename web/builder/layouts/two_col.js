// two_col — left column + right column, each with heading + bullets + optional icon.

function layoutTwoCol(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const colW = (SLIDE_W - 2 * SIDE_PAD - 0.4) / 2;
  const y = CONTENT_TOP;
  const h = 4.6;

  function column(x, title, bullets, icon, color) {
    addRect(slide, x, y, colW, h, THEME.CARD_BG);
    addRule(slide, x, y, colW, color, 0.08);
    let ty = y + 0.25;
    if (icon && ALLOWED_ICONS.has(icon)) {
      addIcon(slide, icon, x + 0.2, ty, 0.55);
      addTextbox(slide, title || "", x + 0.95, ty, colW - 1.1, 0.55, {
        fontSize: 20, color, bold: true,
      });
    } else {
      addTextbox(slide, title || "", x + 0.2, ty, colW - 0.4, 0.55, {
        fontSize: 20, color, bold: true,
      });
    }
    addBulletList(slide, bullets, x + 0.2, ty + 0.8, colW - 0.4, h - 1.1, {
      fontSize: 14, color: THEME.NEUTRAL_TITLE,
    });
  }

  column(SIDE_PAD, spec.left_title, spec.left_bullets, spec.left_icon, THEME.CAT_ORANGE);
  column(SIDE_PAD + colW + 0.4, spec.right_title, spec.right_bullets, spec.right_icon, THEME.CAT_GREEN);
}

registerLayout("two_col", layoutTwoCol);

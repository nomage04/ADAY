// cards — 2..4 beige cards with colored top-strip, title, body, optional icon.

function layoutCards(slide, spec) {
  paintBg(slide, THEME.LIGHT_BG);
  renderHeader(slide, spec.title);

  const cards = (spec.cards || []).slice(0, 4);
  const n = cards.length;
  if (n === 0) return;

  const gutter = 0.3;
  const totalW = SLIDE_W - 2 * SIDE_PAD;
  const cardW = (totalW - gutter * (n - 1)) / n;
  const cardH = 4.3;
  const y = CONTENT_TOP;

  cards.forEach((card, i) => {
    const x = SIDE_PAD + i * (cardW + gutter);
    const color = CATEGORY_ACCENTS[i % CATEGORY_ACCENTS.length];
    addRect(slide, x, y, cardW, cardH, THEME.CARD_BG);
    addRule(slide, x, y, cardW, color, 0.06);
    let textY = y + 0.25;

    if (card.icon && ALLOWED_ICONS.has(card.icon)) {
      addIcon(slide, card.icon, x + 0.2, textY, 0.6);
      textY += 0.1;
    }
    addTextbox(slide, card.title || "", x + 0.2, textY + 0.6, cardW - 0.4, 0.5, {
      fontSize: 18, color, bold: true,
    });
    addTextbox(slide, card.body || "", x + 0.2, textY + 1.25, cardW - 0.4, cardH - 1.5, {
      fontSize: 13, color: THEME.NEUTRAL_TITLE,
    });
  });
}

registerLayout("cards", layoutCards);

// Theme constants + layout registry — loaded FIRST, before any layout file
// calls registerLayout().

// Registry populated by each layout file at load time.
const LAYOUT_REGISTRY = {};
function registerLayout(name, renderFn) { LAYOUT_REGISTRY[name] = renderFn; }

// Theme constants — teal palette. Values are hex strings because
// pptxgenjs takes colors as hex ("00915A") without leading '#'.

const THEME = {
  // Primary / structural
  PRIMARY:        "1A3C34",   // dark teal (title bg)
  ACCENT:         "00915A",   // green accent (rules)
  ACCENT_2:       "2D6B3F",
  ACCENT_3:       "1E4D42",

  // Category accents — cycled across cards / steps / stats
  CAT_GREEN:      "00915A",
  CAT_ORANGE:     "E67E22",
  CAT_DARK_GREEN: "006B42",
  CAT_RED:        "D63031",

  // Neutrals
  NEUTRAL_TITLE:  "1A1A1A",
  NEUTRAL_BODY:   "666666",
  NEUTRAL_MUTED:  "999999",
  NEUTRAL_LIGHT:  "B0C4B0",
  WHITE:          "FFFFFF",
  CARD_BG:        "F0F0EB",
  LIGHT_BG:       "FAFAF7",

  // Typography
  FONT_FACE:      "Calibri",
};

const CATEGORY_ACCENTS = [
  THEME.CAT_GREEN, THEME.CAT_ORANGE, THEME.CAT_DARK_GREEN, THEME.CAT_RED,
];

// Slide canvas — 16:9 (inches).
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

// Grid
const SIDE_PAD = 0.7;
const TITLE_Y = 0.5;
const TITLE_H = 0.7;
const RULE_Y = 1.25;
const CONTENT_TOP = 1.8;

// Typography caps
const MIN_BODY_PT = 10;
const MIN_TITLE_PT = 20;
const MAX_BULLETS = 6;

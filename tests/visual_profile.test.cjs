const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzoAAAAASUVORK5CYII=";

class FakeSlide {
  constructor() {
    this.shapes = [];
    this.texts = [];
    this.images = [];
  }
  addShape(type, opts) { this.shapes.push({ type, opts }); }
  addText(text, opts) { this.texts.push({ text, opts }); }
  addImage(opts) { this.images.push(opts); }
}

function boot(files = ["builder/theme.js", "builder/primitives.js"]) {
  const context = { console, window: null };
  context.window = context;
  vm.createContext(context);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(WEB, file), "utf8"), context, { filename: file });
  }
  return context;
}

test("deck primitives expose no generated footer renderer", () => {
  const context = boot();
  assert.equal(vm.runInContext("typeof renderBreadcrumb", context), "undefined");
  assert.equal(vm.runInContext("typeof FOOTER_Y", context), "undefined");
  assert.equal(vm.runInContext("THEME.FOOTER_BG", context), undefined);
});

test("custom renderer preserves imported footer artifacts and harmonizes simple styles", () => {
  const context = boot(["builder/theme.js", "builder/primitives.js", "builder/layouts/_custom.js"]);
  const definition = {
    id: "body",
    source: "pptx",
    background: {
      shapes: [
        { kind: "image", x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100, dataUrl: PIXEL },
        { kind: "text", text: "OLD FOOTER", x_pct: 4, y_pct: 90, w_pct: 30, h_pct: 4, color: "FF0000", fontFace: "Papyrus" },
        { kind: "shape", x_pct: 72, y_pct: 88, w_pct: 12, h_pct: 4, fill: "FF0000" },
        { kind: "shape", x_pct: 8, y_pct: 12, w_pct: 3, h_pct: 3, fill: "FF0000" },
      ],
    },
    zones: [
      {
        label: "headline",
        type: "title",
        x_pct: 10,
        y_pct: 18,
        w_pct: 80,
        h_pct: 12,
        style: { color: "FF0000", fontFace: "Comic Sans MS", fontSize: 30, bold: true },
      },
    ],
  };
  context.getCustomLayoutById = () => definition;

  const slide = new FakeSlide();
  const deckProfile = {
    accent: "00915A",
    secondary: "2D6B3F",
    fontFace: "Calibri",
    layouts: {
      "custom:body": {
        accent: "FF0000",
        secondary: "FF0000",
        fontFace: "Comic Sans MS",
        colors: ["FF0000"],
      },
    },
  };

  context.layoutCustom(
    slide,
    { layout: "custom:body", title: "New", zones: { headline: "New title" } },
    { _pptgenVisualProfile: deckProfile },
  );

  assert.equal(slide.images.length, 1, "full-bleed background image should be preserved");
  assert.equal(slide.texts.some(item => item.text === "OLD FOOTER"), true);
  assert.ok(slide.shapes.some(shape => shape.type === "rect" && shape.opts.y > 6.5),
    "expected the imported lower-page decoration to remain");
  const accentShape = slide.shapes.find(shape =>
    shape.type === "rect"
    && shape.opts.fill.color !== "FFFFFF"
    && shape.opts.y < 2
  );
  assert.ok(accentShape, "expected the small decorative shape to remain");
  assert.notEqual(accentShape.opts.fill.color, "FF0000");

  const headline = slide.texts.find(item => item.text === "New title");
  assert.ok(headline, "expected zone text to be rendered");
  assert.equal(headline.opts.fontFace, "Calibri");
  assert.equal(headline.opts.bold, true);
  assert.equal(headline.opts.italic, false);
  assert.ok(headline.opts.fontSize <= 34, `custom title font too large: ${headline.opts.fontSize}`);
});

test("deck planner prompt explicitly asks for visual consistency", () => {
  const source = fs.readFileSync(path.join(WEB, "agents", "deck_planner.js"), "utf8");
  assert.match(source, /Maintain visual consistency/);
  assert.match(source, /visual style summaries in \\`layouts_catalog\\`/);
});

test("deck profile keeps typography uniform and slide accents available", () => {
  const context = boot();
  const definitions = {
    warm: {
      id: "warm",
      background: {
        shapes: [{ kind: "shape", x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100, fill: "B00020" }],
      },
      zones: [
        { label: "headline", type: "title", x_pct: 10, y_pct: 10, w_pct: 80, h_pct: 12, style: { color: "B00020", fontFace: "Papyrus" } },
      ],
    },
    cool: {
      id: "cool",
      background: {
        shapes: [{ kind: "shape", x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100, fill: "0070C0" }],
      },
      zones: [
        { label: "headline", type: "title", x_pct: 10, y_pct: 10, w_pct: 80, h_pct: 12, style: { color: "0070C0", fontFace: "Papyrus" } },
      ],
    },
  };
  context.getCustomLayoutById = id => definitions[id];

  const profile = context.buildDeckVisualProfile([{ layout: "custom:warm" }, { layout: "custom:cool" }]);
  assert.equal(profile.fontFace, "Calibri");
  const warmProfile = context.resolveSlideVisualProfile({ layout: "custom:warm" }, profile);
  const coolProfile = context.resolveSlideVisualProfile({ layout: "custom:cool" }, profile);
  assert.notEqual(warmProfile.accent, coolProfile.accent);
  assert.equal(warmProfile.fontFace, coolProfile.fontFace);
  assert.equal("footerBg" in profile, false);
  assert.equal("footerAccent" in warmProfile, false);
});

test("deck profile keeps slide accents available for custom text", () => {
  const context = boot();
  const definition = {
    id: "body",
    background: {
      shapes: [{ kind: "shape", x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100, fill: "B00020" }],
    },
    zones: [
      { label: "headline", type: "title", x_pct: 10, y_pct: 10, w_pct: 80, h_pct: 12, style: { color: "B00020", fontFace: "Papyrus" } },
    ],
  };
  context.getCustomLayoutById = () => definition;

  const profile = context.buildDeckVisualProfile([{ layout: "custom:body" }]);
  assert.equal(profile.fontFace, "Calibri");
  const slideProfile = context.resolveSlideVisualProfile({ layout: "custom:body" }, profile);
  assert.equal(slideProfile.accent, "B00020");
  assert.equal("footerBg" in slideProfile, false);
});

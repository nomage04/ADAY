import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServer } from "./server_harness.mjs";

const PIXEL_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzoAAAAASUVORK5CYII=";

const server = await startServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const previewLogs = [];
  page.on("console", msg => {
    const text = msg.text();
    if (text.includes("[DeckPreview]")) previewLogs.push(text);
  });
  await page.goto(server.url);
  await page.waitForFunction(() => window.PPTGen?.repoStore?.isAvailable() && window.PPTGen?.previewRenderer);

  const legacyFieldRendered = await page.evaluate(() => {
    const captured = window.PPTGen.previewRenderer.captureSlide([{
      layout: "two_col",
      title: "No generated lower band",
      left_title: "Left",
      left_bullets: ["One"],
      right_title: "Right",
      right_bullets: ["Two"],
      breadcrumb: "LEGACY_FIELD_MUST_NOT_RENDER",
    }], 0);
    return captured.ops.some(op => JSON.stringify(op).includes("LEGACY_FIELD_MUST_NOT_RENDER"));
  });
  assert.equal(legacyFieldRendered, false);

  await page.evaluate(async pixel => {
    await _putCustomLayout({
      id: "preview_custom",
      name: "Preview custom",
      description: "Minimal custom layout for live SVG preview smoke tests.",
      category: "content",
      imageDataUrl: pixel,
      zones: [
        { id: "z0", type: "title", label: "headline", x_pct: 10, y_pct: 12, w_pct: 80, h_pct: 16, align: "center", color: "dark" },
        { id: "z1", type: "bullets", label: "points", x_pct: 18, y_pct: 42, w_pct: 64, h_pct: 24, align: "left", color: "dark" },
      ],
    });

    const plan = [
      { layout: "title", title: "Live SVG Preview", subtitle: "Studio" },
      { layout: "two_col", title: "Two Columns", left_title: "Fast", left_bullets: ["Immediate preview"], right_title: "Accurate", right_bullets: ["Same layout calls"] },
      { layout: "pyramid", title: "Pyramid", levels: [{ label: "Shape one" }, { label: "Shape two" }, { label: "Shape three" }] },
      { layout: "custom:preview_custom", title: "Custom Preview", zones: { headline: "Custom Preview", points: ["Reusable zones", "SVG preview"] } },
      { layout: "closing", title: "Done", message: "Questions" },
    ];
    sessionStorage.setItem("pptgen.currentPlan", JSON.stringify({
      plan,
      display: "",
      warnings: [],
      savedAt: new Date().toISOString(),
    }));
  }, PIXEL_DATA_URL);

  await page.reload();
  await page.waitForSelector("#deckPreviewPanel.is-ready");
  await page.waitForSelector("#deckPreviewStage svg.ppt-live-slide");
  const initialPreviewRenders = previewLogs.filter(text => text.startsWith("[DeckPreview] preview-render ")).length;
  assert.equal(initialPreviewRenders, 1);

  const initial = await page.evaluate(() => ({
    stageSvgs: document.querySelectorAll("#deckPreviewStage svg.ppt-live-slide").length,
    thumbSvgs: document.querySelectorAll("#deckPreviewStrip svg.ppt-live-slide-thumb").length,
    navButtons: document.querySelectorAll("#deckPreviewStage .deck-preview-nav").length,
    stageDots: document.querySelectorAll("#deckPreviewStage .deck-preview-dot").length,
    mockSlides: document.querySelectorAll(".mock-slide").length,
    meta: document.getElementById("deckPreviewMeta").textContent.trim(),
  }));
  assert.deepEqual(initial, { stageSvgs: 1, thumbSvgs: 5, navButtons: 2, stageDots: 5, mockSlides: 0, meta: "1 / 5" });

  const desktopBox = await page.locator("#deckPreviewStage svg.ppt-live-slide").boundingBox();
  assert.ok(desktopBox.width > 250 && desktopBox.height > 140);
  await page.dispatchEvent("#deckPreviewStage .deck-preview-nav-next", "pointerdown", {
    bubbles: true,
    pointerType: "mouse",
    pointerId: 101,
    isPrimary: true,
    button: 0,
  });
  await page.waitForFunction(() => document.getElementById("deckPreviewMeta").textContent.trim() === "2 / 5");
  await page.dispatchEvent("#deckPreviewStage .deck-preview-nav-previous", "pointerdown", {
    bubbles: true,
    pointerType: "mouse",
    pointerId: 102,
    isPrimary: true,
    button: 0,
  });
  await page.waitForFunction(() => document.getElementById("deckPreviewMeta").textContent.trim() === "1 / 5");

  await page.click("#deckPreviewStage .deck-preview-slide-hitbox");
  await page.waitForSelector("#deckPreviewLightbox:not(.hidden)");
  await page.waitForSelector("#deckPreviewLightboxSlide svg.ppt-live-slide");
  assert.equal(await page.locator("#deckPreviewLightboxMeta").innerText(), "1 / 5");
  assert.equal(await page.locator("#deckPreviewLightboxSlide .deck-preview-dot").count(), 5);
  const lightboxBox = await page.locator("#deckPreviewLightboxSlide svg.ppt-live-slide").boundingBox();
  assert.ok(lightboxBox.width > desktopBox.width);

  await page.dispatchEvent("#btnDeckPreviewLightboxNext", "pointerdown", {
    bubbles: true,
    pointerType: "mouse",
    pointerId: 103,
    isPrimary: true,
    button: 0,
  });
  await page.waitForFunction(() => document.getElementById("deckPreviewLightboxMeta").textContent.trim() === "2 / 5");
  await page.waitForFunction(() => document.getElementById("deckPreviewMeta").textContent.trim() === "2 / 5");
  await page.click("#btnDeckPreviewLightboxClickNext");
  await page.waitForFunction(() => document.getElementById("deckPreviewLightboxMeta").textContent.trim() === "3 / 5");
  await page.click("#deckPreviewLightboxSlide .deck-preview-dot:nth-child(5)");
  await page.waitForFunction(() => document.getElementById("deckPreviewLightboxMeta").textContent.trim() === "5 / 5");
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => document.getElementById("deckPreviewLightboxMeta").textContent.trim() === "4 / 5");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("deckPreviewLightbox").classList.contains("hidden"));

  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => document.getElementById("deckPreviewMeta").textContent.trim() === "3 / 5");
  const stageNextBox = await page.locator("#deckPreviewStage .deck-preview-nav-next").boundingBox();
  await page.mouse.click(stageNextBox.x + stageNextBox.width / 2, stageNextBox.y + stageNextBox.height / 2);
  await page.waitForFunction(() => document.getElementById("deckPreviewMeta").textContent.trim() === "4 / 5");
  const stagePrevBox = await page.locator("#deckPreviewStage .deck-preview-nav-previous").boundingBox();
  await page.mouse.click(stagePrevBox.x + stagePrevBox.width / 2, stagePrevBox.y + stagePrevBox.height / 2);
  await page.waitForFunction(() => document.getElementById("deckPreviewMeta").textContent.trim() === "3 / 5");
  await page.click("#deckPreviewStage .deck-preview-dot:nth-child(5)");
  await page.waitForFunction(() => document.getElementById("deckPreviewMeta").textContent.trim() === "5 / 5");

  await page.click("#deckPreviewStrip .deck-preview-thumb:nth-child(3)");
  await page.waitForFunction(() => document.getElementById("deckPreviewMeta").textContent.trim() === "3 / 5");
  const pyramid = await page.evaluate(() => ({
    active: document.querySelector(".deck-preview-thumb.active .deck-preview-thumb-number").textContent.trim(),
    polygons: document.querySelectorAll("#deckPreviewStage svg polygon").length,
    text: document.querySelector("#deckPreviewStage svg").textContent,
  }));
  assert.equal(pyramid.active, "3");
  assert.ok(pyramid.polygons >= 3);
  assert.match(pyramid.text, /Shape one/);

  await page.click("#deckPreviewStrip .deck-preview-thumb:nth-child(4)");
  await page.waitForFunction(() => document.getElementById("deckPreviewMeta").textContent.trim() === "4 / 5");
  const custom = await page.evaluate(() => ({
    active: document.querySelector(".deck-preview-thumb.active .deck-preview-thumb-number").textContent.trim(),
    images: document.querySelectorAll("#deckPreviewStage svg image").length,
    text: document.querySelector("#deckPreviewStage svg").textContent,
  }));
  assert.equal(custom.active, "4");
  assert.ok(custom.images >= 1);
  assert.match(custom.text, /Custom Preview/);
  assert.match(custom.text, /Reusable zones/);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await page.locator("#deckPreviewStage svg.ppt-live-slide").boundingBox();
  assert.ok(mobileBox.width > 250 && mobileBox.height > 135);
  await page.click("#deckPreviewStage .deck-preview-slide-hitbox");
  await page.waitForSelector("#deckPreviewLightbox:not(.hidden)");
  const mobileLightbox = await page.evaluate(() => {
    const card = document.querySelector(".deck-preview-lightbox-card").getBoundingClientRect();
    const head = document.querySelector(".deck-preview-lightbox-head").getBoundingClientRect();
    const next = document.getElementById("btnDeckPreviewLightboxNext").getBoundingClientRect();
    return {
      card: { left: card.left, right: card.right },
      head: { left: head.left, right: head.right },
      next: { right: next.right },
      viewport: { width: window.innerWidth },
    };
  });
  assert.ok(mobileLightbox.card.left >= 0);
  assert.ok(mobileLightbox.head.left >= mobileLightbox.card.left - 1);
  assert.ok(mobileLightbox.head.right <= mobileLightbox.card.right + 1);
  assert.ok(mobileLightbox.next.right <= mobileLightbox.viewport.width);
  await page.click("#btnDeckPreviewLightboxClickPrev");
  await page.waitForFunction(() => document.getElementById("deckPreviewLightboxMeta").textContent.trim() === "3 / 5");
  await page.keyboard.press("Escape");

  console.log("live SVG preview smoke OK");
} finally {
  await browser.close();
  await server.stop();
}

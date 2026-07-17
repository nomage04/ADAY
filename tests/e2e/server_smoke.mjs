import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { startServer } from "./server_harness.mjs";

const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nzoAAAAASUVORK5CYII=", "base64");
const server = await startServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(server.url);
  await page.waitForFunction(() => window.PPTGen?.repoStore?.isAvailable());
  const initial = await page.evaluate(() => ({
    fatal: !!document.querySelector(".asset-pack-fatal"),
    readOnly: !document.getElementById("repoModeBanner").classList.contains("hidden"),
    icons: document.querySelectorAll("#iconGrid .gallery-item").length,
    layouts: document.querySelectorAll("#layoutGrid .layout-item").length,
  }));
  assert.deepEqual(initial, { fatal: false, readOnly: false, icons: 63, layouts: 20 });

  const builtInBytes = await page.evaluate(async () => {
    const plan = [
      { layout: "title", title: "Smoke test", subtitle: "Built-in" },
      { layout: "two_col", title: "Options", left_title: "A", left_bullets: ["One"], right_title: "B", right_bullets: ["Two"] },
      { layout: "quote", title: "Voice", quote: "Keep it simple" },
      { layout: "closing", title: "Thank you", message: "Questions" },
    ];
    return (await buildDeck(plan)).blob.size;
  });
  assert.ok(builtInBytes > 1000);

  // Image + vision flow, with the network agent replaced by a deterministic fixture.
  await page.click("#navTabSettings");
  await page.fill("#apiKey", "session-only-test-key");
  await page.fill("#visionModel", "vision-fixture");
  await page.evaluate(() => {
    window.callVisionAgent = async () => ({
      suggested_name: "Vision fixture",
      suggested_description: "Imported from an image",
      suggested_category: "image",
      suggested_structural_role: null,
      category_confidence: 0.95,
      category_rationale: "dominant image",
      zones: [{ type: "title", label: "headline", x_pct: 10, y_pct: 10, w_pct: 80, h_pct: 20, align: "left", color: "dark" }],
    });
  });
  await page.click("#navTabGallery");
  await page.click("#tabLayouts");
  await page.click("#btnAddCustom");
  await page.click('[data-import="image"]');
  await page.setInputFiles("#customImage", { name: "layout.png", mimeType: "image/png", buffer: PIXEL });
  await page.click("#btnAnalyzeImage");
  await page.waitForSelector("#customStep2:not(.hidden)");
  await page.click("#btnSaveCustom");
  await page.waitForFunction(() => document.querySelectorAll("#layoutGrid .is-custom").length === 1);
  let files = await fs.readdir(path.join(server.dataDir, "layouts"));
  assert.equal(files.length, 1);
  const firstLayout = JSON.parse(await fs.readFile(path.join(server.dataDir, "layouts", files[0]), "utf8"));
  assert.equal(firstLayout.name, "Vision fixture");

  // Build a PPTX fixture in-page, then import one of its slides as a second JSON layout.
  const pptxBase64 = await page.evaluate(async () => {
    const result = await buildDeck([
      { layout: "title", title: "PPTX fixture", subtitle: "Import" },
      { layout: "two_col", title: "Imported slide", left_title: "A", left_bullets: ["One"], right_title: "B", right_bullets: ["Two"] },
      { layout: "quote", title: "Voice", quote: "Hello" },
      { layout: "closing", title: "End", message: "Done" },
    ]);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  });
  await page.click("#btnAddCustom");
  await page.click('[data-import="slide"]');
  await page.setInputFiles("#pptxSlideInput", {
    name: "fixture.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(pptxBase64, "base64"),
  });
  await page.waitForSelector("#importSlideStep2:not(.hidden)", { timeout: 20_000 });
  await page.check('[data-slide-check="2"]');
  await page.evaluate(() => {
    window.analyzeLayoutThumbnail = async () => ({
      description: "Use for a balanced two-column comparison.",
      suggested_category: "content",
      suggested_structural_role: null,
      category_confidence: 0.9,
      category_rationale: "two columns",
    });
  });
  await page.click("#btnImportSelectedSlides");
  await page.waitForSelector('[data-slide-category="2"]');
  await page.click("#btnImportSelectedSlides");
  await page.waitForFunction(() => document.querySelectorAll("#layoutGrid .is-custom").length === 2);
  files = await fs.readdir(path.join(server.dataDir, "layouts"));
  assert.equal(files.length, 2);

  // Restore without reload through the public compatibility API.
  const restored = await page.evaluate(async () => {
    const original = getCustomLayouts()[0];
    await _delCustomLayout(original.id);
    const zip = new JSZip();
    zip.file("_manifest.json", JSON.stringify({ version: 4 }));
    zip.file(`layouts/${original.id}.json`, JSON.stringify(original));
    const blob = await zip.generateAsync({ type: "blob" });
    const report = await importAppBackup([new File([blob], "restore.zip", { type: "application/zip" })]);
    return { report, restored: !!getCustomLayoutById(original.id) };
  });
  assert.equal(restored.restored, true);
  assert.ok(restored.report.imported >= 1);

  // Imported markup remains inert and is rejected by both client and server validation.
  const malicious = await page.evaluate(async () => {
    const response = await fetch("/api/layouts/evil", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evil", name: '<img src=x onerror="alert(1)">', category: "custom", zones: [], script: "alert(1)" }),
    });
    return response.status;
  });
  assert.equal(malicious, 400);

  // Modal keyboard behavior.
  await page.click("#btnAddCustom");
  await page.click('[data-import="image"]');
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("customModal").classList.contains("hidden"));

  const customDeckBytes = await page.evaluate(async () => {
    const custom = getCustomLayouts()[0];
    const key = Object.fromEntries(custom.zones.map(zone => [zone.label, zone.type === "image" ? "" : "Rendered"]));
    const plan = [
      { layout: "title", title: "Custom", subtitle: "Repository" },
      { layout: `custom:${custom.id}`, title: "Custom", zones: key },
      { layout: "quote", title: "Voice", quote: "Custom works" },
      { layout: "closing", title: "Thank you", message: "Questions" },
    ];
    return (await buildDeck(plan)).blob.size;
  });
  assert.ok(customDeckBytes > 1000);
  console.log("localhost repository smoke OK");
} finally {
  await browser.close();
  await server.stop();
}

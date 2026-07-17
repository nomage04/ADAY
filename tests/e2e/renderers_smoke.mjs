import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServer } from "./server_harness.mjs";

const server = await startServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(server.url);
  await page.waitForFunction(() => window.PPTGen?.repoStore?.isAvailable());
  const result = await page.evaluate(async () => {
    const fixture = schema => {
      if (schema.enum) return schema.enum[0];
      if (schema.properties && !schema.type) {
        const value = {};
        for (const key of schema.required || []) value[key] = fixture(schema.properties[key]);
        return value;
      }
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (types.includes("string")) return schema.pattern ? "photo:p1" : "Sample";
      if (types.includes("number") || types.includes("integer")) return 42;
      if (types.includes("array")) return Array.from({ length: schema.minItems || 1 }, () => fixture(schema.items || { type: "string" }));
      if (types.includes("object")) {
        const value = {};
        for (const key of schema.required || []) value[key] = fixture(schema.properties[key]);
        return value;
      }
      return "Sample";
    };
    const order = assetLayoutIds().filter(id => !["title", "closing"].includes(id));
    const plan = [{ layout: "title", ...fixture(getAssetLayoutMeta("title").schema) }];
    for (const id of order) plan.push({ layout: id, ...fixture(getAssetLayoutMeta(id).schema) });
    plan.push({ layout: "closing", ...fixture(getAssetLayoutMeta("closing").schema) });
    plan[1].speakerNotes = "Presenter cue alpha for renderer smoke.";
    const output = await buildDeck(plan);
    const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
    const noteNames = Object.keys(zip.files).filter(name => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
    const noteXml = await Promise.all(noteNames.map(name => zip.file(name).async("string")));
    return {
      count: plan.length,
      bytes: output.blob.size,
      hasSpeakerNotes: noteXml.some(xml => xml.includes("Presenter cue alpha")),
    };
  });
  assert.equal(result.count, 20);
  assert.ok(result.bytes > 5000);
  assert.equal(result.hasSpeakerNotes, true);
  console.log(`all-layout renderer smoke OK (${result.bytes} bytes)`);
} finally {
  await browser.close();
  await server.stop();
}

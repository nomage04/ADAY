const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function boot(files = {}) {
  const context = {
    console,
    TextEncoder,
    Map,
    JSZip: { loadAsync: async () => ({ files }) },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "pptx_parser.js"), "utf8"), context);
  return context;
}

test("rejects oversized compressed PPTX before loading ZIP", async () => {
  const context = boot();
  await assert.rejects(
    context.parsePptxFile({ size: 50 * 1024 * 1024 + 1 }),
    /compressed file > 50 MB/,
  );
});

test("rejects excessive ZIP parts and slide counts before XML parsing", async () => {
  const tooManyEntries = Object.fromEntries(Array.from({ length: 2001 }, (_, index) => [`part-${index}`, {}]));
  await assert.rejects(boot(tooManyEntries).parsePptxFile({ size: 1 }), /more than 2000 ZIP entries/);

  const tooManySlides = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`ppt/slides/slide${index + 1}.xml`, {}]));
  await assert.rejects(boot(tooManySlides).parsePptxFile({ size: 1 }), /more than 100 slides/);
});

test("enforces per-entry and cumulative expanded limits", () => {
  const context = boot();
  const zip = { __pptgenBudget: { expandedBytes: 0, entries: new Map() } };
  assert.throws(() => context._consumePptxBudget(zip, "large.xml", 10 * 1024 * 1024 + 1, 10 * 1024 * 1024), /exceeds the 10 MB limit/);
  context._consumePptxBudget(zip, "a.xml", 125 * 1024 * 1024, 200 * 1024 * 1024);
  assert.throws(() => context._consumePptxBudget(zip, "b.xml", 126 * 1024 * 1024, 200 * 1024 * 1024), /cumulative uncompressed content/);
});


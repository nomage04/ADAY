const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const GENERATED = path.join(ROOT, "web", "asset_pack.generated.js");

function readPack(file = GENERATED) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return context.window.PPT_ASSET_PACK;
}

test("generated asset pack contains every bundled asset", () => {
  const pack = readPack();
  assert.equal(pack.version, 2);
  assert.equal(pack.layoutOrder.length, 20);
  assert.equal(pack.iconOrder.length, 63);
  assert.equal(pack.logoOrder.length, 55);
  assert.equal(Object.keys(pack.layouts).length, 20);
  assert.equal(Object.keys(pack.icons).length, 63);
  assert.equal(Object.keys(pack.logos).length, 55);
  for (const id of pack.layoutOrder) {
    const layout = pack.layouts[id];
    assert.ok(layout.thumbDataUrl.startsWith("data:image/png;base64,"));
    if (layout.renderer.type === "registered") assert.equal(layout.renderer.name, id);
  }
});

test("asset pack generation is deterministic", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pptgen-assets-"));
  const output = path.join(tempDir, "asset_pack.generated.js");
  try {
    const result = spawnSync("python", [
      path.join(ROOT, "tools", "build_asset_pack.py"),
      "--source", path.join(ROOT, "packs", "default"),
      "--out", output,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(output, "utf8"), fs.readFileSync(GENERATED, "utf8"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});


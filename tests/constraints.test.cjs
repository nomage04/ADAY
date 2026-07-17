const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

test("generated browser constraints match the canonical repository contract", () => {
  const expected = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config", "repository_constraints.json"), "utf8")
  );
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "web", "core", "constraints.generated.js"), "utf8"),
    context
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.PPTGen.constraints)),
    expected
  );
});

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const excluded = new Set(["node_modules", ".git", "dist", "build"]);
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excluded.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(full);
  }
}
walk(root);
let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    const details = result.stderr || result.stdout || result.error?.message
      || `node --check failed for ${file}\n`;
    process.stderr.write(String(details));
  }
}
if (failed) process.exit(1);
console.log(`Syntax OK: ${files.length} JavaScript files`);

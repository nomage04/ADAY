"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const listed = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: ROOT, encoding: "utf8" },
).split("\0").filter(Boolean);
const files = [...new Set(listed)]
  .map(file => file.replaceAll("\\", "/"))
  .filter(file => fs.existsSync(path.join(ROOT, file)) && fs.statSync(path.join(ROOT, file)).isFile());

const errors = [];
const fail = message => errors.push(message);
const forbiddenPrefixes = [".local-backups/", ".tmp-capture/", "mcp/"];
const forbiddenExact = new Set([
  ".env.example",
  "DEPLOY_FREE_TUNNEL.md",
  "Plan.md",
  "test-llm.ps1",
  "test_deck.pptx",
  "test_layout.png",
  "ui-vision.html",
]);
const allowedRuntimeFiles = new Set(["customs/.gitignore", "customs/README.md"]);
const allowedRootMarkdown = new Set(["README.md"]);
const forbiddenRootSourceExtensions = new Set([".css", ".html", ".js", ".py"]);

for (const file of files) {
  if (forbiddenPrefixes.some(prefix => file.startsWith(prefix))) fail(`forbidden tracked path: ${file}`);
  if (forbiddenExact.has(file)) fail(`obsolete artifact: ${file}`);
  if (file.startsWith("customs/") && !allowedRuntimeFiles.has(file)) fail(`runtime data must stay ignored: ${file}`);
  if (!file.includes("/") && /\.(?:pptx|png)$/i.test(file)) fail(`root test artifact: ${file}`);
  if (!file.includes("/") && forbiddenRootSourceExtensions.has(path.extname(file).toLowerCase())) {
    fail(`source file must not live at repository root: ${file}`);
  }
  if (!file.includes("/") && path.extname(file).toLowerCase() === ".md" && !allowedRootMarkdown.has(file)) {
    fail(`secondary documentation must live in docs/: ${file}`);
  }
  if (file === "config.local.js" || file === "config/config.local.js") fail(`local secret config must stay ignored: ${file}`);
}

const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".py", ".ps1", ".txt", ".yml", ".yaml"]);
const sourceSurfacePatterns = [
  ["PPTGEN_" + "PUBLIC_HOSTS", "public host environment option"],
  ["PPTGEN_" + "PUBLIC_HOST_SUFFIXES", "public host suffix environment option"],
  ["PPTGEN_" + "BASIC_AUTH", "application Basic Auth option"],
  ["PPTGen." + "mcp", "browser MCP interface"],
  ["/" + "mcp", "MCP endpoint"],
  ["@modelcontextprotocol/" + "sdk", "MCP SDK dependency"],
];
const personalPathPatterns = [
  /[A-Za-z]:\\Users\\[^\\\s]+/,
  /\/Users\/[^/\s]+/,
  /\/home\/[^/\s]+/,
  new RegExp("nomage01" + "-spec", "i"),
];

for (const file of files) {
  const extension = path.extname(file).toLowerCase();
  if (!textExtensions.has(extension) || file === "tools/check_hygiene.cjs"
      || file === "web/asset_pack.generated.js" || file.startsWith("web/lib/")) continue;
  const content = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const pattern of personalPathPatterns) {
    if (pattern.test(content)) fail(`personal path or old account reference in ${file}`);
  }
  for (const [needle, label] of sourceSurfacePatterns) {
    if (content.includes(needle)) fail(`${label} remains in ${file}`);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const packageEntries = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
  ...packageJson.optionalDependencies,
};
for (const dependency of ["@modelcontextprotocol/" + "sdk", "express", "zod"]) {
  if (dependency in packageEntries) fail(`removed dependency remains: ${dependency}`);
}
for (const script of Object.keys(packageJson.scripts || {})) {
  if (/^mcp(?::|$)/i.test(script)) fail(`removed npm script remains: ${script}`);
}

const layoutRoot = path.join(ROOT, "packs", "default", "layouts");
for (const entry of fs.readdirSync(layoutRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const schemaPath = path.join(layoutRoot, entry.name, "layout.json");
  if (!fs.existsSync(schemaPath)) continue;
  const layout = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const schema = layout.schema || {};
  if (schema.required?.includes("breadcrumb") || Object.hasOwn(schema.properties || {}, "breadcrumb")) {
    fail(`legacy breadcrumb contract remains: ${path.relative(ROOT, schemaPath)}`);
  }
}

if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`Repository hygiene OK (${files.length} files inspected).`);

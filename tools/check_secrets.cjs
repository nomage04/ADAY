"use strict";

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const SELF = "tools/check_secrets.cjs";
const skippedPrefixes = ["web/lib/"];
const skippedExact = new Set([SELF, "web/asset_pack.generated.js"]);

const directRules = [
  ["openai-compatible-key", /\bsk-(?:(?:proj|or-v1)-)?[A-Za-z0-9_-]{20,}\b/],
  ["groq-key", /\bgsk_[A-Za-z0-9]{20,}\b/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["slack-token", /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/],
  ["huggingface-token", /\bhf_[A-Za-z0-9]{24,}\b/],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
];
const genericAssignment = /\b(api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key)\b\s*[:=]\s*["']([^"'\r\n]{12,})["']/gi;
const placeholder = /^(?:your|example|sample|test|dummy|replace|change|insert|placeholder|<|\$\{)/i;

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: options.encoding === null ? null : "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isSkipped(file) {
  const normalized = file.replaceAll("\\", "/");
  return skippedExact.has(normalized) || skippedPrefixes.some(prefix => normalized.startsWith(prefix));
}

function scan(content) {
  const matches = new Set();
  for (const [id, pattern] of directRules) {
    if (pattern.test(content)) matches.add(id);
  }
  genericAssignment.lastIndex = 0;
  for (const match of content.matchAll(genericAssignment)) {
    if (!placeholder.test(match[2].trim())) matches.add("generic-secret-assignment");
  }
  return [...matches];
}

function readText(file) {
  const stats = fs.statSync(file);
  if (!stats.isFile() || stats.size > MAX_TEXT_BYTES) return null;
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

const findings = [];
const warnings = [];
const report = (target, rules, destination = findings) => {
  for (const rule of rules) destination.push(`${target} [${rule}]`);
};

const currentFiles = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  .split("\0")
  .filter(Boolean)
  .map(file => file.replaceAll("\\", "/"));

for (const file of new Set(currentFiles)) {
  if (isSkipped(file)) continue;
  const absolute = path.join(ROOT, file);
  if (!fs.existsSync(absolute)) continue;
  const content = readText(absolute);
  if (content !== null) report(`working tree:${file}`, scan(content));
}

const localCandidates = ["config.local.js", "config/config.local.js"];
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (entry.isFile() && /^\.env(?:\.|$)/i.test(entry.name)) localCandidates.push(entry.name);
}
for (const file of new Set(localCandidates)) {
  const absolute = path.join(ROOT, file);
  if (!fs.existsSync(absolute)) continue;
  const content = readText(absolute);
  if (content === null) continue;
  const rules = scan(content);
  if (!rules.length) continue;
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", file], { cwd: ROOT, stdio: "ignore" }).status === 0;
  const ignored = spawnSync("git", ["check-ignore", "-q", "--", file], { cwd: ROOT, stdio: "ignore" }).status === 0;
  report(`${tracked || !ignored ? "unsafe local file" : "ignored local file"}:${file}`, rules, tracked || !ignored ? findings : warnings);
}

const revisions = new Set(git(["rev-list", "--all", "--reflog"]).trim().split(/\r?\n/).filter(Boolean));
for (const revision of process.argv.slice(2)) {
  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error(`Invalid revision argument: ${revision}`);
  revisions.add(revision.toLowerCase());
}

const candidateExpression = "sk-|gsk_|gh[pousr]_|github_pat_|AKIA|ASIA|AIza|xox[baprs]-|hf_|PRIVATE KEY|api.?key|access.?token|client.?secret|secret.?key";
const scannedBlobs = new Set();
for (const revision of revisions) {
  const result = spawnSync(
    "git",
    [
      "grep", "-I", "-i", "-l", "-E", candidateExpression, revision, "--", ".",
      ":(exclude)tools/check_secrets.cjs",
      ":(exclude)asset_pack.generated.js",
      ":(exclude)web/asset_pack.generated.js",
      ":(exclude)lib/**",
      ":(exclude)web/lib/**",
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`Unable to scan Git revision ${revision.slice(0, 12)}.`);
  }
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const prefix = `${revision}:`;
    const file = line.startsWith(prefix) ? line.slice(prefix.length) : line;
    if (isSkipped(file)) continue;
    let blob;
    try {
      blob = git(["rev-parse", `${revision}:${file}`]).trim();
    } catch {
      continue;
    }
    if (scannedBlobs.has(blob)) continue;
    scannedBlobs.add(blob);
    let buffer;
    try {
      buffer = git(["show", `${revision}:${file}`], { encoding: null });
    } catch {
      continue;
    }
    if (buffer.length > MAX_TEXT_BYTES || buffer.includes(0)) continue;
    report(`commit ${revision.slice(0, 12)}:${file}`, scan(buffer.toString("utf8")));
  }
}

if (warnings.length) {
  console.warn("Credential-like values exist only in ignored local files (values hidden):");
  console.warn(warnings.map(item => `- ${item}`).join("\n"));
}
if (findings.length) {
  console.error("Potential secrets found (values hidden):");
  console.error([...new Set(findings)].map(item => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Secret scan OK (${currentFiles.length} current files, ${revisions.size} Git revisions).`);

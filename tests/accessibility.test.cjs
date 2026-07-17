const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
const css = fs.readFileSync(path.join(WEB, "style.css"), "utf8");
const gallery = fs.readFileSync(path.join(WEB, "gallery.js"), "utf8");

test("declares a local-script CSP and accessible live region", () => {
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /<script[^>]+onerror=/);
  assert.match(html, /id="appAnnouncements"[^>]+role="status"[^>]+aria-live="polite"/);
});

test("all modals expose dialog semantics and labelled close buttons", () => {
  for (const id of ["importSlideModal", "customModal", "editCustomModal", "editCustomIconModal"]) {
    const match = html.match(new RegExp(`<div id="${id}"[^>]+>`));
    assert.ok(match, id);
    assert.match(match[0], /role="dialog"/);
    assert.match(match[0], /aria-modal="true"/);
    assert.match(match[0], /aria-labelledby=/);
  }
  const closeButtons = [...html.matchAll(/<button class="modal-close"[^>]+>/g)];
  assert.equal(closeButtons.length, 4);
  closeButtons.forEach(match => assert.match(match[0], /aria-label=/));
  assert.match(html, /<script src="core\/ui\.js"><\/script>/);
});

test("main and Gallery tabs expose selected state and controlled panels", () => {
  assert.match(html, /id="navTabStudio"[^>]+aria-selected="true"[^>]+aria-controls="navStudio"/);
  assert.match(html, /id="tabLayouts"[^>]+aria-selected="true"[^>]+aria-controls="panelLayouts"/);
  assert.match(html, /id="panelLayouts"[^>]+role="tabpanel"[^>]+aria-labelledby="tabLayouts"/);
});

test("Gallery filters hide cards, groups and expose an empty state", () => {
  assert.match(css, /\.gallery-item\[hidden\][\s\S]*display: none !important/);
  assert.match(css, /\.layout-group-grid\[hidden\][\s\S]*display: none !important/);
  assert.match(gallery, /card\.toggleAttribute\("hidden", !visible\)/);
  assert.match(gallery, /gallery-empty-results/);
});

test("Studio flow exposes accessible step tabs", () => {
  assert.match(html, /class="studio-flow-nav"[^>]+role="tablist"/);
  assert.match(html, /id="studioStepCreate"[^>]+role="tab"[^>]+aria-selected="true"[^>]+aria-controls="studioInput"/);
  assert.match(html, /id="studioStepCockpit"[^>]+role="tab"[^>]+aria-selected="false"[^>]+aria-controls="briefChatSection"/);
  assert.match(html, /id="studioStepPlan"[^>]+role="tab"[^>]+aria-selected="false"[^>]+aria-controls="planSection"/);
  assert.match(html, /data-studio-next="cockpit"/);
  assert.match(html, /data-studio-next="plan"/);
});

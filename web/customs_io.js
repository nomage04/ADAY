// customs_io.js — export/import custom layouts & icons as flat .json files,
// packaged in a ZIP (via JSZip). Customs remain local and immediately usable;
// this module only provides backup, sharing and manual versioning.

const CUSTOMS_IO_MAX_JSON_BYTES = 4 * 1024 * 1024;       // one JSON entry
const CUSTOMS_IO_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;   // compressed ZIP
const CUSTOMS_IO_MAX_EXPANDED_BYTES = 128 * 1024 * 1024; // accepted JSON total
const CUSTOMS_IO_MAX_EXPORT_BYTES = 120 * 1024 * 1024;   // generated JSON total
const _CUSTOMS_ID_RE = /^[A-Za-z0-9_]{1,64}$/;

function _validCustomId(id) {
  // IDs become repository JSON and ZIP filenames.
  return typeof id === "string" && _CUSTOMS_ID_RE.test(id);
}

function _customsByteLength(text) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).byteLength;
  return new Blob([text]).size;
}

// ---- export -------------------------------------------------------------

async function exportCustomsBackup() {
  if (typeof JSZip === "undefined") throw new Error("JSZip not loaded");
  const allLayouts = (typeof getCustomLayouts === "function") ? getCustomLayouts() : [];
  const allIcons = (typeof getCustomIcons === "function") ? getCustomIcons() : [];
  const layouts = allLayouts.filter(e => _validCustomId(e?.id));
  const icons = allIcons.filter(e => _validCustomId(e?.id));
  const skipped = (allLayouts.length - layouts.length) + (allIcons.length - icons.length);

  if (!layouts.length && !icons.length) {
    alert("No valid custom item to export.");
    return null;
  }

  const zip = new JSZip();
  const tracker = { bytes: 0, files: 0 };
  for (const entry of layouts) {
    _addBackupJson(zip, `layouts/${entry.id}.json`, entry, tracker);
  }
  for (const entry of icons) {
    _addBackupJson(zip, `icons/${entry.id}.json`, entry, tracker);
  }
  _addBackupJson(zip, "_manifest.json", {
    version: 4,
    scope: "customs",
    exportedAt: new Date().toISOString(),
    layouts: layouts.map(entry => entry.id),
    icons: icons.map(entry => entry.id),
  }, tracker);

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  if (blob.size > CUSTOMS_IO_MAX_ARCHIVE_BYTES) throw new Error("Generated archive exceeds 64 MB");
  const name = `customs-backup-${_customsStamp()}.zip`;
  _customsDownload(blob, name);
  if (typeof log === "function") {
    log("ok", `Exported ${layouts.length} layout(s) + ${icons.length} icon(s) -> ${name}`);
    if (skipped) log("warn", `${skipped} custom item(s) with invalid id were not exported.`);
  }
  return { layouts: layouts.length, icons: icons.length, skipped, filename: name };
}

function _readZipTextBounded(item, total) {
  if (typeof item.internalStream !== "function") {
    return item.async("string").then(text => {
      const bytes = _customsByteLength(text);
      total.bytes += bytes;
      if (bytes > CUSTOMS_IO_MAX_JSON_BYTES) {
        const error = new Error("JSON > 4 MB"); error.code = "ENTRY_LIMIT"; throw error;
      }
      if (total.bytes > CUSTOMS_IO_MAX_EXPANDED_BYTES) {
        const error = new Error("Expanded JSON content > 128 MB"); error.code = "TOTAL_LIMIT"; throw error;
      }
      return text;
    });
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let entryBytes = 0;
    let settled = false;
    const stream = item.internalStream("uint8array");
    stream.on("data", chunk => {
      if (settled) return;
      entryBytes += chunk.length;
      total.bytes += chunk.length;
      if (entryBytes > CUSTOMS_IO_MAX_JSON_BYTES || total.bytes > CUSTOMS_IO_MAX_EXPANDED_BYTES) {
        settled = true;
        stream.pause();
        const error = new Error(entryBytes > CUSTOMS_IO_MAX_JSON_BYTES ? "JSON > 4 MB" : "Expanded JSON content > 128 MB");
        error.code = entryBytes > CUSTOMS_IO_MAX_JSON_BYTES ? "ENTRY_LIMIT" : "TOTAL_LIMIT";
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", error => { if (!settled) { settled = true; reject(error); } });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      const bytes = new Uint8Array(entryBytes);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    });
    stream.resume();
  });
}

function _addBackupJson(zip, path, value, tracker) {
  const text = JSON.stringify(value, null, 2);
  const bytes = _customsByteLength(text);
  if (bytes > CUSTOMS_IO_MAX_JSON_BYTES) throw new Error(`${path} exceeds 4 MB`);
  tracker.bytes += bytes;
  tracker.files++;
  if (tracker.bytes > CUSTOMS_IO_MAX_EXPORT_BYTES) throw new Error("JSON backup exceeds 120 MB");
  zip.file(path, text);
}

async function exportAppBackup({ includeApiKey = false } = {}) {
  if (typeof JSZip === "undefined") throw new Error("JSZip not loaded");
  const security = window.PPTGen.security;
  const store = window.PPTGen.repoStore;
  const layouts = store.getAll("layouts").map(security.normalizeCustomLayout).filter(Boolean);
  const icons = store.getAll("icons").map(security.normalizeCustomIcon).filter(Boolean);
  const photos = store.getAll("photos").map(security.normalizePhoto).filter(Boolean);
  const history = store.getAll("history").map(security.normalizeHistoryEntry).filter(Boolean).slice(0, 20);
  const settings = store.getDocument("settings");
  if (includeApiKey) {
    const visibleKey = document.getElementById("apiKey")?.value || "";
    if (visibleKey) settings.apiKey = visibleKey;
  }
  const gallery = security.normalizeGallery(store.getDocument("gallery"))
    || { disabledIcons: [], disabledLayouts: [] };

  const zip = new JSZip();
  const tracker = { bytes: 0, files: 0 };
  _addBackupJson(zip, "settings.json", settings, tracker);
  _addBackupJson(zip, "gallery.json", gallery, tracker);
  for (const entry of layouts) _addBackupJson(zip, `layouts/${entry.id}.json`, entry, tracker);
  for (const entry of icons) _addBackupJson(zip, `icons/${entry.id}.json`, entry, tracker);
  for (const entry of photos) _addBackupJson(zip, `photos/${entry.id}.json`, entry, tracker);
  for (const entry of history) _addBackupJson(zip, `history/${entry.id}.json`, entry, tracker);
  _addBackupJson(zip, "_manifest.json", {
    version: 4,
    scope: "full",
    exportedAt: new Date().toISOString(),
    includesApiKey: !!settings.apiKey,
    limits: { jsonBytes: CUSTOMS_IO_MAX_JSON_BYTES, archiveBytes: CUSTOMS_IO_MAX_ARCHIVE_BYTES, expandedBytes: CUSTOMS_IO_MAX_EXPANDED_BYTES },
    bytes: tracker.bytes,
    counts: { layouts: layouts.length, icons: icons.length, photos: photos.length, history: history.length },
  }, tracker);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  if (blob.size > CUSTOMS_IO_MAX_ARCHIVE_BYTES) throw new Error("Generated archive exceeds 64 MB");
  const filename = `aday-backup-${_customsStamp()}.zip`;
  _customsDownload(blob, filename);
  if (typeof log === "function") log("ok", `Full backup exported -> ${filename}`);
  return { layouts: layouts.length, icons: icons.length, photos: photos.length, plans: history.length, filename };
}

async function _readFullBackup(file) {
  if (!file || file.size > CUSTOMS_IO_MAX_ARCHIVE_BYTES) throw new Error("Archive > 64 MB");
  if (typeof JSZip === "undefined") throw new Error("JSZip not loaded");
  const zip = await JSZip.loadAsync(file);
  const expanded = { bytes: 0 };
  let app = null;
  let settings = null;
  let gallery = null;
  const customs = [];
  const photos = [];
  const history = [];
  const ignored = [];
  const seen = new Set();
  for (const item of Object.values(zip.files)) {
    if (item.dir) continue;
    const name = String(item.name || "");
    const lower = name.toLowerCase();
    if (!lower.endsWith(".json") || lower.endsWith("_manifest.json")) continue;
    let text;
    try { text = await _readZipTextBounded(item, expanded); }
    catch (error) {
      if (error.code === "ENTRY_LIMIT") { ignored.push(`${name} (> 4 MB)`); continue; }
      throw error;
    }
    let raw;
    try { raw = JSON.parse(text); }
    catch { ignored.push(`${name} (corrupt JSON)`); continue; }
    if (lower === "app.json") {
      app = window.PPTGen.security.normalizeConfigBackup(raw);
      if (!app) ignored.push("app.json (invalid schema)");
      continue;
    }
    if (lower === "settings.json") {
      settings = window.PPTGen.security.normalizePrefs(raw);
      if (!settings) ignored.push("settings.json (invalid schema)");
      continue;
    }
    if (lower === "gallery.json") {
      gallery = window.PPTGen.security.normalizeGallery(raw);
      if (!gallery) ignored.push("gallery.json (invalid schema)");
      continue;
    }
    if (lower.startsWith("photos/")) {
      const photo = window.PPTGen.security.normalizePhoto(raw);
      if (!photo || seen.has(`photo:${photo?.id}`)) ignored.push(`${name} (invalid or duplicate photo)`);
      else { seen.add(`photo:${photo.id}`); photos.push(photo); }
      continue;
    }
    if (lower.startsWith("history/")) {
      const entry = window.PPTGen.security.normalizeHistoryEntry(raw);
      if (!entry || seen.has(`history:${entry?.id}`)) ignored.push(`${name} (invalid or duplicate history entry)`);
      else { seen.add(`history:${entry.id}`); history.push(entry); }
      continue;
    }
    const kind = _detectKind(raw, name);
    const result = _validateEntry(kind, raw);
    const key = result.ok ? `${kind}:${result.entry.id}` : "";
    if (!result.ok || seen.has(key)) ignored.push(`${name} (${result.reason || "duplicate"})`);
    else { seen.add(key); customs.push({ kind, entry: result.entry }); }
  }
  return { app, settings, gallery, customs, photos, history, ignored };
}

// Repository-backed restore path. Old backup formats remain readable, while
// every mutation is confirmed by the local server before the cache changes.
async function importAppBackup(fileList) {
  const file = Array.from(fileList || [])[0];
  if (!file) return null;
  if (!window.PPTGen.repoStore.isAvailable()) {
    throw new Error("Run `python -m backend.server` to restore a backup.");
  }
  const parsed = await _readFullBackup(file);
  const store = window.PPTGen.repoStore;
  const ignored = parsed.ignored.slice();
  const candidates = [];
  for (const item of parsed.customs) {
    candidates.push({ collection: item.kind === "layout" ? "layouts" : "icons", entry: item.entry });
  }
  for (const entry of parsed.photos) candidates.push({ collection: "photos", entry });
  const legacyHistory = parsed.app?.plansHistory || [];
  const seenHistory = new Set();
  for (const entry of [...parsed.history, ...legacyHistory]) {
    if (seenHistory.has(entry.id)) { ignored.push(`history:${entry.id} (doublon)`); continue; }
    seenHistory.add(entry.id);
    candidates.push({ collection: "history", entry });
  }
  const settings = parsed.settings || parsed.app?.prefs || null;
  const gallery = parsed.gallery || parsed.app?.gallery || null;

  const existing = new Map(["layouts", "icons", "photos", "history"].map(collection => [
    collection, new Set(store.getAll(collection).map(entry => entry.id)),
  ]));
  let replacements = candidates.filter(item => existing.get(item.collection).has(item.entry.id)).length;
  if (settings && Object.keys(store.getDocument("settings")).length) replacements++;
  const currentGallery = store.getDocument("gallery");
  if (gallery && (currentGallery.disabledIcons?.length || currentGallery.disabledLayouts?.length)) replacements++;
  if (replacements && !confirm(`${replacements} existing item(s) will be replaced. Continue?`)) {
    return { imported: 0, replaced: 0, ignored: ignored.concat(["import cancelled by user"]) };
  }

  let imported = 0;
  let replaced = 0;
  const write = async (label, exists, action) => {
    try {
      await action();
      exists ? replaced++ : imported++;
      return true;
    } catch (error) {
      ignored.push(`${label} (not written: ${error.message})`);
      return false;
    }
  };
  if (settings) {
    const clean = { ...settings };
    if (clean.apiKey) {
      try { sessionStorage.setItem("pptgen.apiKey", clean.apiKey); } catch {}
      delete clean.apiKey;
    }
    await write("settings", Object.keys(store.getDocument("settings")).length > 0,
      () => store.putDocument("settings", clean));
  }
  if (gallery) {
    await write("gallery", !!(currentGallery.disabledIcons?.length || currentGallery.disabledLayouts?.length),
      () => store.putDocument("gallery", gallery));
  }
  for (const item of candidates) {
    const exists = existing.get(item.collection).has(item.entry.id);
    await write(`${item.collection}:${item.entry.id}`, exists,
      () => store.put(item.collection, item.entry));
  }

  if (typeof initSelections === "function") initSelections();
  const layoutGrid = document.getElementById("layoutGrid");
  const iconGrid = document.getElementById("iconGrid");
  if (layoutGrid) renderLayoutGallery(layoutGrid);
  if (iconGrid) renderIconGallery(iconGrid);
  if (typeof renderPhotoGallery === "function") renderPhotoGallery();
  if (typeof renderHistory === "function") renderHistory();
  window.renderDataBackupStats?.();
  const summary = { imported, replaced, ignored };
  if (typeof log === "function") log(ignored.length ? "warn" : "ok",
    `Backup restored: ${imported} imported, ${replaced} replaced, ${ignored.length} ignored.`);
  return summary;
}

// ---- import -------------------------------------------------------------

async function importCustomsBackup(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return null;

  const candidates = [];
  for (const file of files) {
    const lower = String(file.name || "").toLowerCase();
    if (lower.endsWith(".zip")) {
      if (file.size > CUSTOMS_IO_MAX_ARCHIVE_BYTES) {
        candidates.push({ invalid: `${file.name} (archive > 64 MB)` });
        continue;
      }
      candidates.push(...await _readCustomsZip(file));
      continue;
    }
    if (lower.endsWith(".json")) {
      if (file.size > CUSTOMS_IO_MAX_JSON_BYTES) {
        candidates.push({ invalid: `${file.name} (> 4 MB)` });
        continue;
      }
      try {
        const entry = await _readJsonFile(file);
        candidates.push({ kind: _detectKind(entry, file.name), entry, source: file.name });
      } catch {
        candidates.push({ invalid: `${file.name} (unreadable JSON)` });
      }
      continue;
    }
    candidates.push({ invalid: `${file.name} (unsupported type)` });
  }

  // Validate before any write and keep only the first valid occurrence of an
  // id within this import batch. This makes counts deterministic and prevents
  // a later file from silently overwriting an earlier one.
  const valid = [];
  const ignored = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (candidate.invalid) {
      ignored.push(candidate.invalid);
      continue;
    }
    const result = _validateEntry(candidate.kind, candidate.entry);
    if (!result.ok) {
      ignored.push(`${candidate.source || candidate.entry?.id || "?"}: ${result.reason}`);
      continue;
    }
    const dedupeKey = `${candidate.kind}:${result.entry.id}`;
    if (seen.has(dedupeKey)) {
      ignored.push(`${candidate.source || result.entry.id}: duplicate ${dedupeKey}`);
      continue;
    }
    seen.add(dedupeKey);
    valid.push({ kind: candidate.kind, entry: result.entry, source: candidate.source });
  }

  if (!valid.length) {
    const message = `No valid custom item to import${ignored.length ? ` (${ignored.length} ignored)` : ""}.`;
    if (typeof log === "function") log("warn", message);
    alert(message + (ignored.length ? `\n\n${ignored.slice(0, 12).join("\n")}` : ""));
    return { imported: 0, replaced: 0, ignored };
  }

  const existingLayouts = new Set(
    (typeof getCustomLayouts === "function" ? getCustomLayouts() : []).map(entry => entry.id),
  );
  const existingIcons = new Set(
    (typeof getCustomIcons === "function" ? getCustomIcons() : []).map(entry => entry.id),
  );
  const overlaps = valid.filter(candidate =>
    (candidate.kind === "layout" ? existingLayouts : existingIcons).has(candidate.entry.id),
  );

  if (overlaps.length) {
    const ok = confirm(
      `${overlaps.length} custom item(s) already exist and will be replaced:\n` +
      overlaps.slice(0, 20).map(candidate =>
        `  - ${candidate.kind} "${candidate.entry.id}"`,
      ).join("\n") +
      (overlaps.length > 20 ? `\n  ... (+${overlaps.length - 20})` : "") +
      "\n\nContinue import?",
    );
    if (!ok) {
      return { imported: 0, replaced: 0, ignored: ignored.concat(["import cancelled by user"]) };
    }
  }

  let imported = 0;
  let replaced = 0;
  let interruption = "";
  const written = [];
  for (let index = 0; index < valid.length; index++) {
    const candidate = valid[index];
    const existingSet = candidate.kind === "layout" ? existingLayouts : existingIcons;
    try {
      if (candidate.kind === "layout") await _putCustomLayout(candidate.entry);
      else await _putCustomIcon(candidate.entry);
      written.push(candidate);
      if (existingSet.has(candidate.entry.id)) replaced++;
      else imported++;
    } catch (error) {
      const reason = (typeof isQuotaExceededError === "function" && isQuotaExceededError(error))
        || /stockage local plein|quota|local storage full/i.test(error?.message || "")
        ? "quota reached"
        : (error?.message || "write error");
      interruption = `Import interrupted after ${written.length} write(s): ${reason}.`;
      for (const pending of valid.slice(index)) {
        ignored.push(`${pending.kind} "${pending.entry.id}" (not written: ${reason})`);
      }
      break;
    }
  }

  // Make successfully imported customs visible immediately, without reload.
  if (typeof initSelections === "function") initSelections();
  const layoutGrid = document.getElementById("layoutGrid");
  const iconGrid = document.getElementById("iconGrid");
  if (layoutGrid && typeof renderLayoutGallery === "function") renderLayoutGallery(layoutGrid);
  if (iconGrid && typeof renderIconGallery === "function") renderIconGallery(iconGrid);
  window.renderDataBackupStats?.();

  const summary = `Import complete: ${imported} added, ${replaced} replaced, ${ignored.length} ignored.`;
  if (typeof log === "function") log(interruption ? "warn" : "ok", `${summary}${interruption ? ` ${interruption}` : ""}`);
  alert(
    (interruption ? `${interruption}\n\n` : "") + summary +
    (ignored.length ? `\n\nIgnored:\n${ignored.slice(0, 12).join("\n")}` : ""),
  );
  return { imported, replaced, ignored };
}

// ---- validation and parsing --------------------------------------------

function _detectKind(entry, filename) {
  const name = String(filename || "").toLowerCase();
  if (name.includes("layouts/")) return "layout";
  if (name.includes("icons/")) return "icon";
  if (entry && Object.prototype.hasOwnProperty.call(entry, "zones")) return "layout";
  if (entry && Object.prototype.hasOwnProperty.call(entry, "dataUrl")) return "icon";
  return null;
}

function _validateEntry(kind, raw) {
  if (kind !== "layout" && kind !== "icon") {
    return { ok: false, reason: "unknown layout/icon type" };
  }
  const security = window.PPTGen?.security;
  if (!security) return { ok: false, reason: "validation module unavailable" };
  const entry = kind === "icon"
    ? security.normalizeCustomIcon(raw)
    : security.normalizeCustomLayout(raw);
  if (!entry) return { ok: false, reason: `invalid ${kind} schema or image` };
  return { ok: true, entry };
}

async function _readCustomsZip(file) {
  if (typeof JSZip === "undefined") return [{ invalid: `${file.name} (JSZip not loaded)` }];
  try {
    const zip = await JSZip.loadAsync(file);
    const archiveCandidates = [];
    const expanded = { bytes: 0 };
    for (const item of Object.values(zip.files)) {
      if (item.dir) continue;
      const name = String(item.name || "");
      const lower = name.toLowerCase();
      if (!lower.endsWith(".json") || lower.endsWith("_manifest.json")) continue;

      let text;
      try { text = await _readZipTextBounded(item, expanded); }
      catch (error) {
        if (error.code === "ENTRY_LIMIT") {
          archiveCandidates.push({ invalid: `${name} (> 4 MB expanded)` });
          continue;
        }
        return [{ invalid: `${file.name} (${error.message})` }];
      }

      try {
        const entry = JSON.parse(text);
        archiveCandidates.push({ kind: _detectKind(entry, name), entry, source: name });
      } catch {
        archiveCandidates.push({ invalid: `${name} (corrupt JSON)` });
      }
    }
    return archiveCandidates;
  } catch (error) {
    return [{ invalid: `${file.name} (unreadable zip: ${error.message})` }];
  }
}

async function _readJsonFile(file) {
  const text = await file.text();
  if (_customsByteLength(text) > CUSTOMS_IO_MAX_JSON_BYTES) {
    throw new Error("JSON > 4 MB");
  }
  return JSON.parse(text);
}

// ---- download and UI wiring --------------------------------------------

function _customsStamp() {
  const date = new Date();
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
         `${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function _customsDownload(blob, filename) {
  window.PPTGen.download.saveBlob(blob, filename);
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.PPTGen.repoReady;
  const btnExport = document.getElementById("btnExportCustoms");
  const btnImport = document.getElementById("btnImportCustoms");
  const inputImport = document.getElementById("importCustomsInput");
  const btnExportBackup = document.getElementById("btnExportBackup");
  const btnImportBackup = document.getElementById("btnImportBackup");
  const inputBackup = document.getElementById("importBackupInput");
  if (btnExport) {
    btnExport.addEventListener("click", () => {
      exportCustomsBackup().catch(error => {
        console.error(error);
        alert("Export failed: " + error.message);
      });
    });
  }
  if (btnImport && inputImport) {
    btnImport.addEventListener("click", () => inputImport.click());
  }
  if (inputImport) {
    inputImport.addEventListener("change", async event => {
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      if (!files.length) return;
      try {
        await importCustomsBackup(files);
      } catch (error) {
        console.error(error);
        alert("Import failed: " + error.message);
      }
    });
  }
  if (btnExportBackup) {
    btnExportBackup.addEventListener("click", async () => {
      btnExportBackup.disabled = true;
      try {
        const includeApiKey = confirm("Include the API key in the full backup?");
        await exportAppBackup({ includeApiKey });
      } catch (error) {
        console.error(error);
        alert("Export failed: " + error.message);
      } finally {
        btnExportBackup.disabled = false;
      }
    });
  }
  if (btnImportBackup && inputBackup) {
    btnImportBackup.addEventListener("click", () => inputBackup.click());
    inputBackup.addEventListener("change", async event => {
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      if (!files.length) return;
      btnImportBackup.disabled = true;
      try {
        const report = await importAppBackup(files);
        if (report) alert(`Import complete: ${report.imported} added, ${report.replaced} replaced, ${report.ignored.length} ignored.`);
      } catch (error) {
        console.error(error);
        alert("Import failed: " + error.message);
      } finally {
        btnImportBackup.disabled = false;
      }
    });
  }
});

window.exportCustomsBackup = exportCustomsBackup;
window.importCustomsBackup = importCustomsBackup;
window.exportAppBackup = exportAppBackup;
window.importAppBackup = importAppBackup;

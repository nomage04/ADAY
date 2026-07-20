(function initRepositoryStore(global) {
  "use strict";

  const PPTGen = global.PPTGen = global.PPTGen || {};
  const COLLECTIONS = ["layouts", "icons", "photos", "history"];
  const state = {
    layouts: [], icons: [], photos: [], history: [],
    settings: {}, gallery: {}, warnings: [],
  };
  let available = false;
  let initialized = false;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeCollection(collection, entries) {
    const security = PPTGen.security;
    const normalizers = {
      layouts: security.normalizeCustomLayout,
      icons: security.normalizeCustomIcon,
      photos: security.normalizePhoto,
      history: security.normalizeHistoryEntry,
    };
    const normalize = normalizers[collection];
    return Array.isArray(entries) ? entries.map(normalize).filter(Boolean) : [];
  }

  function normalizeDocument(name, value) {
    if (name === "settings") {
      const normalized = PPTGen.security.normalizePrefs(value) || {};
      delete normalized.apiKey;
      if (typeof value?.confirmedProviderHost === "string" && value.confirmedProviderHost.length <= 255) {
        normalized.confirmedProviderHost = value.confirmedProviderHost;
      }
      return normalized;
    }
    return PPTGen.security.normalizeGallery(value) || { disabledIcons: [], disabledLayouts: [] };
  }

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: { "content-type": "application/json", ...(options.headers || {}) },
      });
    } catch (error) {
      available = false;
      throw new Error(`Serveur local indisponible : ${error.message}`);
    }
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = String(body.detail || "").slice(0, 500);
      } catch {
        detail = (await response.text()).slice(0, 500);
      }
      throw new Error(detail || `Erreur serveur ${response.status}`);
    }
    return response.status === 204 ? null : response.json();
  }

  async function reloadState() {
    if (global.location?.protocol === "file:") return false;
    try {
      const loaded = await request("/api/state", { method: "GET", headers: {} });
      const next = {};
      for (const collection of COLLECTIONS) {
        next[collection] = normalizeCollection(collection, loaded[collection]);
      }
      next.settings = normalizeDocument("settings", loaded.settings || {});
      next.gallery = normalizeDocument("gallery", loaded.gallery || {});
      next.warnings = Array.isArray(loaded.warnings)
        ? loaded.warnings.filter(value => typeof value === "string").slice(0, 100) : [];
      Object.assign(state, next);
      available = true;
      return true;
    } catch (error) {
      available = false;
      state.warnings = [error.message, ...state.warnings].slice(0, 100);
      return false;
    }
  }

  async function init() {
    if (initialized) return available;
    initialized = true;
    return reloadState();
  }

  function isAvailable() { return available; }
  function isReadOnly() { return !available; }
  function getAll(collection) { return clone(state[collection] || []); }
  function get(collection, id) {
    return clone((state[collection] || []).find(entry => entry.id === id) || null);
  }
  function getDocument(name) { return clone(state[name] || {}); }
  function getWarnings() { return state.warnings.slice(); }

  async function put(collection, entry) {
    if (!available) throw new Error("Mode lecture seule : lance `python -m backend.server` pour enregistrer.");
    const normalizedList = normalizeCollection(collection, [entry]);
    if (normalizedList.length !== 1) throw new Error(`invalid ${collection}`);
    const normalized = normalizedList[0];
    const saved = await request(`/api/${collection}/${encodeURIComponent(normalized.id)}`, {
      method: "PUT", body: JSON.stringify(normalized),
    });
    const confirmed = normalizeCollection(collection, [saved])[0];
    if (!confirmed) throw new Error("Invalid server response");
    const next = state[collection].filter(item => item.id !== confirmed.id);
    next.push(confirmed);
    state[collection] = next;
    return clone(confirmed);
  }

  async function remove(collection, id) {
    if (!available) throw new Error("Mode lecture seule : lance `python -m backend.server` pour supprimer.");
    await request(`/api/${collection}/${encodeURIComponent(id)}`, { method: "DELETE" });
    state[collection] = state[collection].filter(item => item.id !== id);
  }

  async function putDocument(name, value) {
    if (!available) throw new Error("Mode lecture seule : lance `python -m backend.server` pour enregistrer.");
    const normalized = normalizeDocument(name, value);
    const saved = await request(`/api/${name}`, { method: "PUT", body: JSON.stringify(normalized) });
    state[name] = normalizeDocument(name, saved);
    return getDocument(name);
  }

  function readLocalJson(key, fallback) {
    let raw;
    try { raw = global.localStorage?.getItem(key); } catch { return fallback; }
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function localKeys(prefix) {
    const keys = [];
    try {
      for (let index = 0; index < global.localStorage.length; index++) {
        const key = global.localStorage.key(index);
        if (key?.startsWith(prefix)) keys.push(key);
      }
    } catch { /* storage unavailable */ }
    return keys;
  }

  function removeLocal(key) {
    try { global.localStorage?.removeItem(key); } catch { /* best effort */ }
  }

  function writeRemaining(key, list) {
    try {
      if (list.length) global.localStorage?.setItem(key, JSON.stringify(list));
      else global.localStorage?.removeItem(key);
    } catch { /* preserve the original source if cleanup fails */ }
  }

  async function migrateLegacy(confirmReplace = message => global.confirm(message)) {
    const report = { imported: 0, replaced: 0, ignored: [] };
    if (!available || !global.localStorage) return report;

    const candidates = [];
    const arraySources = new Map();
    const seen = new Set();
    const add = (collection, raw, source, sourceKind = "flat") => {
      const normalized = normalizeCollection(collection, [raw])[0];
      if (!normalized) { report.ignored.push(`${source} (invalid)`); return; }
      const key = `${collection}:${normalized.id}`;
      if (seen.has(key)) { report.ignored.push(`${source} (doublon)`); return; }
      seen.add(key);
      candidates.push({ collection, entry: normalized, source, sourceKind });
    };

    for (const key of localKeys("pptgen.cl.")) add("layouts", readLocalJson(key, null), key);
    for (const key of localKeys("pptgen.ci.")) add("icons", readLocalJson(key, null), key);
    for (const [source, collection] of [["pptgen.customLayouts", "layouts"], ["pptgen.customIcons", "icons"], ["pptgen.photos", "photos"], ["pptgen.plansHistory", "history"]]) {
      const list = readLocalJson(source, []);
      if (!Array.isArray(list)) continue;
      arraySources.set(source, list);
      for (const entry of list) add(collection, entry, source, "array");
    }
    const lastPlan = readLocalJson("pptgen.lastPlan", null);
    if (lastPlan?.plan) {
      add("history", {
        id: `legacy-${Date.now().toString(36)}`,
        savedAt: lastPlan.savedAt || "migrated",
        topic: "(migrated plan)", slideCount: lastPlan.plan.length,
        plan: lastPlan.plan, display: lastPlan.display || "", warnings: lastPlan.warnings || [],
      }, "pptgen.lastPlan");
    }

    const existing = new Map(COLLECTIONS.map(collection => [collection,
      new Set(state[collection].map(entry => entry.id))]));
    const collisions = candidates.filter(item => existing.get(item.collection).has(item.entry.id));
    const replace = !collisions.length || confirmReplace(
      `${collisions.length} browser item(s) already exist in the repo. Replace them?`,
    );

    const migratedByArray = new Map();
    for (const item of candidates) {
      const exists = existing.get(item.collection).has(item.entry.id);
      if (exists && !replace) {
        report.ignored.push(`${item.collection}:${item.entry.id} (replacement declined)`);
        continue;
      }
      try {
        await put(item.collection, item.entry);
        exists ? report.replaced++ : report.imported++;
        existing.get(item.collection).add(item.entry.id);
        if (item.sourceKind === "flat" || item.source === "pptgen.lastPlan") removeLocal(item.source);
        else {
          if (!migratedByArray.has(item.source)) migratedByArray.set(item.source, new Set());
          migratedByArray.get(item.source).add(item.entry.id);
        }
      } catch (error) {
        report.ignored.push(`${item.collection}:${item.entry.id} (${error.message})`);
      }
    }
    for (const [source, migrated] of migratedByArray) {
      const remaining = (arraySources.get(source) || []).filter(entry => !migrated.has(entry?.id));
      writeRemaining(source, remaining);
    }

    const legacyPrefs = readLocalJson("pptgen.prefs", null);
    const baseUrl = (() => { try { return global.localStorage.getItem("pptgen.baseUrl") || ""; } catch { return ""; } })();
    const model = (() => { try { return global.localStorage.getItem("pptgen.model") || ""; } catch { return ""; } })();
    const prefs = legacyPrefs || (baseUrl || model ? { baseUrl, model } : null);
    if (prefs) {
      if (typeof prefs.apiKey === "string" && prefs.apiKey) {
        try { global.sessionStorage?.setItem("pptgen.apiKey", prefs.apiKey); } catch { /* session unavailable */ }
      }
      const replacement = Object.keys(state.settings).length > 0;
      if (!replacement || replace) {
        try {
          await putDocument("settings", { ...prefs, apiKey: undefined });
          removeLocal("pptgen.prefs"); removeLocal("pptgen.baseUrl"); removeLocal("pptgen.model");
          replacement ? report.replaced++ : report.imported++;
        } catch (error) { report.ignored.push(`settings (${error.message})`); }
      }
    }
    const gallery = readLocalJson("pptgen.gallery", null);
    if (gallery) {
      const replacement = state.gallery.disabledIcons?.length || state.gallery.disabledLayouts?.length;
      if (!replacement || replace) {
        try {
          await putDocument("gallery", gallery); removeLocal("pptgen.gallery");
          replacement ? report.replaced++ : report.imported++;
        } catch (error) { report.ignored.push(`gallery (${error.message})`); }
      }
    }
    removeLocal("pptgen.migratedFlatV1");
    return report;
  }

  PPTGen.repoStore = {
    init, reloadState, isAvailable, isReadOnly, getAll, get, getDocument, getWarnings,
    put, remove, putDocument, migrateLegacy,
  };
  PPTGen.repoReady = init().then(ready => ready ? migrateLegacy() : null);
})(window);

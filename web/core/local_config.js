(function initLocalConfig(global) {
  "use strict";
  const PPTGen = global.PPTGen = global.PPTGen || {};

  async function saveLocalConfig(config) {
    if (global.location?.protocol === "file:") {
      throw new Error("Mode lecture seule : lance python -m backend.server pour enregistrer config/config.local.js.");
    }
    let response;
    try {
      response = await fetch("/api/local-config", {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(config || {}),
      });
    } catch (error) {
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
    const saved = await response.json();
    const current = (typeof global.LLM_CONFIG_DEFAULTS === "object" && global.LLM_CONFIG_DEFAULTS) || {};
    global.LLM_CONFIG_DEFAULTS = {
      ...current,
      ...config,
      apiKey: saved.hasApiKey ? String(config?.apiKey || "") : "",
    };
    return saved;
  }

  PPTGen.localConfigReady = (async () => {
    if (global.location?.protocol === "file:") {
      await new Promise(resolve => {
        const script = document.createElement("script");
        script.src = "../config/config.local.js";
        script.onload = resolve;
        script.onerror = resolve;
        document.head.appendChild(script);
      });
      return global.LLM_CONFIG_DEFAULTS || {};
    }
    try {
      const response = await fetch("/api/local-config", { headers: { accept: "application/json" } });
      if (!response.ok) return {};
      global.LLM_CONFIG_DEFAULTS = await response.json();
      return global.LLM_CONFIG_DEFAULTS;
    } catch { return {}; }
  })();
  PPTGen.localConfig = {
    save: saveLocalConfig,
    get: () => (typeof global.LLM_CONFIG_DEFAULTS === "object" && global.LLM_CONFIG_DEFAULTS) || {},
  };
})(window);

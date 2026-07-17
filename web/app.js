// app.js — orchestrates brief scoping, plan generation, and the build.
// 1) user clicks "Discuter du brief"
// 2) brief-chat clarifies the intent in a short conversation
// 3) user validates the framing, then ppt-fast creates a build-ready plan
// 4) UI shows the markdown table; user validates → build_deck → download

(function () {
  let currentPlan = null;
  let followTail = true;   // logs auto-scroll unless user scrolled up
  let prefsTimer = null;
  let briefEventCounter = 0;
  let studioStep = "create";
  const studioStepAvailability = { create: true, cockpit: false, plan: false };
  let localConfigHadApiKey = false;
  let lastRememberKey = false;
  let deckPreviewIndex = 0;
  let deckPreviewStatus = "ready";
  let deckPreviewPlan = [];
  let deckPreviewDeckTitle = "";
  let deckPreviewLightboxOpen = false;
  let deckPreviewNavPointerAt = 0;
  const GENERATION_DRAFT_KEY = "pptgen.generationDraft";
  const GENERATION_DRAFT_VERSION = 1;
  const SPEAKER_NOTES_MAX_LENGTH = 1200;

  const TONE_GUIDES = {
    professional: {
      label: "Professional",
      instruction: "Use polished, credible business language. Keep claims measured, structured, and executive-ready. Avoid slang, jokes, and exaggerated promises.",
    },
    direct: {
      label: "Direct",
      instruction: "Be concise and action-oriented. Prefer short sentences, clear recommendations, and explicit next steps. Remove filler, hedging, and decorative wording.",
    },
    persuasive: {
      label: "Persuasive",
      instruction: "Frame the deck around conviction and impact. Emphasize benefits, stakes, proof points, and calls to action while staying factual and not overclaiming.",
    },
    storytelling: {
      label: "Storytelling",
      instruction: "Create a narrative arc with context, tension, turning points, and resolution. Use slide titles that move the story forward instead of generic labels.",
    },
    educational: {
      label: "Educational",
      instruction: "Explain concepts step by step for learning. Define terms, make logic explicit, use examples, and avoid assuming deep prior knowledge.",
    },
  };

  document.addEventListener("DOMContentLoaded", async () => {
    await window.PPTGen.localConfigReady;
    const migration = await window.PPTGen.repoReady;
    restorePrefs();
    initGallery();
    initNavTabs();
    initStudioMode();
    initStudioFlow();

    // Persist prefs as soon as the user edits a field — no more relying on
    // the "Create outline" click to save.
    ["baseUrl", "model", "visionModel", "debugLogs", "rememberKey"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(evt, schedulePrefsSave);
      el.addEventListener("blur", flushPrefsSave);
    });
    document.getElementById("apiKey")?.addEventListener("input", event => {
      try { sessionStorage.setItem("pptgen.apiKey", event.target.value); } catch {}
      schedulePrefsSave();
    });
    document.getElementById("apiKey")?.addEventListener("blur", flushPrefsSave);

    // Persist Brief inputs + pastedPlan so a reload
    // doesn't lose what the user typed.
    restoreBrief();
    ["topic", "slideCount", "tone", "userContent", "pastePlan"]
      .forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("input", saveBrief);
        el.addEventListener("blur",  saveBrief);
      });
    ["includeSpeakerNotes", "uniqueLayoutsPerDeck"]
      .forEach(id => document.getElementById(id)?.addEventListener("change", saveBrief));

    // If a plan was awaiting user validation last time and didn't get
    // consumed, restore it so a reload doesn't make the user re-generate.
    const restoredPlan = restoreCurrentPlan();
    if (!restoredPlan) renderDeckPreview(currentPlan);

    document.getElementById("btnPlan").addEventListener("click", onPlan);
    document.getElementById("btnBriefChatSend").addEventListener("click", onBriefChatSend);
    document.getElementById("btnBriefExplain").addEventListener("click", onBriefExplain);
    document.getElementById("btnBriefChatValidate").addEventListener("click", onBriefChatValidate);
    document.getElementById("btnBriefRegenerate").addEventListener("click", onBriefRegenerate);
    document.getElementById("btnBriefChatReset").addEventListener("click", onPlan);
    document.getElementById("briefChatInput").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onBriefChatSend();
      }
    });
    document.getElementById("btnBuild").addEventListener("click", onBuild);
    document.getElementById("btnClearLogs")?.addEventListener("click", () => {
      const logs = document.getElementById("logs");
      if (logs) logs.innerHTML = "";
      if (briefChatState) {
        briefChatState.workItems = [];
        renderBriefChat();
      }
      followTail = true;
      updateFollowTailBtn();
    });
    const logsEl = document.getElementById("logs");
    logsEl?.addEventListener("scroll", () => {
      const nearBottom = logsEl.scrollTop >= logsEl.scrollHeight - logsEl.clientHeight - 40;
      if (followTail !== nearBottom) {
        followTail = nearBottom;
        updateFollowTailBtn();
      }
    });
    document.getElementById("btnFollowTail")?.addEventListener("click", () => {
      followTail = true;
      scrollLogsToBottom();
      updateFollowTailBtn();
    });
    document.getElementById("btnCopyPlan").addEventListener("click", onCopyPlan);
    document.getElementById("btnUsePasted").addEventListener("click", onUsePasted);
    document.getElementById("btnResume").addEventListener("click", onResume);
    document.getElementById("btnClearHistory").addEventListener("click", onClearHistory);
    document.getElementById("btnTestConnection")?.addEventListener("click", onTestConnection);
    document.getElementById("btnReviewGeneratedDeck")?.addEventListener("click", focusDeckPreview);
    document.getElementById("btnCloseDeckPreviewLightbox")?.addEventListener("click", closeDeckPreviewLightbox);
    document.getElementById("deckPreviewLightboxBackdrop")?.addEventListener("click", closeDeckPreviewLightbox);
    wireDeckPreviewNavButton(document.getElementById("btnDeckPreviewLightboxPrev"), -1);
    wireDeckPreviewNavButton(document.getElementById("btnDeckPreviewLightboxNext"), 1);
    wireDeckPreviewNavButton(document.getElementById("btnDeckPreviewLightboxClickPrev"), -1);
    wireDeckPreviewNavButton(document.getElementById("btnDeckPreviewLightboxClickNext"), 1);
    document.addEventListener("keydown", onDeckPreviewKeydown);
    document.getElementById("btnExportConfig").addEventListener("click", onExportConfig);
    document.getElementById("btnImportConfig").addEventListener("click", () => {
      document.getElementById("importFile").click();
    });
    document.getElementById("importFile").addEventListener("change", onImportConfigFile);

    renderHistory();
    renderDataBackupStats();
    if (getHistory().length > 0) {
      document.getElementById("btnResume").classList.remove("hidden");
    }
    if (migration && (migration.imported || migration.replaced || migration.ignored.length)) {
      log(migration.ignored.length ? "warn" : "ok",
        `Browser migration: ${migration.imported} imported, ${migration.replaced} replaced, ${migration.ignored.length} ignored.`);
    }
    configureRepositoryMode();
    document.getElementById("btnReconnectRepo")?.addEventListener("click", reconnectRepository);
  });

  async function reconnectRepository() {
    const button = document.getElementById("btnReconnectRepo");
    if (button) { button.disabled = true; button.textContent = "Connecting..."; }
    try {
      const ready = await window.PPTGen.repoStore.reloadState();
      configureRepositoryMode();
      if (ready) {
        initSelections();
        renderIconGallery(document.getElementById("iconGrid"));
        renderLayoutGallery(document.getElementById("layoutGrid"));
        renderPhotoGallery();
        renderHistory();
        renderDataBackupStats();
        window.PPTGen.ui.notify("Local server reconnected.", "ok");
      } else {
        window.PPTGen.ui.notify("Local server is still unavailable.", "warn");
      }
    } finally {
      if (button) { button.disabled = false; button.textContent = "Reconnect"; }
    }
  }

  function configureRepositoryMode() {
    const readOnly = window.PPTGen.repoStore.isReadOnly();
    const banner = document.getElementById("repoModeBanner");
    if (banner) banner.classList.toggle("hidden", !readOnly);
    document.querySelectorAll("[data-requires-server]").forEach(button => {
      button.disabled = readOnly;
      if (readOnly) button.title = "Run python -m backend.server to enable this action";
    });
    for (const warning of window.PPTGen.repoStore.getWarnings()) log("warn", warning);
  }

  // ---- Main nav tabs ------------------------------------------------------
  function initNavTabs() {
    const tabs = document.querySelectorAll(".nav-tab");
    const panels = document.querySelectorAll(".nav-panel");
    const viewLabels = {
      studio: "Studio",
      gallery: "Gallery",
      history: "History",
      settings: "Settings",
    };
    const updateChrome = (name) => {
      const label = viewLabels[name] || cap(name);
      const title = document.getElementById("activeViewTitle");
      const crumb = document.getElementById("activeViewCrumb");
      if (title) title.textContent = label;
      if (crumb) crumb.textContent = label;
    };
    const activate = (name) => {
      tabs.forEach(t => {
        const active = t.dataset.navTab === name;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach(p => p.classList.toggle("active", p.id === "nav" + cap(name)));
      updateChrome(name);
      if (name === "settings") renderDataBackupStats();
      try { sessionStorage.setItem("pptgen.activeTab", name); } catch {}
    };
    tabs.forEach(t => t.addEventListener("click", () => activate(t.dataset.navTab)));
    // Restore last active tab (default: studio)
    const saved = (() => { try { return sessionStorage.getItem("pptgen.activeTab"); } catch { return null; } })();
    if (saved && document.querySelector(`.nav-tab[data-nav-tab="${saved}"]`)) {
      activate(saved);
    }
    // Expose switcher for other handlers (e.g. History "Reprendre" → Studio).
    window.__switchTab = activate;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function switchToStudio() { if (window.__switchTab) window.__switchTab("studio"); }

  // ---- Studio flow steps --------------------------------------------------
  function initStudioFlow() {
    document.querySelectorAll("[data-studio-step]").forEach(button => {
      button.addEventListener("click", () => activateStudioStep(button.dataset.studioStep));
    });
    document.querySelectorAll("[data-studio-next]").forEach(button => {
      button.addEventListener("click", () => activateStudioStep(button.dataset.studioNext));
    });
    const saved = (() => {
      try { return sessionStorage.getItem("pptgen.studioStep"); }
      catch { return null; }
    })();
    activateStudioStep(isStudioStepAvailable(saved) ? saved : "create", { persist: false, force: true });
    updateStudioFlowNav();
  }

  function isStudioStepAvailable(step) {
    if (step === "create") return true;
    if (step === "cockpit") return studioStepAvailability.cockpit || !!briefChatState;
    if (step === "plan") return studioStepAvailability.plan || !!currentPlan;
    return false;
  }

  function setStudioStepAvailable(step, available = true) {
    if (!(step in studioStepAvailability)) return;
    studioStepAvailability[step] = !!available;
    updateStudioFlowNav();
  }

  function activateStudioStep(step, opts = {}) {
    const { persist = true, force = false } = opts;
    const nextStep = ["create", "cockpit", "plan"].includes(step) ? step : "create";
    if (!force && !isStudioStepAvailable(nextStep)) return false;
    studioStep = nextStep;
    document.querySelectorAll("[data-studio-step-panel]").forEach(panel => {
      const active = panel.dataset.studioStepPanel === studioStep;
      panel.classList.toggle("hidden", !active);
      panel.hidden = !active;
    });
    updateStudioFlowNav();
    syncDeckPreviewVisibility();
    if (persist) {
      try { sessionStorage.setItem("pptgen.studioStep", studioStep); } catch {}
    }
    return true;
  }

  function syncDeckPreviewVisibility() {
    const panel = document.getElementById("deckPreviewPanel");
    if (!panel) return;
    const visible = studioStep === "create" || studioStep === "plan";
    panel.classList.toggle("hidden", !visible);
    panel.setAttribute("aria-hidden", visible ? "false" : "true");
    if (!visible && deckPreviewLightboxOpen) closeDeckPreviewLightbox();
  }

  function updateStudioFlowNav() {
    document.querySelectorAll("[data-studio-step]").forEach(button => {
      const step = button.dataset.studioStep;
      const active = step === studioStep;
      const available = isStudioStepAvailable(step);
      button.classList.toggle("active", active);
      button.disabled = !available;
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.setAttribute("aria-disabled", available ? "false" : "true");
    });
    document.querySelectorAll("[data-studio-next]").forEach(button => {
      button.disabled = !isStudioStepAvailable(button.dataset.studioNext);
    });
  }

  // ---- Studio mode tabs ---------------------------------------------------
  function initStudioMode() {
    const tabs = document.querySelectorAll(".studio-mode-tab");
    const panels = document.querySelectorAll(".studio-mode-panel");
    if (!tabs.length || !panels.length) return;

    const validModes = [...tabs].map(tab => tab.dataset.studioMode);
    const activate = (mode, persist = true) => {
      const nextMode = validModes.includes(mode) ? mode : "brief";
      tabs.forEach(tab => {
        const active = tab.dataset.studioMode === nextMode;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach(panel => {
        const active = panel.dataset.studioModePanel === nextMode;
        panel.classList.toggle("active", active);
        panel.hidden = !active;
      });
      if (persist) {
        try { sessionStorage.setItem("pptgen.studioMode", nextMode); } catch {}
      }
    };

    tabs.forEach(tab => {
      tab.addEventListener("click", () => activate(tab.dataset.studioMode));
    });

    const saved = (() => {
      try { return sessionStorage.getItem("pptgen.studioMode"); }
      catch { return null; }
    })();
    activate(saved || "brief", false);
  }

  // ---- Logging ------------------------------------------------------------
  // Writes to the in-UI logs panel AND the devtools console. `detail` is a
  // value inspectable by expanding a collapsible block under the line.
  // `opts.action = { label, title?, run }` optionally attaches an inline
  // button to the line (used by the build-failed retry button).
  function createBriefWorkItem(fields = {}) {
    if (!briefChatState) return null;
    const id = "work_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
    const item = {
      id,
      groupId: fields.groupId || briefChatState.activeWorkGroupId || id,
      order: nextBriefOrder(),
      time: timeStr(),
      kind: "log",
      level: "info",
      title: "Travail interne",
      status: "done",
      statusText: "",
      detail: "",
      reasoning: "",
      content: "",
      open: false,
      ...fields,
    };
    briefChatState.workItems = briefChatState.workItems || [];
    briefChatState.workItems.push(item);
    renderBriefChat();
    return item;
  }

  function beginBriefWorkGroup(kind = "work") {
    if (!briefChatState) return null;
    const id = "work_group_" + kind + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
    briefChatState.activeWorkGroupId = id;
    briefChatState.workGroupUiState = briefChatState.workGroupUiState || {};
    briefChatState.workGroupUiState[id] = { open: false, followTail: true };
    return id;
  }

  function endBriefWorkGroup(groupId) {
    if (!briefChatState || !groupId) return;
    if (briefChatState.activeWorkGroupId === groupId) briefChatState.activeWorkGroupId = null;
  }

  function getBriefWorkGroupUiState(groupId) {
    if (!briefChatState) return { open: false, followTail: true };
    briefChatState.workGroupUiState = briefChatState.workGroupUiState || {};
    briefChatState.workGroupUiState[groupId] = briefChatState.workGroupUiState[groupId] || { open: false, followTail: true };
    return briefChatState.workGroupUiState[groupId];
  }

  function shouldMirrorLogToBrief(level, detail) {
    if (!briefChatState) return false;
    const debug = document.getElementById("debugLogs")?.checked === true;
    if (debug && detail !== undefined) return true;
    return ["error", "warn", "step", "ok"].includes(level);
  }

  function logStatusText(level) {
    if (level === "error") return "failed";
    if (level === "warn") return "attention";
    if (level === "ok") return "done";
    if (level === "step") return "work";
    return "info";
  }

  function briefWorkTitleFromLog(level, message) {
    const text = String(message || "").trim();
    if (!text) return level === "error" ? "Internal work failed" : "Internal work";
    if (/brief-chat parsed OK/i.test(text)) return "Brief agent finished";
    if (/brief-chat stopped/i.test(text)) return "Brief agent stopped";
    if (/brief-chat failed/i.test(text)) return "Brief agent failed";
    if (/Scoping agent/i.test(text)) return /explanation/i.test(text) ? "Brief agent is explaining..." : "Brief agent is analyzing...";
    if (/^Scoping/i.test(text)) return "Brief agent is analyzing...";
    if (/Brief validated/i.test(text)) return "Deck agent is preparing...";
    if (/ppt-deck-planner parsed OK/i.test(text)) return "Deck agent finished";
    if (/Single agent.*ppt-deck-planner|generating final plan/i.test(text)) return "Deck agent is constructing...";
    if (/Plan validated|Plan displayed/i.test(text)) return "Plan ready";
    if (level === "error") {
      const beforePayload = text.split(/\s+(?:HTTP\s+\d+|[\[{])/)[0].trim().replace(/\s*[:—-]\s*$/, "");
      return beforePayload || "Internal work failed";
    }
    return text.length > 90 ? text.slice(0, 87).trimEnd() + "…" : text;
  }

  function briefWorkDetailFromLog(level, message, detail) {
    const debug = document.getElementById("debugLogs")?.checked === true;
    if (debug && detail !== undefined) {
      return typeof detail === "string" ? detail : JSON.stringify(detail, null, 2);
    }
    if (level !== "error") return "";
    const text = String(message || "").trim().replace(/\s+/g, " ");
    const concise = text.split(/\s+(?=[{\[])/)[0].trim().replace(/\s*[:—-]\s*$/, "");
    const bounded = concise.length > 240 ? concise.slice(0, 237).trimEnd() + "…" : concise;
    return bounded
      ? `${bounded}\nEnable debug mode to see full technical detail.`
      : "Technical error. Enable debug mode to see full detail.";
  }

  function streamWorkTitle(agentName, fallback = "") {
    if (fallback) return fallback;
    if (/brief-chat/i.test(agentName)) return "Brief agent is analyzing...";
    if (/ppt-deck-planner/i.test(agentName)) return "Deck agent is constructing...";
    if (/ppt-speaker-notes/i.test(agentName)) return "Speaker notes agent is drafting...";
    return "Working";
  }

  function updateBriefWorkItemDom(item) {
    if (!item) return;
    if (!item._root) {
      if (briefChatState?.workItems?.includes(item)) updateBriefWorkGroupDom(item.groupId);
      return;
    }
    item._root.open = !!item.open;
    item._root.classList.toggle("running", item.status === "running");
    item._root.classList.toggle("failed", item.status === "error");
    item._root.classList.toggle("done", item.status === "done");
    if (item._status) item._status.textContent = item.statusText || logStatusText(item.level);
    if (item._reasoningBlock && item._reasoningBody) {
      item._reasoningBlock.classList.toggle("hidden", !item.reasoning);
      item._reasoningBody.textContent = item.reasoning || "";
    }
    if (item._contentBlock && item._contentBody) {
      item._contentBlock.classList.toggle("hidden", !item.content);
      item._contentBody.textContent = item.content || "";
    }
    if (item._empty) {
      item._empty.classList.toggle("hidden", !!(item.reasoning || item.content || item.detail));
    }
  }

  function log(level, msg, detail, opts = {}) {
    const debug = document.getElementById("debugLogs")?.checked === true;
    const logsCard = document.getElementById("logsCard");
    if (logsCard) logsCard.classList.remove("hidden");
    const el = document.getElementById("logs");
    if (!el) {
      if (shouldMirrorLogToBrief(level, detail)) {
        createBriefWorkItem({
          kind: "log",
          level,
          title: briefWorkTitleFromLog(level, msg),
          status: level === "error" ? "error" : "done",
          statusText: logStatusText(level),
          detail: briefWorkDetailFromLog(level, msg, detail),
          action: opts.action,
          open: false,
        });
      }
      const c = level === "error" ? console.error
              : level === "warn"  ? console.warn
              : console.log;
      debug && detail !== undefined ? c(`[${level}] ${msg}`, detail) : c(`[${level}] ${msg}`);
      return;
    }
    const line = document.createElement("div");
    line.className = "log-line thinking-log-line";
    line.innerHTML =
      `<span class="log-time">${timeStr()}</span>` +
      `<span class="log-level ${level}">${level.toUpperCase()}</span>` +
      `<span class="log-msg"></span>`;
    const msgEl = line.querySelector(".log-msg");
    msgEl.textContent = msg;
    if (debug && detail !== undefined) {
      const pre = document.createElement("pre");
      pre.className = "log-expand";
      pre.textContent = typeof detail === "string"
        ? detail
        : JSON.stringify(detail, null, 2);
      msgEl.appendChild(pre);
    }
    if (opts.action && typeof opts.action.run === "function") {
      const ctls = document.createElement("span");
      ctls.className = "stream-ctls";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stream-ctl retry";
      btn.textContent = opts.action.label || "Action";
      if (opts.action.title) btn.title = opts.action.title;
      btn.addEventListener("click", () => {
        btn.disabled = true;
        btn.textContent = "… relance";
        opts.action.run();
      });
      ctls.appendChild(btn);
      msgEl.appendChild(ctls);
    }
    el.appendChild(line);
    scrollLogsToBottom();
    const c = level === "error" ? console.error
            : level === "warn"  ? console.warn
            : console.log;
    debug && detail !== undefined ? c(`[${level}] ${msg}`, detail) : c(`[${level}] ${msg}`);
  }

  // Expose log globally so custom_layouts.js can use it.
  window.log = log;

  function scrollLogsToBottom() {
    if (!followTail) return;
    const el = document.getElementById("logs");
    if (!el) return;
    // Use rAF to ensure the DOM measured its new height after the latest
    // textContent update — otherwise scrollHeight reads the pre-update value.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  function updateFollowTailBtn() {
    const btn = document.getElementById("btnFollowTail");
    if (!btn) return;
    btn.classList.toggle("hidden", followTail);
  }

  // Create a live-updating block for a streaming LLM call. Returns a handle
  // with onDelta / finalize / attachRetry methods. When `opts.onAbort` is
  // passed, a ✕ button appears next to the status so the user can kill
  // an in-flight agent (fires the provided callback).
  function logStream(agentName, opts = {}) {
    const logsCard = document.getElementById("logsCard");
    if (logsCard) logsCard.classList.remove("hidden");
    const el = document.getElementById("logs");
    if (!el) {
      const workItem = createBriefWorkItem({
        kind: "stream",
        level: "step",
        title: streamWorkTitle(agentName, opts.workTitle),
        status: "running",
        statusText: "running",
        open: false,
      });
      return {
        onDelta({ fullContent, fullReasoning }) {
          if (!workItem) return;
          if (fullReasoning) workItem.reasoning = fullReasoning;
          if (fullContent) {
            workItem.content = fullContent.length > 4000
              ? fullContent.slice(0, 4000) + "\n... (truncated)"
              : fullContent;
          }
          updateBriefWorkItemDom(workItem);
        },
        finalize(ok, durationMs) {
          if (!workItem) return;
          workItem.status = ok ? "done" : "error";
          workItem.level = ok ? "ok" : "error";
          workItem.statusText = ok ? `done · ${durationMs} ms` : "failed";
          workItem.open = false;
          updateBriefWorkItemDom(workItem);
        },
        attachRetry(onRetry) {
          if (!workItem) return;
          workItem.action = {
            label: "Retry this agent",
            title: "Replay only this agent — previous results are kept",
            run: onRetry,
          };
          renderBriefChat();
        },
      };
    }
    const line = document.createElement("div");
    line.className = "log-line thinking-log-line";
    line.innerHTML =
      `<span class="log-time">${timeStr()}</span>` +
      `<span class="log-level step">STREAM</span>` +
      `<span class="log-msg"></span>`;
    const msg = line.querySelector(".log-msg");
    msg.innerHTML =
      `<strong>${escapeHtml(agentName)}</strong> <span class="stream-status">…</span>` +
      `<span class="stream-ctls"></span>` +
      `<div class="stream-reasoning hidden"><div class="stream-label">Thinking</div><div class="stream-body"></div></div>` +
      `<div class="stream-content hidden"><div class="stream-label">Output</div><div class="stream-body"></div></div>`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;

    const status    = msg.querySelector(".stream-status");
    const ctls      = msg.querySelector(".stream-ctls");
    const rBlock    = msg.querySelector(".stream-reasoning");
    const rBody     = rBlock.querySelector(".stream-body");
    const cBlock    = msg.querySelector(".stream-content");
    const cBody     = cBlock.querySelector(".stream-body");

    let abortBtn = null;
    if (typeof opts.onAbort === "function") {
      abortBtn = document.createElement("button");
      abortBtn.className = "stream-ctl abort";
      abortBtn.textContent = "✕ stop";
      abortBtn.title = "Stop this agent (its result will be invalidated)";
      abortBtn.addEventListener("click", () => {
        abortBtn.disabled = true;
        abortBtn.textContent = "... stopping";
        opts.onAbort();
      });
      ctls.appendChild(abortBtn);
    }

    return {
      onDelta({ fullContent, fullReasoning }) {
        if (fullReasoning) {
          rBlock.classList.remove("hidden");
          rBody.textContent = fullReasoning;
        }
        if (fullContent) {
          cBlock.classList.remove("hidden");
          cBody.textContent = fullContent.length > 4000
            ? fullContent.slice(0, 4000) + "\n... (truncated)"
            : fullContent;
        }
        if (followTail) {
          requestAnimationFrame(() => {
            rBlock.scrollTop = rBlock.scrollHeight;
            cBlock.scrollTop = cBlock.scrollHeight;
            const logsEl = document.getElementById("logs");
            logsEl.scrollTop = logsEl.scrollHeight;
          });
        }
      },
      finalize(ok, durationMs) {
        status.textContent = ok ? `✓ ${durationMs} ms` : `✗ failed`;
        status.classList.add(ok ? "ok" : "err");
        if (abortBtn) { abortBtn.remove(); abortBtn = null; }
      },
      /**
       * Attach a ↻ button that calls `onRetry()` — used when an agent
       * failed so the user can replay just that one. The button keeps
       * itself from double-firing.
       */
      attachRetry(onRetry) {
        const btn = document.createElement("button");
        btn.className = "stream-ctl retry";
        btn.textContent = "Retry this agent";
        btn.title = "Replay only this agent — previous results are kept";
        btn.addEventListener("click", () => {
          btn.disabled = true;
          btn.textContent = "… relance";
          onRetry();
        });
        ctls.appendChild(btn);
      },
    };
  }

  function timeStr() {
    const now = new Date();
    const pad2 = n => String(n).padStart(2, "0");
    const pad3 = n => String(n).padStart(3, "0");
    return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}.${pad3(now.getMilliseconds())}`;
  }

  // ---- prefs persistence --------------------------------------------------
  // Priority at load: config/config.local.js > repository settings > HTML defaults.
  // The API key is session-only unless the user opts into config/config.local.js.
  function restorePrefs() {
    const prefs = window.PPTGen.repoStore.getDocument("settings");
    let sessionKey = "";
    try { sessionKey = sessionStorage.getItem("pptgen.apiKey") || ""; } catch {}

    const fileDefaults = (typeof window.LLM_CONFIG_DEFAULTS === "object"
                          && window.LLM_CONFIG_DEFAULTS) || {};
    localConfigHadApiKey = typeof fileDefaults.apiKey === "string" && fileDefaults.apiKey.length > 0;
    lastRememberKey = prefs.rememberKey === true || localConfigHadApiKey;
    const merged = {
      baseUrl:     fileDefaults.baseUrl     || prefs.baseUrl     || "",
      model:       fileDefaults.model       || prefs.model       || "",
      visionModel: fileDefaults.visionModel || prefs.visionModel || "",
      apiKey:      fileDefaults.apiKey      || sessionKey,
      debugLogs:   prefs.debugLogs === true,
      rememberKey: lastRememberKey,
    };
    if (merged.baseUrl)     document.getElementById("baseUrl").value     = merged.baseUrl;
    if (merged.model)       document.getElementById("model").value       = merged.model;
    if (merged.visionModel) document.getElementById("visionModel").value = merged.visionModel;
    if (merged.apiKey)      document.getElementById("apiKey").value      = merged.apiKey;
    const debug = document.getElementById("debugLogs");
    if (debug) debug.checked = merged.debugLogs;
    const remember = document.getElementById("rememberKey");
    if (remember) remember.checked = merged.rememberKey;
  }

  async function savePrefs() {
    const baseUrl     = document.getElementById("baseUrl").value;
    const model       = document.getElementById("model").value;
    const visionModel = document.getElementById("visionModel").value;
    const apiKey      = document.getElementById("apiKey").value;
    const debugLogs   = document.getElementById("debugLogs")?.checked === true;
    const rememberKey = document.getElementById("rememberKey")?.checked === true;
    const current = window.PPTGen.repoStore.getDocument("settings");
    const payload = {
      baseUrl, model, visionModel, debugLogs, rememberKey,
      ...(current.confirmedProviderHost ? { confirmedProviderHost: current.confirmedProviderHost } : {}),
    };
    sessionStorage.setItem("pptgen.apiKey", apiKey);
    if (window.PPTGen.repoStore.isAvailable()) await window.PPTGen.repoStore.putDocument("settings", payload);
    const shouldWriteLocalConfig = window.PPTGen.repoStore.isAvailable()
      && (rememberKey || lastRememberKey || localConfigHadApiKey);
    if (shouldWriteLocalConfig) {
      await window.PPTGen.localConfig.save({
        baseUrl, model, visionModel,
        apiKey: rememberKey ? apiKey : "",
      });
      localConfigHadApiKey = rememberKey && !!apiKey;
    }
    lastRememberKey = rememberKey;
    renderDataBackupStats();
  }
  function schedulePrefsSave() {
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => savePrefs().catch(error => log("error", error.message)), 500);
  }
  function flushPrefsSave() {
    clearTimeout(prefsTimer);
    prefsTimer = null;
    savePrefs().catch(error => log("error", error.message));
  }
  window.savePrefs = savePrefs;

  function cfg() {
    return {
      baseUrl:     document.getElementById("baseUrl").value.trim(),
      model:       document.getElementById("model").value.trim(),
      visionModel: document.getElementById("visionModel").value.trim(),
      apiKey:      document.getElementById("apiKey").value.trim(),
    };
  }
  // Expose to custom_layouts.js (not inside the IIFE).
  window.cfg = cfg;

  function byteLengthJson(value) {
    const text = JSON.stringify(value == null ? null : value);
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).byteLength;
    return new Blob([text]).size;
  }

  function formatMib(bytes) {
    const mib = bytes / (1024 * 1024);
    const text = mib >= 10 ? Math.round(mib).toString() : mib.toFixed(1);
    return text;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function renderDataBackupStats() {
    const store = window.PPTGen?.repoStore;
    const constraints = window.PPTGen?.constraints || {};
    if (!store) return;
    const caps = constraints.collectionCaps || {};
    const collections = {
      layouts: store.getAll("layouts"),
      icons: store.getAll("icons"),
      photos: store.getAll("photos"),
      history: store.getAll("history"),
    };
    setText("dataLayoutsCount", `${collections.layouts.length} / ${caps.layouts || 0}`);
    setText("dataIconsCount", `${collections.icons.length} / ${caps.icons || 0}`);
    setText("dataPhotosCount", `${collections.photos.length} / ${caps.photos || 0}`);
    setText("dataHistoryCount", `${collections.history.length} / ${caps.history || 0}`);
    const snapshot = {
      settings: store.getDocument("settings"),
      gallery: store.getDocument("gallery"),
      ...collections,
    };
    const bytes = byteLengthJson(snapshot);
    const max = constraints.maxStoreBytes || (128 * 1024 * 1024);
    setText("dataStoreSize", `${formatMib(bytes)} / ${formatMib(max)} MB`);
  }
  window.renderDataBackupStats = renderDataBackupStats;

  function setConnectionStatus(level, message) {
    const status = document.getElementById("connectionStatus");
    if (!status) return;
    status.className = `connection-status ${level || "info"}`;
    status.textContent = message || "";
  }

  function probeSummary(label, result) {
    if (result.ok) return `${label}: OK (${result.model}).`;
    return `${label}: ${result.message}${result.detail ? " " + result.detail : ""}`;
  }

  async function onTestConnection() {
    const button = document.getElementById("btnTestConnection");
    const c = cfg();
    if (!c.apiKey || !c.baseUrl || !c.model) {
      setConnectionStatus("warn", "Enter Base URL, Model, and API Key before testing.");
      return;
    }
    if (button) { button.disabled = true; button.textContent = "Testing..."; }
    setConnectionStatus("info", "Testing provider...");
    try {
      const textProbe = await probeLlmConnection(c, { vision: false });
      const messages = [probeSummary("Text", textProbe)];
      let level = textProbe.ok ? "ok" : "error";
      if (c.visionModel) {
        const visionProbe = await probeLlmConnection(c, { vision: true });
        messages.push(probeSummary("Vision", visionProbe));
        if (!visionProbe.ok) level = "error";
      } else {
        messages.push("Vision: no Vision Model configured; imports will use the main model.");
        if (level === "ok") level = "warn";
      }
      setConnectionStatus(level, messages.join(" "));
      log(textProbe.ok && level !== "error" ? "ok" : "warn", "Connection test: " + messages.join(" "));
    } catch (error) {
      const diagnostic = typeof classifyLlmError === "function"
        ? classifyLlmError(error) : { message: error.message };
      setConnectionStatus("error", diagnostic.message + (diagnostic.detail ? " " + diagnostic.detail : ""));
      log("error", "Connection test failed: " + error.message);
    } finally {
      if (button) { button.disabled = false; button.textContent = "Test connection"; }
    }
  }

  // ---- Brief persistence -------------------------------------------------
  const BRIEF_KEY = "pptgen.brief";

  function saveBrief() {
    const payload = {
      topic:         document.getElementById("topic").value,
      slideCount:    document.getElementById("slideCount").value,
      tone:          document.getElementById("tone").value,
      userContent:   document.getElementById("userContent").value,
      pastePlan:     document.getElementById("pastePlan").value,
      includeSpeakerNotes: document.getElementById("includeSpeakerNotes")?.checked === true,
      uniqueLayoutsPerDeck: document.getElementById("uniqueLayoutsPerDeck")?.checked === true,
    };
    try { sessionStorage.setItem(BRIEF_KEY, JSON.stringify(payload)); }
    catch (e) { /* session storage unavailable */ }
  }

  function restoreBrief() {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(BRIEF_KEY) || "{}"); }
    catch { saved = {}; }
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el && v != null && v !== "") el.value = v;
    };
    set("topic",          saved.topic);
    set("slideCount",     saved.slideCount);
    set("tone",           saved.tone);
    set("userContent",    saved.userContent);
    set("pastePlan",      saved.pastePlan);
    const setChecked = (id, value) => {
      const el = document.getElementById(id);
      if (el && typeof value === "boolean") el.checked = value;
    };
    setChecked("includeSpeakerNotes", saved.includeSpeakerNotes);
    setChecked("uniqueLayoutsPerDeck", saved.uniqueLayoutsPerDeck);
  }

  // ---- Current (awaiting validation) plan persistence --------------------
  const CUR_PLAN_KEY = "pptgen.currentPlan";

  function saveCurrentPlan(plan, display, warnings) {
    try {
      sessionStorage.setItem(CUR_PLAN_KEY, JSON.stringify({
        plan, display: display || "", warnings: warnings || [],
        savedAt: new Date().toISOString(),
      }));
    } catch (e) { log("warn", `Current plan not saved (storage full): ${e.message}`); }
  }

  function clearCurrentPlan() {
    try { sessionStorage.removeItem(CUR_PLAN_KEY); } catch {}
  }

  function restoreCurrentPlan() {
    let raw;
    try { raw = sessionStorage.getItem(CUR_PLAN_KEY); } catch { return false; }
    if (!raw) return false;
    try {
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved.plan) || !saved.plan.length) return false;
      const repaired = repairPlan(saved.plan);
      validatePlan(repaired);                            // throws if outdated
      currentPlan = repaired;
      showPlan(saved.display || buildDisplayFromPlan(repaired),
               saved.warnings || []);
      log("info", `Pending plan restored (saved ${saved.savedAt}).`);
      return true;
    } catch (e) {
      console.warn("restoreCurrentPlan failed:", e);
      clearCurrentPlan();
      return false;
    }
  }

  function stableStringify(value) {
    const seen = new WeakSet();
    const normalize = item => {
      if (!item || typeof item !== "object") return item;
      if (seen.has(item)) return "[Circular]";
      seen.add(item);
      if (Array.isArray(item)) return item.map(normalize);
      return Object.keys(item).sort().reduce((out, key) => {
        out[key] = normalize(item[key]);
        return out;
      }, {});
    };
    return JSON.stringify(normalize(value));
  }

  function hashText(text) {
    let hash = 2166136261;
    const value = String(text || "");
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function limitDraftText(value, max = 300000) {
    const text = String(value || "");
    return text.length > max ? text.slice(text.length - max) : text;
  }

  function generationId() {
    return "gen-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function sanitizeInputsForDraft(inputs = {}) {
    return {
      topic: inputs.topic || "",
      slideCount: inputs.slideCount,
      userContent: inputs.userContent || "",
      includeSpeakerNotes: inputs.includeSpeakerNotes === true,
      uniqueLayoutsPerDeck: inputs.uniqueLayoutsPerDeck === true,
      photosBlock: inputs.photosBlock || null,
      briefChat: inputs.briefChat || null,
      c: {
        baseUrl: inputs.c?.baseUrl || "",
        model: inputs.c?.model || "",
        visionModel: inputs.c?.visionModel || "",
      },
    };
  }

  function buildGenerationHashPayload(inputs, plannerInput) {
    return {
      inputs: sanitizeInputsForDraft(inputs),
      plannerInput,
      selections: {
        layouts: Array.from(LayoutSelection || []).sort(),
        icons: Array.from(IconSelection || []).sort(),
      },
    };
  }

  function hashGenerationInputs(inputs, plannerInput) {
    return hashText(stableStringify(buildGenerationHashPayload(inputs, plannerInput)));
  }

  function readGenerationDraft() {
    let raw;
    try { raw = sessionStorage.getItem(GENERATION_DRAFT_KEY); } catch { return null; }
    if (!raw) return null;
    try {
      const draft = JSON.parse(raw);
      return draft?.version === GENERATION_DRAFT_VERSION ? draft : null;
    } catch {
      return null;
    }
  }

  function writeGenerationDraft(draft) {
    try { sessionStorage.setItem(GENERATION_DRAFT_KEY, JSON.stringify(draft)); }
    catch (error) { console.warn("generation draft not saved:", error); }
  }

  function clearGenerationDraft() {
    try { sessionStorage.removeItem(GENERATION_DRAFT_KEY); } catch {}
  }

  function parseJsonCandidate(text) {
    const value = String(text || "").trim();
    if (!value) return null;
    const candidates = [
      typeof extractLastJson === "function" ? extractLastJson(value) : "",
      typeof stripJsonFences === "function" ? stripJsonFences(value) : value,
      value,
    ].filter(Boolean);
    for (const candidate of candidates) {
      try { return JSON.parse(candidate); } catch { /* try next */ }
    }
    return null;
  }

  function extractPlannerPartial(raw, reasoning) {
    const parsed = parseJsonCandidate(raw) || parseJsonCandidate(reasoning);
    const deck = normalizeDeckPlannerResult(parsed);
    const plan = Array.isArray(deck?.plan) ? deck.plan : [];
    const extractedSlides = plan
      .filter(slide => slide && typeof slide === "object" && typeof slide.layout === "string")
      .slice(0, 100);
    return { lastJson: parsed || null, extractedSlides };
  }

  function createPlannerDraft({ inputs, plannerInput, promptInfo }) {
    const now = new Date().toISOString();
    const draft = {
      version: GENERATION_DRAFT_VERSION,
      generationId: generationId(),
      status: "running",
      phase: "ppt-deck-planner",
      createdAt: now,
      updatedAt: now,
      inputHash: hashGenerationInputs(inputs, plannerInput),
      snapshot: {
        inputs: sanitizeInputsForDraft(inputs),
        plannerInput: promptInfo.plannerInput || plannerInput,
        originalPlannerInput: plannerInput,
        prompt: {
          compressed: !!promptInfo.compressed,
          user: promptInfo.user,
          assessment: promptInfo.assessment || null,
          postCompressionAssessment: promptInfo.postCompressionAssessment || null,
        },
      },
      checkpoint: { raw: "", reasoning: "", lastJson: null, extractedSlides: [], error: null },
      _lastSavedAt: 0,
    };
    writeGenerationDraft(draft);
    return draft;
  }

  function prepareDraftForResume(draft, { inputs, plannerInput, promptInfo }) {
    const previous = draft.checkpoint || {};
    draft.status = "running";
    draft.phase = "ppt-deck-planner";
    draft.updatedAt = new Date().toISOString();
    draft.resumeCount = (draft.resumeCount || 0) + 1;
    draft.snapshot = {
      ...(draft.snapshot || {}),
      inputs: sanitizeInputsForDraft(inputs),
      currentPlannerInput: plannerInput,
      resumePrompt: promptInfo.user,
    };
    draft.checkpoint = {
      raw: "",
      reasoning: "",
      lastJson: null,
      extractedSlides: previous.extractedSlides || [],
      previousError: previous.error || null,
      error: null,
    };
    draft._lastSavedAt = 0;
    writeGenerationDraft(draft);
    return draft;
  }

  function updatePlannerDraftCheckpoint(draft, delta = {}, { error = null, force = false } = {}) {
    if (!draft) return null;
    const checkpoint = draft.checkpoint || {};
    const raw = limitDraftText(delta.fullContent !== undefined
      ? delta.fullContent : (checkpoint.raw || error?.partial?.raw || ""));
    const reasoning = limitDraftText(delta.fullReasoning !== undefined
      ? delta.fullReasoning : (checkpoint.reasoning || error?.partial?.reasoning || ""));
    const partial = extractPlannerPartial(raw, reasoning);
    checkpoint.raw = raw;
    checkpoint.reasoning = reasoning;
    checkpoint.lastJson = partial.lastJson || checkpoint.lastJson || null;
    if (partial.extractedSlides.length) checkpoint.extractedSlides = partial.extractedSlides;
    else checkpoint.extractedSlides = checkpoint.extractedSlides || [];
    if (error) {
      const diagnostic = typeof classifyLlmError === "function" ? classifyLlmError(error) : null;
      checkpoint.error = {
        message: String(error.message || error).slice(0, 500),
        diagnostic,
        partial: error.partial || null,
      };
      draft.status = "interrupted";
    }
    draft.checkpoint = checkpoint;
    draft.updatedAt = new Date().toISOString();
    const now = Date.now();
    if (force || now - (draft._lastSavedAt || 0) > 500) {
      draft._lastSavedAt = now;
      writeGenerationDraft(draft);
    }
    return draft;
  }

  function isResumablePlannerError(error) {
    const diagnostic = typeof classifyLlmError === "function" ? classifyLlmError(error) : null;
    const code = diagnostic?.code || "";
    const message = String(error?.message || "");
    return ["timeout", "network", "parse"].includes(code) || /arr[eê]t|arret/i.test(message);
  }

  function setStatus(text, visible = true) {
    const bar = document.getElementById("status");
    document.getElementById("statusText").textContent = text;
    bar.classList.toggle("hidden", !visible);
  }

  function hideStatus() { setStatus("", false); }

  // ---- Step 1 : scope the brief, then generate the plan --------------------
  //
  // The final deck generation is a single LLM phase. pipelineState
  // stays alive after failures so the retry button can replay the same
  // deck planner with refreshed inputs.
  let pipelineState = null;
  let briefChatState = null;
  let activeGeneration = null;

  const BRIEF_STATUS = {
    ready: {
      label: "Contexte suffisant",
      fallbackReason: "The LLM estimates it has enough context to follow a precise plan.",
    },
    clarify: {
      label: "Clarifications utiles",
      fallbackReason: "The LLM can proceed with assumptions, but recommends clarifying a few points.",
    },
    risky: {
      label: "Contexte faible",
      fallbackReason: "The brief lacks context and the LLM may invent details.",
    },
  };

  function clampConfidence(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function normalizeStringList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => String(item || "").trim()).filter(Boolean).slice(0, 6);
  }

  function normalizeStringListFromFields(...values) {
    for (const value of values) {
      const list = normalizeStringList(value);
      if (list.length) return list;
    }
    return [];
  }

  function firstDefined(...values) {
    return values.find(value => value !== undefined && value !== null);
  }

  function scoreBriefCompleteness(brief) {
    if (!brief || typeof brief !== "object") return 0;
    let score = 0;
    for (const key of ["subject", "audience", "usage_context", "goal", "tone", "suggested_angle"]) {
      if (String(brief[key] || "").trim()) score += 1;
    }
    if (Array.isArray(brief.must_cover) && brief.must_cover.filter(Boolean).length) score += 1;
    if (Array.isArray(brief.avoid) && brief.avoid.filter(Boolean).length) score += 1;
    return score;
  }

  function briefSentences(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map(sentence => sentence.trim())
      .filter(Boolean);
  }

  function inferQuestionsFromReply(reply) {
    return briefSentences(reply)
      .filter(sentence => sentence.includes("?"))
      .map(sentence => sentence.replace(/^Avant de structurer,\s*/i, "").trim())
      .slice(0, 3);
  }

  function briefSearchText(brief) {
    if (!brief || typeof brief !== "object") return "";
    const chunks = [
      brief.subject,
      brief.audience,
      brief.usage_context,
      brief.goal,
      brief.tone,
      brief.suggested_angle,
      ...(Array.isArray(brief.must_cover) ? brief.must_cover : []),
      ...(Array.isArray(brief.avoid) ? brief.avoid : []),
    ];
    return chunks.map(value => String(value || "")).join(" ");
  }

  function normalizeAssumptionText(text) {
    return String(text || "")
      .replace(/^Ça marche,\s*/i, "")
      .replace(/^Je pars pour l'instant sur\s*/i, "Je suppose que ")
      .replace(/^Je pars sur\s*/i, "Je suppose que ")
      .trim();
  }

  function isUsefulRecommendedAssumption(text) {
    const value = String(text || "").trim();
    if (!value) return false;
    const genericDeck = /deck\s+de\s+\d+\s+slides|(?:^|\s)\d+\s+slides|nombre\s+de\s+slides|autour\s+d[eu]'?ne?\s+strat/i.test(value);
    const decisionTerms = /suppos|hypoth[eè]se|par d[eé]faut|faute de pr[eé]cision|plut[oô]t|je retiens|je consid[eè]re|organis|particip|sponsor|interne|partenaire|public|audience|usage|objectif/i.test(value);
    if (genericDeck && !/organis|particip|sponsor|interne|partenaire|public|audience|usage|objectif/i.test(value)) return false;
    return decisionTerms;
  }

  function inferAssumptionsFromBrief(brief, questions = []) {
    const text = briefSearchText(brief);
    const qText = (questions || []).join(" ");
    const out = [];
    const asksOrganizerVsParticipant = /organis/i.test(qText) && /particip|partenaire|embarquer/i.test(qText);
    const assumesOrganizer = /organis|anim|valoris|cadrage|d[ée]fi/i.test(text);
    if (asksOrganizerVsParticipant && assumesOrganizer) {
      out.push("I assume the deck is mainly for organizing/running the hackathon, rather than preparing a participant team or onboarding attendees.");
    }
    if (/audience|public|destin/i.test(qText) && brief?.audience && !/^À confirmer/i.test(String(brief.audience))) {
      out.push("Je suppose que le public principal est : " + String(brief.audience).trim() + ".");
    }
    return out;
  }

  function inferAssumptionsFromReply(reply, brief, questions = []) {
    const out = briefSentences(reply)
      .filter(sentence => !sentence.includes("?"))
      .map(normalizeAssumptionText)
      .filter(isUsefulRecommendedAssumption);
    out.push(...inferAssumptionsFromBrief(brief, questions));
    const seen = new Set();
    return out
      .filter(item => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
  }

  function normalizeBriefStatus(status, ready, brief, questions) {
    const rawStatus = String(status || "").trim();
    const statusIsKnown = ["ready", "clarify", "risky"].includes(rawStatus);
    const completeness = scoreBriefCompleteness(brief);
    if (ready && !questions.length) return "ready";
    if (!brief || typeof brief !== "object" || !Object.keys(brief).length) return "risky";
    if (questions.length) return rawStatus === "risky" ? "risky" : "clarify";
    if (statusIsKnown && rawStatus === "ready") return "ready";
    if (statusIsKnown && rawStatus === "risky" && completeness < 3) return "risky";
    if (completeness >= 4) return "ready";
    return "clarify";
  }

  function normalizeBriefConfidence(value, status, ready, questions) {
    const hasValue = value !== undefined && value !== null && value !== "";
    let confidence = hasValue
      ? clampConfidence(value)
      : (ready ? 0.9 : status === "ready" ? 0.82 : status === "clarify" ? 0.55 : 0.2);
    if (status === "ready" && confidence < 0.75) confidence = 0.82;
    if (status === "clarify" && questions.length && confidence < 0.45) confidence = 0.55;
    if (status === "risky" && confidence > 0.45) confidence = 0.35;
    return confidence;
  }

  function normalizeBriefStatusReason(reason, status, questions) {
    const text = String(reason || "").trim();
    if (status === "ready" && !questions.length && /pr.cis|clarif|manque|question|incertain/i.test(text)) {
      return BRIEF_STATUS.ready.fallbackReason;
    }
    return text || BRIEF_STATUS[status]?.fallbackReason || BRIEF_STATUS.risky.fallbackReason;
  }

  function ensureBriefReadyReply(reply, data) {
    const text = String(reply || "").trim();
    const isReady = data?.contextStatus === "ready" && !(data?.openQuestions || []).length;
    if (!isReady) return text;
    const readyLine = "I have everything I need: the brief is understood and I am ready to start if everything is OK for you.";
    if (!text) return readyLine;
    if (/ready|start|generate|launch|validate|ok|pr[eê]t|pret|d[eé]marr|demarr|lancer|g[eé]n[eé]r|gener|valider|tout est ok/i.test(text)) {
      return text;
    }
    return text + "\n\n" + readyLine;
  }

  function briefSummaryText(brief) {
    if (!brief || typeof brief !== "object") return "";
    const rows = [
      ["Sujet", brief.subject],
      ["Audience", brief.audience],
      ["Usage", brief.usage_context],
      ["Objectif", brief.goal],
      ["Ton", brief.tone],
      ["Angle", brief.suggested_angle],
    ].filter(([, value]) => value);
    const must = Array.isArray(brief.must_cover) && brief.must_cover.length
      ? "Must cover: " + brief.must_cover.join(", ") : "";
    const avoid = Array.isArray(brief.avoid) && brief.avoid.length
      ? "Avoid: " + brief.avoid.join(", ") : "";
    return [...rows.map(([label, value]) => label + " : " + value), must, avoid]
      .filter(Boolean).join("\n");
  }

  function setListItems(list, items, emptyText) {
    if (!list) return;
    list.replaceChildren();
    const values = items.length ? items : [emptyText];
    for (const value of values) {
      const li = document.createElement("li");
      li.textContent = value;
      if (!items.length) li.className = "muted";
      list.appendChild(li);
    }
  }

  function renderBriefContext() {
    const state = briefChatState;
    const statusKey = state?.contextStatus || "risky";
    const status = BRIEF_STATUS[statusKey] || BRIEF_STATUS.risky;
    const badge = document.getElementById("briefContextBadge");
    const text = document.getElementById("briefContextText");
    const reason = document.getElementById("briefContextReason");
    const current = document.getElementById("briefCurrentCard");
    if (badge) {
      badge.classList.remove("ready", "clarify", "risky");
      badge.classList.add(statusKey);
    }
    if (text) {
      const pct = state ? " · " + Math.round((state.contextConfidence || 0) * 100) + "%" : "";
      text.textContent = status.label + pct;
    }
    if (reason) {
      const alreadyStopped = /arrêt/i.test(state?.statusReason || "");
      const suffix = state?.stopped && !alreadyStopped ? " Generation stopped: you can regenerate or add a correction." : "";
      reason.textContent = (state?.statusReason || status.fallbackReason) + suffix;
    }
    const summary = document.getElementById("briefSummary");
    if (current && summary) {
      const summaryText = briefSummaryText(state?.brief);
      current.classList.toggle("hidden", !summaryText && !state?.openQuestions?.length && !state?.recommendedAssumptions?.length);
      summary.textContent = summaryText || "Structured scoping will appear here after analysis.";
    }
    setListItems(document.getElementById("briefOpenQuestions"), state?.openQuestions || [], "No open question.");
    setListItems(document.getElementById("briefAssumptions"), state?.recommendedAssumptions || [], "No specific assumption.");
  }

  function renderBriefButtons() {
    const send = document.getElementById("btnBriefChatSend");
    const explain = document.getElementById("btnBriefExplain");
    const validate = document.getElementById("btnBriefChatValidate");
    const regen = document.getElementById("btnBriefRegenerate");
    const input = document.getElementById("briefChatInput");
    const generationStarted = !!briefChatState?.generationStarted || !!currentPlan;
    const questionCount = Array.isArray(briefChatState?.openQuestions) ? briefChatState.openQuestions.length : 0;
    const clarificationPromptVisible = hasBriefClarificationPromptContent(briefChatState?.briefClarificationPrompt);
    const busy = !!activeGeneration;

    if (input) {
      input.placeholder = generationStarted
        ? "Example: explain your assumption, or take X and Y into account instead."
        : "Answer the question, or add context. Enter sends, Shift+Enter adds a line.";
    }
    if (send) {
      send.textContent = generationStarted ? "Apply note" : "Send";
      send.title = generationStarted
        ? "Add a correction and mark the current plan as outdated"
        : "Send your scoping answer";
      send.disabled = busy;
    }
    if (explain) {
      explain.classList.toggle("hidden", !generationStarted);
      explain.disabled = busy;
    }
    if (validate) {
      const ignore = clarificationPromptVisible
        ? "Ignore clarifications and start generation"
        : questionCount > 1 ? "Ignore questions and start generation" : "Ignore question and start generation";
      validate.textContent = (questionCount || clarificationPromptVisible) ? ignore : "Validate and generate";
      validate.classList.toggle("hidden", generationStarted);
      validate.disabled = busy;
    }
    if (regen) {
      const show = !!briefChatState && generationStarted && !activeGeneration && (briefChatState.stopped || briefChatState.planObsolete);
      regen.classList.toggle("hidden", !show);
    }
  }

  function setActiveGeneration(abort, label, message = "") {
    activeGeneration = { abort, label, message, stopping: false };
    if (briefChatState) briefChatState.stopped = false;
    if (briefChatState) renderBriefChat();
    renderBriefButtons();
  }

  function clearActiveGeneration(abort) {
    if (!abort || activeGeneration?.abort === abort) activeGeneration = null;
    if (briefChatState) renderBriefChat();
    renderBriefButtons();
  }

  function stopActiveGeneration() {
    if (!activeGeneration) return;
    const current = activeGeneration;
    current.stopping = true;
    current.abort.abort();
    if (briefChatState) {
      briefChatState.stopped = true;
      briefChatState.statusReason = current.label + " stopped. You can regenerate or add a correction.";
    }
    log("warn", "Stop requested for " + current.label + ".");
    renderBriefChat();
  }

  function collectPipelineInputs() {
    const c = cfg();
    const topic = document.getElementById("topic").value.trim();
    const slideCount = parseInt(document.getElementById("slideCount").value, 10);
    const tone = getSelectedToneGuide();
    const userContent = document.getElementById("userContent").value.trim();
    const includeSpeakerNotes = document.getElementById("includeSpeakerNotes")?.checked === true;
    const uniqueLayoutsPerDeck = document.getElementById("uniqueLayoutsPerDeck")?.checked === true;
    const photosBlock = (typeof buildPhotosPromptSection === "function")
      ? buildPhotosPromptSection() : null;
    const briefChat = getBriefChatContext();
    return { c, topic, slideCount, tone, userContent, includeSpeakerNotes, uniqueLayoutsPerDeck, photosBlock, briefChat };
  }

  function getSelectedToneGuide() {
    const value = document.getElementById("tone")?.value || "professional";
    const guide = TONE_GUIDES[value] || TONE_GUIDES.professional;
    return { id: value in TONE_GUIDES ? value : "professional", ...guide };
  }

  async function onPlan() {
    try { await savePrefs(); }
    catch (error) {
      log("warn", "Settings not saved: " + error.message);
      window.PPTGen.ui.notify("Generation continues, but settings were not saved.", "warn");
    }
    const c = cfg();
    if (!c.apiKey) { alert("Enter your API key."); return; }
    if (!c.baseUrl) { alert("Entrez la Base URL du provider LLM."); return; }
    if (!await confirmProviderDestination(c.baseUrl)) return;

    const topic = document.getElementById("topic").value.trim();
    const slideCount = parseInt(document.getElementById("slideCount").value, 10);
    if (!topic) { alert("Give the deck a topic."); return; }
    if (!slideCount || slideCount < 4 || slideCount > 20) {
      alert("Slide count must be between 4 and 20.");
      return;
    }
    const selectionIssues = collectPlannerSelectionIssues(slideCount, document.getElementById("uniqueLayoutsPerDeck")?.checked === true);
    if (selectionIssues.errors.length) {
      alert("Sélection de layouts incompatible :\n" + selectionIssues.errors.join("\n"));
      if (window.__switchTab) window.__switchTab("gallery");
      return;
    }
    pipelineState = null;
    activeGeneration = null;
    clearGenerationDraft();
    briefChatState = {
      inputs: collectPipelineInputs(),
      messages: [],
      workItems: [],
      workGroupUiState: {},
      activeWorkGroupId: null,
      briefClarificationPrompt: null,
      brief: null,
      ready: false,
      contextStatus: "risky",
      contextConfidence: 0,
      statusReason: "Initial brief analysis in progress.",
      openQuestions: [],
      recommendedAssumptions: [],
      stopped: false,
      planObsolete: false,
      generationStarted: false,
    };
    currentPlan = null;
    clearCurrentPlan();
    renderDeckPreview(null);
    setStudioStepAvailable("plan", false);
    setStudioStepAvailable("cockpit", true);

    document.getElementById("planSection").classList.add("hidden");
    document.getElementById("result").classList.add("hidden");
    activateStudioStep("cockpit");
    renderBriefChat();

    const initialWorkGroup = beginBriefWorkGroup("brief");
    log("step", "Scoping — " + slideCount + " slides about \"" + topic.slice(0, 60) + "\"");
    log("info", "Provider : " + c.baseUrl + " · model : " + c.model);
    log("info", "Gallery: " + IconSelection.size + "/" + ALLOWED_ICONS.size + " icons, " + LayoutSelection.size + "/" + ALLOWED_LAYOUTS.length + " active layouts");

    if (typeof getPhotos === "function" && getPhotos().length > 0) {
      const visionCfg = { ...c, model: c.visionModel || c.model };
      if (!c.visionModel) {
        log("warn", "Photos: no Vision Model configured — using '" + c.model + "'. If it is not multimodal, descriptions will fail (generic fallback text).");
      }
      try { await ensurePhotoDescriptions(visionCfg, log); }
      catch (e) { log("warn", "Photo description check: " + e.message); }
      briefChatState.inputs.photosBlock = (typeof buildPhotosPromptSection === "function")
        ? buildPhotosPromptSection() : null;
    }
    briefChatState.inputs = collectPipelineInputs();

    if (restartComment) {
      log("info", "User feedback for this regeneration: \"" + restartComment + "\"");
    }

    await callBriefChatAgent("initial", { groupId: initialWorkGroup, endGroup: true });
  }

  function getBriefChatContext() {
    if (!briefChatState) return null;
    return {
      brief: briefChatState.brief,
      ready: !!briefChatState.ready,
      context_status: briefChatState.contextStatus,
      context_confidence: briefChatState.contextConfidence,
      status_reason: briefChatState.statusReason,
      open_questions: briefChatState.openQuestions || [],
      recommended_assumptions: briefChatState.recommendedAssumptions || [],
      messages: briefChatState.messages.slice(-12),
    };
  }

  function nextBriefOrder() {
    briefEventCounter += 1;
    return briefEventCounter;
  }

  function pushBriefMessage(message) {
    if (!briefChatState) return null;
    const next = { ...message, order: message.order || nextBriefOrder() };
    briefChatState.messages.push(next);
    return next;
  }

  function hasBriefClarificationPromptContent(prompt) {
    return !!(prompt?.questions?.length || prompt?.assumptions?.length);
  }

  function setBriefClarificationPrompt(fields = {}) {
    if (!briefChatState) return;
    const questions = Array.isArray(fields.questions) ? fields.questions.filter(Boolean) : [];
    const assumptions = Array.isArray(fields.assumptions) ? fields.assumptions.filter(Boolean) : [];
    const prompt = { order: nextBriefOrder(), questions, assumptions };
    briefChatState.briefClarificationPrompt = hasBriefClarificationPromptContent(prompt) && !briefChatState.generationStarted
      ? prompt
      : null;
  }

  function clearBriefClarificationPrompt() {
    if (briefChatState) briefChatState.briefClarificationPrompt = null;
  }

  function clearBriefOpenQuestionsPrompt() {
    clearBriefClarificationPrompt();
  }

  function activeGenerationText() {
    if (!activeGeneration) return "";
    if (activeGeneration.message) return activeGeneration.message;
    if (activeGeneration.label === "ppt-deck-planner") return "Deck agent is constructing...";
    if (activeGeneration.label === "brief-chat") return "Brief agent is analyzing...";
    if (activeGeneration.label === "ppt-speaker-notes") return "Speaker notes agent is drafting...";
    return activeGeneration.label + " running...";
  }

  function appendActiveGenerationMessage(list) {
    if (!activeGeneration || !list) return;
    const hasRunningWork = (briefChatState?.workItems || []).some(item => item.status === "running");
    if (hasRunningWork) return;
    const item = document.createElement("div");
    item.className = "brief-chat-msg system progress";
    item.setAttribute("role", "status");

    const left = document.createElement("div");
    left.className = "brief-progress-left";

    const spinner = document.createElement("span");
    spinner.className = "spinner brief-progress-spinner";
    spinner.setAttribute("aria-hidden", "true");
    left.appendChild(spinner);

    const text = document.createElement("span");
    text.textContent = activeGeneration.stopping ? activeGeneration.label + ": stopping..." : activeGenerationText();
    left.appendChild(text);

    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "secondary danger brief-progress-stop";
    stop.textContent = activeGeneration.stopping ? "Stopping..." : "Stop";
    stop.disabled = !!activeGeneration.stopping;
    stop.setAttribute("aria-label", "Stop " + activeGeneration.label);
    stop.addEventListener("click", stopActiveGeneration);

    item.appendChild(left);
    item.appendChild(stop);
    list.appendChild(item);
  }

  function renderBriefMessage(message) {
    const item = document.createElement("div");
    const cls = message.role === "user" ? "user" : message.role === "system" ? "system" : "agent";
    item.className = "brief-chat-msg " + cls;
    item.textContent = message.content || "";
    return item;
  }

  function renderBriefClarificationPrompt(prompt) {
    const item = document.createElement("div");
    item.className = "brief-clarification-prompt brief-open-questions-prompt";
    item.setAttribute("role", "note");

    const title = document.createElement("strong");
    title.textContent = "Clarifications before generation";
    item.appendChild(title);

    const hint = document.createElement("p");
    hint.textContent = "Answer or correct these, or ignore them and start generation.";
    item.appendChild(hint);

    const appendSection = (labelText, values) => {
      if (!values?.length) return;
      const label = document.createElement("span");
      label.className = "brief-clarification-label";
      label.textContent = labelText;
      item.appendChild(label);

      const list = document.createElement("ul");
      for (const value of values) {
        const li = document.createElement("li");
        li.textContent = value;
        list.appendChild(li);
      }
      item.appendChild(list);
    };

    appendSection("Open questions", prompt?.questions || []);
    appendSection("Recommended assumptions", prompt?.assumptions || []);
    return item;
  }

  function renderBriefOpenQuestionsPrompt(prompt) {
    return renderBriefClarificationPrompt(prompt);
  }

  function latestBriefWorkItem(items, predicate = () => true) {
    return [...(items || [])].reverse().find(predicate) || null;
  }

  function briefWorkGroupState(items) {
    if ((items || []).some(item => item.status === "running")) return "running";
    if ((items || []).some(item => item.status === "error" || item.level === "error")) return "error";
    return "done";
  }

  function briefWorkGroupTitle(items) {
    const running = latestBriefWorkItem(items, item => item.status === "running");
    if (running) return running.title || activeGenerationText() || "Thinking...";
    const failed = latestBriefWorkItem(items, item => item.status === "error" || item.level === "error");
    if (failed) return failed.title || "Agent work needs attention";
    const latest = latestBriefWorkItem(items);
    if (latest?.title === "Plan ready" || (briefChatState?.generationStarted && deckPreviewHasCurrentPlan())) return "Plan ready";
    return latest?.title || "Thinking complete";
  }

  function briefWorkGroupStatusText(items) {
    const state = briefWorkGroupState(items);
    if (state === "running") return "working";
    if (state === "error") return "needs attention";
    return "done";
  }

  function briefWorkThinkingText(items) {
    const debug = document.getElementById("debugLogs")?.checked === true;
    const debugReasoning = debug ? latestBriefWorkItem(items, item => !!item.reasoning)?.reasoning : "";
    if (debugReasoning) return debugReasoning;
    const running = latestBriefWorkItem(items, item => item.status === "running");
    if (running) return `${running.title || activeGenerationText() || "The agent is working."}\nBackground work is running; open the section below for the technical trail.`;
    const failed = latestBriefWorkItem(items, item => item.status === "error" || item.level === "error");
    if (failed) return "The agent hit an issue. The background trail below shows the useful error context.";
    if (briefChatState?.generationStarted && deckPreviewHasCurrentPlan()) return "Plan ready. Review the proposed plan before generating the .pptx.";
    return "The latest agent step is complete.";
  }

  function briefWorkBackgroundText(items) {
    const debug = document.getElementById("debugLogs")?.checked === true;
    if (!items?.length) return "No background work yet.";
    return items.map(item => {
      const status = item.statusText || logStatusText(item.level);
      const head = [item.time, item.title || "Background work", status].filter(Boolean).join(" - ");
      const parts = [head];
      if (item.detail) parts.push(item.detail);
      if (debug && item.reasoning) parts.push("Thinking stream:\n" + item.reasoning);
      if (debug && item.content) parts.push("Output stream:\n" + item.content);
      return parts.join("\n");
    }).join("\n\n");
  }

  function briefWorkGroupOrder(items) {
    const streams = (items || []).filter(item => item.kind === "stream" && Number.isFinite(item.order));
    if (streams.length) return Math.max(...streams.map(item => item.order));
    const ordered = (items || []).filter(item => Number.isFinite(item.order));
    return ordered.length ? Math.min(...ordered.map(item => item.order)) : 0;
  }

  function groupBriefWorkItems(items) {
    const groups = new Map();
    for (const item of items || []) {
      const groupId = item.groupId || item.id;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(item);
    }
    return [...groups.entries()].map(([groupId, groupItems]) => ({
      type: "workGroup",
      groupId,
      order: briefWorkGroupOrder(groupItems),
      items: groupItems,
    }));
  }

  function briefWorkUniqueActions(items) {
    const unique = new Map();
    for (const item of [...(items || [])].reverse()) {
      if (!item.action || typeof item.action.run !== "function") continue;
      const label = item.action.label || "Action";
      const normalizedLabel = label.replace(/^[^\w]+/u, "").trim().toLowerCase();
      const normalizedKey = `${normalizedLabel}\n${item.action.title || ""}`;
      if (!unique.has(normalizedKey)) unique.set(normalizedKey, item.action);
    }
    return [...unique.values()].reverse();
  }

  function briefWorkIsNearBottom(element) {
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < 36;
  }

  function setBriefWorkJumpVisible(groupId, visible) {
    const refs = briefChatState?._workGroupRefsById?.[groupId];
    if (!refs?.jump) return;
    refs.jump.classList.toggle("hidden", !visible);
  }

  function scrollBriefWorkToBottom(groupId) {
    const refs = briefChatState?._workGroupRefsById?.[groupId];
    if (!refs) return;
    const uiState = getBriefWorkGroupUiState(groupId);
    requestAnimationFrame(() => {
      if (refs.body) refs.body.scrollTop = refs.body.scrollHeight;
      uiState.followTail = true;
      setBriefWorkJumpVisible(groupId, false);
    });
  }

  function updateBriefWorkGroupDom(groupId) {
    const refs = briefChatState?._workGroupRefsById?.[groupId];
    if (!refs) {
      if (briefChatState?.workItems?.some(item => item.groupId === groupId)) renderBriefChat();
      return;
    }
    const uiState = getBriefWorkGroupUiState(groupId);
    const wasFollowing = uiState.followTail !== false || briefWorkIsNearBottom(refs.body);
    const items = (briefChatState?.workItems || []).filter(item => item.groupId === groupId);
    const state = briefWorkGroupState(items);
    refs.root.className = "brief-work-item brief-work-group " + state;
    refs.root.open = !!uiState.open;
    refs.title.textContent = briefWorkGroupTitle(items);
    refs.status.textContent = briefWorkGroupStatusText(items);
    refs.count.textContent = `${items.length} event${items.length === 1 ? "" : "s"}`;
    if (refs.stop) {
      const showStop = !!activeGeneration && state === "running";
      refs.stop.classList.toggle("hidden", !showStop);
      refs.stop.textContent = activeGeneration?.stopping ? "Stopping..." : "Stop";
      refs.stop.disabled = !!activeGeneration?.stopping;
    }
    refs.thinkingBody.textContent = briefWorkThinkingText(items);
    refs.backgroundBody.textContent = briefWorkBackgroundText(items);
    if (wasFollowing) {
      scrollBriefWorkToBottom(groupId);
    } else {
      setBriefWorkJumpVisible(groupId, true);
    }
  }

  function renderBriefWorkGroup(items) {
    const safeItems = (items || []).filter(Boolean);
    const groupId = safeItems[0]?.groupId || "work_group_unknown";
    const uiState = getBriefWorkGroupUiState(groupId);
    const state = briefWorkGroupState(safeItems);
    const details = document.createElement("details");
    details.className = "brief-work-item brief-work-group " + state;
    details.open = !!uiState.open;
    details.setAttribute("role", "group");
    details.setAttribute("aria-label", "Agent thinking and background work");
    details.addEventListener("toggle", () => {
      uiState.open = details.open;
    });

    const summary = document.createElement("summary");
    summary.className = "brief-work-summary";

    const left = document.createElement("span");
    left.className = "brief-work-left";
    const pulse = document.createElement("span");
    pulse.className = "brief-work-pulse";
    pulse.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "brief-work-title";
    title.textContent = briefWorkGroupTitle(safeItems);
    left.append(pulse, title);

    const meta = document.createElement("span");
    meta.className = "brief-work-meta";
    const status = document.createElement("span");
    status.className = "brief-work-status";
    status.textContent = briefWorkGroupStatusText(safeItems);
    const count = document.createElement("span");
    count.className = "brief-work-count";
    count.textContent = `${safeItems.length} event${safeItems.length === 1 ? "" : "s"}`;
    meta.append(status, count);
    let stop = null;
    if (activeGeneration && state === "running") {
      stop = document.createElement("button");
      stop.type = "button";
      stop.className = "secondary danger brief-progress-stop brief-work-stop";
      stop.textContent = activeGeneration.stopping ? "Stopping..." : "Stop";
      stop.disabled = !!activeGeneration.stopping;
      stop.setAttribute("aria-label", "Stop " + activeGeneration.label);
      stop.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        stopActiveGeneration();
      });
      meta.appendChild(stop);
    }

    summary.append(left, meta);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "brief-work-body";
    body.addEventListener("scroll", () => {
      const nearBottom = briefWorkIsNearBottom(body);
      uiState.followTail = nearBottom;
      setBriefWorkJumpVisible(groupId, !nearBottom);
    });

    const thinkingBlock = document.createElement("div");
    thinkingBlock.className = "brief-work-detail brief-work-thinking";
    const thinkingLabel = document.createElement("div");
    thinkingLabel.className = "brief-work-label";
    thinkingLabel.textContent = "Thinking";
    const thinkingBody = document.createElement("pre");
    thinkingBody.className = "brief-work-pre";
    thinkingBody.textContent = briefWorkThinkingText(safeItems);
    thinkingBlock.append(thinkingLabel, thinkingBody);
    body.appendChild(thinkingBlock);

    const backgroundBlock = document.createElement("div");
    backgroundBlock.className = "brief-work-detail brief-work-background";
    const backgroundLabel = document.createElement("div");
    backgroundLabel.className = "brief-work-label";
    backgroundLabel.textContent = "Background work";
    const backgroundBody = document.createElement("pre");
    backgroundBody.className = "brief-work-pre";
    backgroundBody.textContent = briefWorkBackgroundText(safeItems);
    backgroundBlock.append(backgroundLabel, backgroundBody);
    body.appendChild(backgroundBlock);

    briefWorkUniqueActions(safeItems)
      .forEach(itemAction => {
        const action = document.createElement("button");
        action.type = "button";
        action.className = "secondary brief-work-action";
        action.textContent = itemAction.label || "Action";
        if (itemAction.title) action.title = itemAction.title;
        action.addEventListener("click", event => {
          event.preventDefault();
          action.disabled = true;
          action.textContent = "... retrying";
          itemAction.run();
        });
        body.appendChild(action);
      });

    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "brief-work-jump hidden";
    jump.textContent = "New activity - jump to bottom";
    jump.addEventListener("click", event => {
      event.preventDefault();
      uiState.followTail = true;
      scrollBriefWorkToBottom(groupId);
    });
    body.appendChild(jump);

    details.appendChild(body);
    if (briefChatState) {
      briefChatState._workGroupRefsById = briefChatState._workGroupRefsById || {};
      briefChatState._workGroupRefsById[groupId] = {
        root: details,
        title,
        status,
        count,
        body,
        thinkingBody,
        backgroundBody,
        jump,
        stop,
      };
      if (uiState.followTail !== false) scrollBriefWorkToBottom(groupId);
      else setBriefWorkJumpVisible(groupId, true);
    }
    return details;
  }

  function renderBriefWorkItem(item) {
    return renderBriefWorkGroup([item]);
  }

  function renderBriefChat() {
    const section = document.getElementById("briefChatSection");
    const list = document.getElementById("briefChatMessages");
    if (!section || !list || !briefChatState) return;
    section.classList.remove("hidden");
    list.replaceChildren();
    const workItems = briefChatState.workItems || [];
    briefChatState._workGroupRefsById = {};
    const timeline = [
      ...(briefChatState.messages || []).map(item => ({ type: "message", order: item.order || 0, item })),
      ...groupBriefWorkItems(workItems),
      ...(hasBriefClarificationPromptContent(briefChatState.briefClarificationPrompt)
        ? [{ type: "clarificationPrompt", order: briefChatState.briefClarificationPrompt.order || 0, item: briefChatState.briefClarificationPrompt }]
        : []),
    ].sort((a, b) => a.order - b.order);
    if (!timeline.length) {
      list.appendChild(renderBriefMessage({ role: "system", content: "Brief analysis..." }));
    }
    for (const entry of timeline) {
      const node = entry.type === "workGroup"
        ? renderBriefWorkGroup(entry.items)
        : entry.type === "clarificationPrompt"
          ? renderBriefClarificationPrompt(entry.item)
          : renderBriefMessage(entry.item);
      list.appendChild(node);
    }
    appendActiveGenerationMessage(list);
    renderBriefContext();
    renderBriefButtons();
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  async function onBriefChatSend() {
    if (!briefChatState) {
      await onPlan();
      return;
    }
    const input = document.getElementById("briefChatInput");
    const text = input.value.trim();
    if (!text) return;
    clearBriefClarificationPrompt();
    pushBriefMessage({ role: "user", content: text, intent: "revise" });
    briefChatState.ready = false;
    briefChatState.planObsolete = !!currentPlan || !document.getElementById("planSection").classList.contains("hidden");
    if (briefChatState.planObsolete) {
      currentPlan = null;
      clearCurrentPlan();
      renderDeckPreview(null);
      document.getElementById("planSection").classList.add("hidden");
      setStudioStepAvailable("plan", false);
      activateStudioStep("cockpit");
      document.getElementById("result").classList.add("hidden");
      log("warn", "Scoping changed: the current plan is marked outdated.");
    }
    input.value = "";
    renderBriefChat();
    await callBriefChatAgent("revise");
  }

  async function onBriefExplain() {
    if (!briefChatState) {
      await onPlan();
      return;
    }
    const input = document.getElementById("briefChatInput");
    const text = input.value.trim() || "Explain your diagnostic, assumptions, and what is missing.";
    clearBriefClarificationPrompt();
    pushBriefMessage({ role: "user", content: text, intent: "explain" });
    input.value = "";
    renderBriefChat();
    await callBriefChatAgent("explain");
  }

  async function onBriefRegenerate() {
    if (!briefChatState) {
      await onPlan();
      return;
    }
    briefChatState.stopped = false;
    briefChatState.planObsolete = false;
    clearBriefClarificationPrompt();
    renderBriefChat();
    if (briefChatState.brief) await onBriefChatValidate();
    else await callBriefChatAgent("initial");
  }

  async function onBriefChatValidate() {
    if (!briefChatState) {
      await onPlan();
      return;
    }
    if (!LayoutSelection || LayoutSelection.size === 0) {
      alert("No layout available. Generate an asset pack with at least one layout, then reload the page.");
      return;
    }
    if (briefChatState.contextStatus !== "ready") {
      const assumptions = (briefChatState.recommendedAssumptions || []).map(a => "• " + a).join("\n") || "• The LLM will use its best assumptions.";
      const ok = confirm(
        "The brief is not marked as fully ready.\n\n" +
        (briefChatState.statusReason || BRIEF_STATUS[briefChatState.contextStatus]?.fallbackReason || "Incomplete context.") + "\n\n" +
        "Assumptions used if you continue:\n" + assumptions +
        "\n\nContinue and generate the plan?"
      );
      if (!ok) return;
    }

    briefChatState.ready = true;
    briefChatState.generationStarted = true;
    clearBriefClarificationPrompt();
    briefChatState.inputs = collectPipelineInputs();
    pipelineState = {
      inputs: { ...briefChatState.inputs, briefChat: getBriefChatContext() },
      deck: null,
      plannerStream: null,
    };

    document.getElementById("planSection").classList.add("hidden");
    setStudioStepAvailable("plan", false);
    activateStudioStep("cockpit");
    document.getElementById("result").classList.add("hidden");
    const deckWorkGroup = beginBriefWorkGroup("deck");
    try {
      log("step", "Brief validated — generating final plan");
      await runPipelineFrom("deck_planner");
    } finally {
      endBriefWorkGroup(deckWorkGroup);
    }
  }

  async function callBriefChatAgent(interactionType = "initial", opts = {}) {
    if (!briefChatState) return;
    const workGroupId = opts.groupId || beginBriefWorkGroup("brief");
    const previousWorkGroupId = briefChatState.activeWorkGroupId;
    briefChatState.activeWorkGroupId = workGroupId;
    briefChatState.inputs = { ...briefChatState.inputs, ...collectPipelineInputs() };
    const { c, topic, slideCount, tone, userContent, photosBlock } = briefChatState.inputs;
    const chatUser = JSON.stringify({
      topic,
      slide_count: slideCount,
      tone,
      interaction_type: interactionType,
      ...(userContent ? { user_content: userContent } : {}),
      chat_history: briefChatState.messages,
      ...(briefChatState.brief ? { current_brief: briefChatState.brief } : {}),
      ...(restartComment ? { user_feedback_on_previous_attempt: restartComment } : {}),
      ...(photosBlock ? { user_photos: photosBlock } : {}),
    }, null, 2);

    const btnStart = document.getElementById("btnPlan");
    const btnSend = document.getElementById("btnBriefChatSend");
    const btnExplain = document.getElementById("btnBriefExplain");
    const btnValidate = document.getElementById("btnBriefChatValidate");
    const btnRegenerate = document.getElementById("btnBriefRegenerate");
    [btnStart, btnSend, btnExplain, btnValidate, btnRegenerate].forEach(btn => { if (btn) btn.disabled = true; });

    log("step", interactionType === "explain" ? "Scoping agent — explanation" : "Scoping agent — brief understanding");
    log("info", "Input brief-chat", chatUser);
    hideStatus();

    const abort = new AbortController();
    setActiveGeneration(
      abort,
      "brief-chat",
      interactionType === "explain" ? "Brief agent is explaining..." : "Brief agent is analyzing...",
    );
    try {
      const { r } = await _callAgentWithRepair({
        name: "brief-chat",
        cfg: c, system: PPT_BRIEF_CHAT_SYSTEM, user: chatUser,
        baseOpts: { temperature: interactionType === "explain" ? 0.2 : 0.25 },
        abort,
        workTitle: interactionType === "explain"
          ? "Brief agent is explaining..."
          : interactionType === "revise"
            ? "Brief agent is updating..."
            : "Brief agent is analyzing...",
      });
      const data = normalizeBriefChatResult(r.data, briefChatState);
      if (interactionType !== "explain") {
        if (data.brief && tone?.label) data.brief.tone = tone.label;
        briefChatState.brief = data.brief || briefChatState.brief;
        briefChatState.ready = !!data.ready;
        briefChatState.contextStatus = data.contextStatus;
        briefChatState.contextConfidence = data.contextConfidence;
        briefChatState.statusReason = data.statusReason;
        briefChatState.openQuestions = data.openQuestions;
        briefChatState.recommendedAssumptions = data.recommendedAssumptions;
      }
      const reply = interactionType === "explain" ? data.reply : ensureBriefReadyReply(data.reply, data);
      if (reply) {
        pushBriefMessage({ role: "assistant", content: reply });
      }
      if (interactionType !== "explain") {
        setBriefClarificationPrompt({
          questions: data.openQuestions,
          assumptions: data.recommendedAssumptions,
        });
      }
      log("ok", "brief-chat parsed OK", data);
      renderBriefChat();
    } catch (e) {
      console.error(e);
      if (abort.signal.aborted) {
        briefChatState.stopped = true;
        briefChatState.statusReason = "Scoping stopped. You can regenerate or add a correction.";
        pushBriefMessage({ role: "system", content: "Scoping stopped by user." });
        log("warn", "brief-chat stopped by user.");
      } else {
        log("error", "brief-chat failed: " + e.message);
        alert("Scoping error:\n" + e.message);
      }
      renderBriefChat();
    } finally {
      clearActiveGeneration(abort);
      [btnStart, btnSend, btnExplain, btnValidate, btnRegenerate].forEach(btn => { if (btn) btn.disabled = false; });
      hideStatus();
      renderBriefButtons();
      if (opts.endGroup || !opts.groupId) endBriefWorkGroup(workGroupId);
      if (opts.groupId && !opts.endGroup) briefChatState.activeWorkGroupId = previousWorkGroupId;
    }
  }

  function normalizeBriefChatResult(data, previous = null) {
    if (!data || typeof data !== "object") {
      return {
        reply: "",
        brief: previous?.brief || null,
        ready: false,
        contextStatus: "risky",
        contextConfidence: 0,
        statusReason: BRIEF_STATUS.risky.fallbackReason,
        openQuestions: [],
        recommendedAssumptions: [],
      };
    }
    const reply = String(data.reply || data.message || data.answer || "").trim();
    const brief = data.brief || data.understanding || data.scope || previous?.brief || null;
    let openQuestions = normalizeStringListFromFields(data.open_questions, data.openQuestions, data.questions);
    if (!openQuestions.length) openQuestions = inferQuestionsFromReply(reply);
    let recommendedAssumptions = normalizeStringListFromFields(data.recommended_assumptions, data.recommendedAssumptions, data.assumptions)
      .map(normalizeAssumptionText)
      .filter(isUsefulRecommendedAssumption);
    for (const item of inferAssumptionsFromReply(reply, brief, openQuestions)) {
      if (!recommendedAssumptions.some(existing => existing.toLowerCase() === item.toLowerCase())) {
        recommendedAssumptions.push(item);
      }
    }
    recommendedAssumptions = recommendedAssumptions.slice(0, 3);
    const ready = data.ready === true;
    const rawStatus = firstDefined(data.context_status, data.contextStatus);
    const contextStatus = normalizeBriefStatus(rawStatus, ready, brief, openQuestions);
    const rawConfidence = firstDefined(data.context_confidence, data.contextConfidence);
    return {
      reply,
      brief,
      ready,
      contextStatus,
      contextConfidence: normalizeBriefConfidence(rawConfidence, contextStatus, ready, openQuestions),
      statusReason: normalizeBriefStatusReason(firstDefined(data.status_reason, data.statusReason), contextStatus, openQuestions),
      openQuestions,
      recommendedAssumptions,
    };
  }

  /**
   * Run (or re-run) the single deck planner. The optional `fromPhase`
   * argument is kept so old retry callbacks still land on the new path.
   */
  function collectPlannerSelectionIssues(slideCount, uniqueLayoutsPerDeck) {
    return window.PPTGen.contracts.collectSelectionIssues({
      expectedSlideCount: slideCount,
      enabledLayouts: LayoutSelection,
      uniqueLayoutsPerDeck,
    });
  }

  function ensurePlannerSelectionFeasible() {
    const issues = collectPlannerSelectionIssues(
      pipelineState?.inputs?.slideCount,
      pipelineState?.inputs?.uniqueLayoutsPerDeck === true,
    );
    if (!issues.errors.length) return issues;

    const message = issues.errors.join("\n");
    log("error", `Layout selection is incompatible with the requested deck:\n${message}`, undefined, {
      action: {
        label: "Open Gallery",
        title: "Enable the required structural and content layouts",
        run: () => {
          if (window.__switchTab) window.__switchTab("gallery");
        },
      },
    });
    window.PPTGen.ui.notify("Enable more compatible layouts in Gallery.", "warn");
    const error = new Error(message);
    error._selectionInfeasible = true;
    error._loggedUI = true;
    throw error;
  }

  async function runPipelineFrom(fromPhase = "deck_planner") {
    if (!pipelineState) return;
    const ownedWorkGroup = briefChatState && !briefChatState.activeWorkGroupId
      ? beginBriefWorkGroup("deck")
      : null;

    if (fromPhase !== "deck_planner" && fromPhase !== "deck_planner_resume" && fromPhase !== "fast") {
      log("warn", `Legacy phase "${fromPhase}" requested — restarting the unified deck planner.`);
    }

    const fresh = collectPipelineInputs();
    pipelineState.inputs = { ...pipelineState.inputs, ...fresh };
    pipelineState.deck = null;
    pipelineState.plannerStream = null;

    const btn = document.getElementById("btnPlan");
    btn.disabled = true;
    try {
      ensurePlannerSelectionFeasible();
      await runPhaseDeckPlanner();
      await finalizePipeline({ source: "ppt-deck-planner" });
      pipelineState = null;
    } catch (e) {
      console.error(e);
      // Surface every pipeline failure in the UI with a ↻ retry button on
      // the error line. The validation path (finalizePipeline) already logs
      // its own button with the error fed back to the model — flagged
      // _loggedUI here to avoid a duplicate.
      if (!e._loggedUI) {
        const pipelineAction = e._resumableDraft ? {
          label: "Resume generation",
          title: "Continue from the saved checkpoint",
          run: () => resumePlannerGeneration(e._resumableDraft.generationId),
        } : {
          label: "↻ Retry planner",
          title: "Replay the deck planner — scoping and selections are kept",
          run: () => {
            if (!pipelineState) {
              log("warn", "Pipeline is no longer active — restart generation from the beginning.");
              return;
            }
            runPipelineFrom("deck_planner");
          },
        };
        log("error", `Pipeline failed: ${e.message}`, e, {
          action: pipelineAction,
        });
      }
      // Keep pipelineState alive so retry can reuse prepared photo
      // descriptions, gallery choices, and the validated brief.
    } finally {
      btn.disabled = false;
      hideStatus();
      if (ownedWorkGroup) endBriefWorkGroup(ownedWorkGroup);
    }
  }

  /**
   * Call an LLM agent with one auto-retry on JSON parse failure.
   *
   * The first attempt opens a stream log line with an abort button.
   * If the call succeeds, returns the parsed result.
   * If it fails with "JSON parse failed", we:
   *   1. finalize the first stream as failed,
   *   2. emit a second "<name> (retry)" stream line,
   *   3. rerun with the original user prompt + the failed output
   *      appended as explicit feedback, telling the model to return
   *      pure JSON this time.
   * If the retry ALSO fails, the usual catch in the calling phase
   * attaches the manual ↻ button (so the user can try a third time).
   *
   * Any other error (network, abort, HTTP) propagates without retry.
   */
  async function _callAgentWithRepair({ name, cfg, system, user, baseOpts, abort, workTitle, onDelta }) {
    // --- first attempt
    const stream1 = logStream(name, { workTitle });
    const t0 = performance.now();
    let firstErr;
    try {
      const r = await _raceAbort(abort, () => llmJson(cfg, system, user, {
        ...baseOpts,
        onDelta: d => {
          stream1.onDelta(d);
          if (typeof onDelta === "function") onDelta(d);
        },
        signal: abort.signal,
      }));
      stream1.finalize(true, Math.round(performance.now() - t0));
      return { r, stream: stream1 };
    } catch (e) {
      firstErr = e;
      stream1.finalize(false);
    }

    const msg = firstErr?.message || "";
    const isParseErr = /JSON parse failed/i.test(msg);
    if (!isParseErr || abort.signal.aborted) {
      // Non-parse error OR user aborted → let the caller handle it
      // (shows the manual retry button).
      throw Object.assign(firstErr, { _stream: stream1 });
    }

    // --- auto-retry with feedback
    log("warn", `${name}: invalid JSON -> auto-retry with model feedback`);
    const userText = typeof user === "string" ? user : JSON.stringify(user);
    const snippet  = msg.slice(-1200);        // keep the error + raw snippets
    const repairUser = userText +
      "\n\n---\n" +
      "IMPORTANT: your previous response is not valid JSON. Error:\n" +
      snippet +
      "\n\nReturn ONLY a valid JSON object that follows the schema. " +
      "No prose, no markdown fences, no chain-of-thought — just JSON.";

    const stream2 = logStream(name + " (auto-retry)", { workTitle: workTitle ? workTitle + " — retry" : "" });
    const t1 = performance.now();
    try {
      const r = await _raceAbort(abort, () => llmJson(cfg, system, repairUser, {
        ...baseOpts,
        onDelta: d => {
          stream2.onDelta(d);
          if (typeof onDelta === "function") onDelta(d);
        },
        signal: abort.signal,
      }));
      stream2.finalize(true, Math.round(performance.now() - t1));
      return { r, stream: stream2 };
    } catch (e2) {
      stream2.finalize(false);
      throw Object.assign(e2, { _stream: stream2 });
    }
  }

  /**
   * Race the real LLM call against a rejection that fires the instant
   * `abort.signal` is aborted. Some providers don't close the stream
   * when AbortController fires (they sit silent), so without this race
   * the ✕ click would never reach our catch block.
   */
  function _raceAbort(abort, promiseFactory) {
    const abortRejection = new Promise((_, reject) => {
      if (abort.signal.aborted) {
        reject(new Error("Agent stopped by user."));
        return;
      }
      abort.signal.addEventListener("abort", () => {
        reject(new Error("Agent stopped by user."));
      });
    });
    return Promise.race([promiseFactory(), abortRejection]);
  }

  function buildDeckPlannerInput(inputs) {
    const { topic, slideCount, tone, userContent, includeSpeakerNotes, uniqueLayoutsPerDeck, photosBlock, briefChat } = inputs;
    return {
      topic,
      slide_count: slideCount,
      tone,
      include_speaker_notes: includeSpeakerNotes === true,
      unique_layouts_per_deck: uniqueLayoutsPerDeck === true,
      ...(userContent ? { user_content: userContent } : {}),
      ...(briefChat ? { validated_brief: briefChat.brief, brief_chat_history: briefChat.messages } : {}),
      layouts_catalog: filteredLayoutsCatalog(),
      icons_catalog: filteredIconsCatalog(),
      logos_catalog: filteredLogosCatalog(),
      ...(restartComment ? { user_feedback_on_previous_attempt: restartComment } : {}),
      ...(photosBlock ? { user_photos: photosBlock } : {}),
    };
  }

  async function preparePlannerPrompt({ cfg, plannerInput, abort }) {
    const contextTools = window.PPTGen?.llmContext;
    const initialUser = JSON.stringify(plannerInput, null, 2);
    if (!contextTools?.assessPrompt) {
      return { user: initialUser, plannerInput, compressed: false, assessment: null };
    }

    const assessment = contextTools.assessPrompt({
      model: cfg.model,
      systemPrompt: PPT_DECK_PLANNER_SYSTEM,
      userPrompt: initialUser,
    });
    log("info", `Budget contexte planner : ~${assessment.promptTokens}/${assessment.promptLimit} tokens (reserve reponse ${assessment.responseReserve}).`);
    if (!assessment.needsCompression) {
      return { user: initialUser, plannerInput, compressed: false, assessment };
    }

    log("warn", `Contexte planner volumineux (~${assessment.promptTokens} tokens) : compression automatique avant generation.`);
    const compressionRequest = contextTools.buildCompressionRequest(plannerInput, assessment);
    const compressionUser = JSON.stringify(compressionRequest, null, 2);
    try {
      const { r } = await _callAgentWithRepair({
        name: "context-compressor",
        cfg,
        system: PPT_CONTEXT_COMPRESS_SYSTEM,
        user: compressionUser,
        baseOpts: { temperature: 0.1, timeoutMs: 120_000 },
        abort,
        workTitle: "Compression du contexte",
      });
      const compressedInput = contextTools.buildCompressedPlannerInput(plannerInput, r.data);
      const compressedUser = JSON.stringify(compressedInput, null, 2);
      const postCompressionAssessment = contextTools.assessPrompt({
        model: cfg.model,
        systemPrompt: PPT_DECK_PLANNER_SYSTEM,
        userPrompt: compressedUser,
      });
      log("ok", `Contexte compresse : ~${postCompressionAssessment.promptTokens}/${postCompressionAssessment.promptLimit} tokens pour le planner.`);
      return {
        user: compressedUser,
        plannerInput: compressedInput,
        compressed: true,
        assessment,
        postCompressionAssessment,
      };
    } catch (error) {
      throw new Error("Compression du contexte echouee : " + error.message);
    }
  }

  function buildPlannerResumePrompt({ draft, plannerInput }) {
    const payload = {
      mode: "resume_ppt_deck_planner",
      slide_count: plannerInput.slide_count,
      stable_planner_input: draft.snapshot?.plannerInput || plannerInput,
      current_planner_input: plannerInput,
      checkpoint: {
        error: draft.checkpoint?.error || draft.checkpoint?.previousError || null,
        partial_raw: draft.checkpoint?.raw || "",
        partial_reasoning: draft.checkpoint?.reasoning || "",
        last_json: draft.checkpoint?.lastJson || null,
        already_extracted_slides: draft.checkpoint?.extractedSlides || [],
      },
      resume_instructions: [
        "Continue or repair the interrupted JSON instead of regenerating from scratch.",
        "Reuse already_extracted_slides when valid and avoid duplicate slide ideas.",
        "Return one full final planner JSON object with plan, warnings, and display.",
      ],
    };
    const user = JSON.stringify(payload, null, 2);
    const assessment = window.PPTGen?.llmContext?.assessPrompt?.({
      model: cfg().model,
      systemPrompt: PPT_DECK_PLANNER_RESUME_SYSTEM,
      userPrompt: user,
    }) || null;
    return { user, plannerInput, compressed: false, resume: true, assessment };
  }

  async function resumePlannerGeneration(generationIdToResume) {
    const draft = readGenerationDraft();
    if (!draft || draft.generationId !== generationIdToResume || draft.status !== "interrupted") {
      log("warn", "No resumable interrupted generation is available.");
      return;
    }
    const freshInputs = collectPipelineInputs();
    const plannerInput = buildDeckPlannerInput(freshInputs);
    const currentHash = hashGenerationInputs(freshInputs, plannerInput);
    if (currentHash !== draft.inputHash) {
      log("warn", "Reprise refusee : le brief, les selections ou les photos ont change depuis l'interruption.");
      window.PPTGen.ui.notify("Resume unavailable: inputs changed. Start generation again.", "warn");
      return;
    }
    pipelineState = {
      inputs: freshInputs,
      deck: null,
      plannerStream: null,
      resumeDraft: draft,
    };
    if (briefChatState) {
      briefChatState.generationStarted = true;
      briefChatState.stopped = false;
      renderBriefChat();
    }
    await runPipelineFrom("deck_planner_resume");
  }

  async function runPhaseDeckPlanner() {
    const { c } = pipelineState.inputs;
    const basePlannerInput = buildDeckPlannerInput(pipelineState.inputs);

    log("step", "Single agent - ppt-deck-planner (build-ready plan in one call)");
    hideStatus();

    const abort = new AbortController();
    setActiveGeneration(abort, "ppt-deck-planner", "Deck agent is constructing...");
    let draft = null;
    try {
      const resumeDraft = pipelineState.resumeDraft || null;
      const promptInfo = resumeDraft
        ? buildPlannerResumePrompt({ draft: resumeDraft, plannerInput: basePlannerInput })
        : await preparePlannerPrompt({ cfg: c, plannerInput: basePlannerInput, abort });
      log("info", "Prompt ppt-deck-planner pret", {
        compressed: !!promptInfo.compressed,
        resume: !!promptInfo.resume,
        promptTokens: promptInfo.postCompressionAssessment?.promptTokens || promptInfo.assessment?.promptTokens || null,
        promptLimit: promptInfo.postCompressionAssessment?.promptLimit || promptInfo.assessment?.promptLimit || null,
      });
      draft = resumeDraft
        ? prepareDraftForResume(resumeDraft, { inputs: pipelineState.inputs, plannerInput: basePlannerInput, promptInfo })
        : createPlannerDraft({ inputs: pipelineState.inputs, plannerInput: basePlannerInput, promptInfo });
      const { r, stream } = await _callAgentWithRepair({
        name: resumeDraft ? "ppt-deck-planner (resume)" : "ppt-deck-planner",
        cfg: c,
        system: resumeDraft ? PPT_DECK_PLANNER_RESUME_SYSTEM : PPT_DECK_PLANNER_SYSTEM,
        user: promptInfo.user,
        baseOpts: { temperature: 0.35 },
        abort,
        workTitle: "Deck agent is constructing...",
        onDelta: delta => updatePlannerDraftCheckpoint(draft, delta),
      });
      pipelineState.plannerStream = stream;
      if (r.usedSource === "reasoning-fallback") {
        log("warn", "ppt-deck-planner: JSON recovered from reasoning (empty content).");
      }
      pipelineState.deck = normalizeDeckPlannerResult(r.data);
      if (draft) {
        draft.status = "parsed";
        updatePlannerDraftCheckpoint(draft, { fullContent: r.raw, fullReasoning: r.reasoning }, { force: true });
      }
      log("ok", "ppt-deck-planner parsed OK", pipelineState.deck);
    } catch (error) {
      if (draft && isResumablePlannerError(error)) {
        updatePlannerDraftCheckpoint(draft, {}, { error, force: true });
        error._resumableDraft = draft;
      }
      throw error;
    } finally {
      clearActiveGeneration(abort);
    }
  }

  function normalizeDeckPlannerResult(data) {
    if (Array.isArray(data)) return { plan: data, warnings: [], display: "" };
    if (Array.isArray(data?.plan)) {
      return {
        ...data,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        display: typeof data.display === "string" ? data.display : "",
      };
    }
    if (Array.isArray(data?.slides)) {
      return {
        plan: data.slides,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        display: typeof data.display === "string" ? data.display : "",
      };
    }
    return data;
  }

  function normalizeSpeakerNotesResult(data, slideCount) {
    if (!data || typeof data !== "object" || !Array.isArray(data.notes)) {
      throw new Error("Speaker notes agent did not return a notes array.");
    }
    if (data.notes.length !== slideCount) {
      throw new Error(`Speaker notes agent returned ${data.notes.length} note(s) for ${slideCount} slide(s).`);
    }
    const notes = data.notes.map((note, index) => {
      if (typeof note !== "string") throw new Error(`note slide ${index + 1}: text expected`);
      const text = note.trim();
      if (text.length > SPEAKER_NOTES_MAX_LENGTH) throw new Error(`note slide ${index + 1}: text too long`);
      return text;
    });
    const warnings = Array.isArray(data.warnings)
      ? data.warnings.filter(w => typeof w === "string" && w.trim()).map(w => w.trim())
      : [];
    return { notes, warnings };
  }

  function mergeSpeakerNotes(plan, notes) {
    return plan.map((slide, index) => {
      const next = { ...slide };
      const note = notes[index];
      if (note) next.speakerNotes = note;
      else delete next.speakerNotes;
      return next;
    });
  }

  function planForSpeakerNotes(plan) {
    return plan.map(slide => {
      const copy = { ...slide };
      delete copy.speakerNotes;
      return copy;
    });
  }

  async function runPhaseSpeakerNotes(plan) {
    const { c, topic, userContent, briefChat } = pipelineState.inputs;
    const notesUser = JSON.stringify({
      topic,
      ...(userContent ? { user_content: userContent.slice(0, 2000) } : {}),
      ...(briefChat?.brief ? { validated_brief: briefChat.brief } : {}),
      plan: planForSpeakerNotes(plan),
    }, null, 2);

    log("step", "Dedicated agent - ppt-speaker-notes (speaker notes)");
    log("info", "Input ppt-speaker-notes", notesUser);
    hideStatus();

    const abort = new AbortController();
    setActiveGeneration(abort, "ppt-speaker-notes", "Speaker notes: drafting notes...");
    try {
      const { r } = await _callAgentWithRepair({
        name: "ppt-speaker-notes",
        cfg: c, system: PPT_SPEAKER_NOTES_SYSTEM, user: notesUser,
        baseOpts: { temperature: 0.25 },
        abort,
        workTitle: "Adding speaker notes",
      });
      const normalized = normalizeSpeakerNotesResult(r.data, plan.length);
      log("ok", `ppt-speaker-notes parsed OK: ${normalized.notes.length} notes`);
      return normalized;
    } finally {
      clearActiveGeneration(abort);
    }
  }

  async function retrySpeakerNotesForCurrentPlan() {
    if (!currentPlan || !currentPlan.length) {
      log("warn", "No plan available to retry notes.");
      return;
    }
    const previousPipelineState = pipelineState;
    const snapshotInputs = pipelineState?.inputs || collectPipelineInputs();
    pipelineState = pipelineState || { inputs: snapshotInputs, deck: { plan: currentPlan }, plannerStream: null };
    try {
      const result = await runPhaseSpeakerNotes(currentPlan);
      currentPlan = mergeSpeakerNotes(currentPlan, result.notes);
      const warnings = result.warnings.length ? result.warnings.map(w => `[notes] ${w}`) : [];
      saveCurrentPlan(currentPlan, buildDisplayFromPlan(currentPlan), warnings);
      showPlan(buildDisplayFromPlan(currentPlan), warnings);
      log("ok", "Speaker notes added to the current plan.");
    } catch (error) {
      logSpeakerNotesFailure(error);
    } finally {
      pipelineState = previousPipelineState;
    }
  }

  function logSpeakerNotesFailure(error) {
    log("warn", `Speaker notes not added: ${error.message}`, error, {
      action: {
        label: "Retry notes",
        title: "Replay only the speaker notes agent on the current plan",
        run: retrySpeakerNotesForCurrentPlan,
      },
    });
  }



  async function finalizePipeline({ source = "pipeline" } = {}) {
    const deck = normalizeDeckPlannerResult(pipelineState.deck);
    const { topic } = pipelineState.inputs;
    if (!deck?.plan || !Array.isArray(deck.plan)) {
      const err = new Error(`${source} did not return a valid plan`);
      err._badPlan = true;
      throw err;
    }
    pipelineState.deck = deck;
    // Silent repair: the planner can occasionally emit slide 1 ≠ 'title' or
    // slide N ≠ 'closing'. Patch before validating so we don't throw
    // on easily-fixed structural mistakes.
    deck.plan = repairPlan(deck.plan);
    pipelineState.deck = deck;
    const enforceWarnings = enforceSelectionOnPlan(deck.plan);
    try {
      validatePlan(deck.plan, {
        expectedSlideCount: pipelineState.inputs.slideCount,
        enabledLayouts: LayoutSelection,
        enabledIcons: IconSelection,
        uniqueLayoutsPerDeck: pipelineState.inputs.uniqueLayoutsPerDeck === true,
        requiredPhotoIds: typeof getPhotos === "function" ? getPhotos().map(photo => photo.id) : [],
      });
      log("ok", `Plan validated: ${deck.plan.length} slides, ${new Set(deck.plan.slice(1, -1).map(s => s.layout)).size} distinct layouts`);
    } catch (e) {
      log("error", `Plan validation failed: ${e.message}`, undefined, {
        action: {
          label: "Retry planner",
          title: "Regenerate the plan while sending this error back to the model",
          run: () => {
            if (!pipelineState) {
              log("warn", "Pipeline is no longer active — restart generation from the beginning.");
              return;
            }
            // Feed the validation error back so the next attempt fixes it,
            // instead of regenerating the same invalid plan.
            restartComment = `The previous plan failed validation. Fix it and return a valid plan.\nErrors:\n${e.message}`;
            runPipelineFrom("deck_planner");
          },
        },
      });
      const err = new Error("Invalid plan: " + e.message);
      err._validationFailed = true;
      err._loggedUI = true;
      err._badPlan = true;
      throw err;
    }
    if (enforceWarnings.length) enforceWarnings.forEach(w => log("warn", `[gallery] ${w}`));
    const noteWarnings = [];
    if (pipelineState.inputs.includeSpeakerNotes === true) {
      try {
        const noteResult = await runPhaseSpeakerNotes(deck.plan);
        deck.plan = mergeSpeakerNotes(deck.plan, noteResult.notes);
        pipelineState.deck = deck;
        noteWarnings.push(...noteResult.warnings.map(w => `[notes] ${w}`));
      } catch (error) {
        noteWarnings.push(`Speaker notes not added: ${error.message}`);
        logSpeakerNotesFailure(error);
      }
    }
    const allWarnings = [...(deck.warnings || []), ...enforceWarnings, ...noteWarnings];
    if (deck.warnings?.length) deck.warnings.forEach(w => log("warn", w));
    noteWarnings.forEach(w => log("warn", w));

    const display = deck.display || buildDisplayFromPlan(deck.plan);
    currentPlan = deck.plan;
    saveCurrentPlan(deck.plan, display, allWarnings);
    clearGenerationDraft();
    showPlan(display, allWarnings);
    try {
      await addToHistory({
        topic,
        slideCount: currentPlan.length,
        plan: currentPlan,
        display,
        warnings: allWarnings,
      });
    } catch (error) {
      log("warn", `History not saved: ${error.message}`);
      window.PPTGen.ui.notify("Plan ready, but history could not be saved.", "warn");
    }
    log("step", "Plan displayed. Waiting for user validation.");
    restartComment = "";
  }

  // ---- Step 3 : present plan ----------------------------------------------
  function showPlan(displayMarkdown, warnings) {
    const el = document.getElementById("planOutput");
    el.innerHTML = renderMarkdown(displayMarkdown || "");
    renderSpeakerNotesReview(el, currentPlan);
    const warnEl = document.getElementById("warnings");
    if (warnings && warnings.length) {
      warnEl.innerHTML = "<strong>Warnings:</strong><ul>"
        + warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")
        + "</ul>";
      warnEl.classList.remove("hidden");
    } else {
      warnEl.classList.add("hidden");
    }
    renderDeckPreview(currentPlan);
    setStudioStepAvailable("plan", true);
    activateStudioStep("plan");
    document.getElementById("planSection").scrollIntoView({ behavior: "smooth" });
  }

  function focusDeckPreview() {
    const panel = document.getElementById("deckPreviewPanel");
    if (!panel || !deckPreviewSlides().length) return;
    switchToStudio();
    setStudioStepAvailable("plan", true);
    activateStudioStep("plan");
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    panel.focus({ preventScroll: true });
  }

  function deckPreviewSlides() {
    if (Array.isArray(deckPreviewPlan) && deckPreviewPlan.length) return deckPreviewPlan;
    return Array.isArray(currentPlan) ? currentPlan : [];
  }

  function deckPreviewHasCurrentPlan() {
    return Array.isArray(currentPlan) && currentPlan.length > 0 && deckPreviewStatus !== "last";
  }

  function lastDeckPreviewEntry() {
    const entry = getHistory()[0];
    if (!entry?.plan?.length) return null;
    try {
      const repaired = repairPlan(entry.plan);
      validatePlan(repaired);
      return { ...entry, plan: repaired };
    } catch (error) {
      console.warn("Last deck preview unavailable:", error);
      return null;
    }
  }

  function deckPreviewKickerText(status, fallback = "Deck preview") {
    if (status === "built") return "Deck generated";
    if (status === "last") return "Last deck generated";
    return fallback;
  }

  function deckPreviewElementLabel(element) {
    if (!element) return null;
    const id = element.id ? `#${element.id}` : "";
    const classes = element.className && typeof element.className === "string"
      ? "." + element.className.trim().split(/\s+/).filter(Boolean).join(".")
      : "";
    return `${element.tagName?.toLowerCase() || "node"}${id}${classes}`;
  }

  function deckPreviewButtonSnapshot(button) {
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const style = window.getComputedStyle(button);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = rect.width > 0 && rect.height > 0
      ? document.elementFromPoint(centerX, centerY)
      : null;
    return {
      label: deckPreviewElementLabel(button),
      connected: button.isConnected,
      disabled: !!button.disabled,
      ariaLabel: button.getAttribute("aria-label"),
      delta: button.dataset.deckPreviewDelta || null,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      style: {
        display: style.display,
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
        opacity: style.opacity,
        zIndex: style.zIndex,
      },
      topAtCenter: deckPreviewElementLabel(topElement),
    };
  }

  function deckPreviewDebugState(extra = {}) {
    const slides = deckPreviewSlides();
    return {
      index: deckPreviewIndex,
      slides: slides.length,
      currentPlanSlides: Array.isArray(currentPlan) ? currentPlan.length : 0,
      storedPreviewSlides: Array.isArray(deckPreviewPlan) ? deckPreviewPlan.length : 0,
      status: deckPreviewStatus,
      lightboxOpen: deckPreviewLightboxOpen,
      rendererReady: !!window.PPTGen?.previewRenderer?.renderSlide,
      meta: document.getElementById("deckPreviewMeta")?.textContent?.trim() || null,
      lightboxMeta: document.getElementById("deckPreviewLightboxMeta")?.textContent?.trim() || null,
      deckTitle: deckPreviewDeckTitle || null,
      activeElement: deckPreviewElementLabel(document.activeElement),
      ...extra,
    };
  }

  function deckPreviewLog(action, extra = {}) {
    console.info("[DeckPreview]", action, deckPreviewDebugState(extra));
  }

  function logDeckPreviewControls(action) {
    requestAnimationFrame(() => {
      deckPreviewLog(action, {
        stagePrev: deckPreviewButtonSnapshot(document.querySelector("#deckPreviewStage .deck-preview-nav-previous")),
        stageNext: deckPreviewButtonSnapshot(document.querySelector("#deckPreviewStage .deck-preview-nav-next")),
        lightboxPrev: deckPreviewButtonSnapshot(document.getElementById("btnDeckPreviewLightboxPrev")),
        lightboxNext: deckPreviewButtonSnapshot(document.getElementById("btnDeckPreviewLightboxNext")),
        lightboxClickPrev: deckPreviewButtonSnapshot(document.getElementById("btnDeckPreviewLightboxClickPrev")),
        lightboxClickNext: deckPreviewButtonSnapshot(document.getElementById("btnDeckPreviewLightboxClickNext")),
      });
    });
  }

  window.PPTGen.deckPreviewDebugState = () => deckPreviewDebugState({
    stagePrev: deckPreviewButtonSnapshot(document.querySelector("#deckPreviewStage .deck-preview-nav-previous")),
    stageNext: deckPreviewButtonSnapshot(document.querySelector("#deckPreviewStage .deck-preview-nav-next")),
    lightboxPrev: deckPreviewButtonSnapshot(document.getElementById("btnDeckPreviewLightboxPrev")),
    lightboxNext: deckPreviewButtonSnapshot(document.getElementById("btnDeckPreviewLightboxNext")),
    lightboxClickPrev: deckPreviewButtonSnapshot(document.getElementById("btnDeckPreviewLightboxClickPrev")),
    lightboxClickNext: deckPreviewButtonSnapshot(document.getElementById("btnDeckPreviewLightboxClickNext")),
  });

  function deckPreviewGo(delta) {
    const slides = deckPreviewSlides();
    if (!slides.length) {
      deckPreviewLog("nav-abort-no-slides", { delta });
      return;
    }
    deckPreviewLog("nav-go", { delta, targetIndex: deckPreviewIndex + delta });
    deckPreviewSetIndex(deckPreviewIndex + delta, { wrap: true });
  }

  function deckPreviewSetIndex(index, opts = {}) {
    const slides = deckPreviewSlides();
    if (!slides.length) {
      deckPreviewLog("set-index-abort-no-slides", { requestedIndex: index, opts });
      return;
    }
    const rawIndex = Number.isFinite(index) ? index : 0;
    const next = opts.wrap
      ? (rawIndex + slides.length) % slides.length
      : Math.min(Math.max(rawIndex, 0), slides.length - 1);
    deckPreviewLog("set-index", { requestedIndex: index, nextIndex: next, opts });
    renderDeckPreview(slides, { index: next, status: deckPreviewStatus });
    if (deckPreviewLightboxOpen) renderDeckPreviewLightbox();
  }

  function wireDeckPreviewNavButton(button, delta) {
    if (!button) {
      deckPreviewLog("nav-bind-missing-button", { delta });
      return;
    }
    button.dataset.deckPreviewDelta = String(delta);
    deckPreviewLog("nav-bind", { delta, button: deckPreviewButtonSnapshot(button) });
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      event.stopPropagation();
      deckPreviewNavPointerAt = performance.now();
      try {
        if (event.pointerId != null && button.setPointerCapture) button.setPointerCapture(event.pointerId);
      } catch {}
      deckPreviewLog("nav-pointerdown", {
        delta,
        eventType: event.type,
        pointerType: event.pointerType || null,
        button: deckPreviewButtonSnapshot(button),
      });
      deckPreviewGo(delta);
    });
    button.addEventListener("pointerup", event => {
      event.preventDefault();
      event.stopPropagation();
      deckPreviewLog("nav-pointerup", {
        delta,
        eventType: event.type,
        pointerType: event.pointerType || null,
        button: deckPreviewButtonSnapshot(button),
      });
    });
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const sincePointer = performance.now() - deckPreviewNavPointerAt;
      deckPreviewLog("nav-click", {
        delta,
        sincePointer: Math.round(sincePointer),
        button: deckPreviewButtonSnapshot(button),
      });
      if (sincePointer < 350) {
        deckPreviewLog("nav-click-deduped", { delta, sincePointer: Math.round(sincePointer) });
        return;
      }
      deckPreviewGo(delta);
    });
  }

  function isEditableKeyTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName.toLowerCase();
    return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
  }

  function onDeckPreviewKeydown(event) {
    if (deckPreviewLightboxOpen && event.key === "Escape") {
      event.preventDefault();
      closeDeckPreviewLightbox();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const slides = deckPreviewSlides();
    if (slides.length < 2) {
      deckPreviewLog("keynav-ignored-not-enough-slides", { key: event.key, slides: slides.length });
      return;
    }
    if (isEditableKeyTarget(event.target)) {
      deckPreviewLog("keynav-ignored-editable-target", { key: event.key, target: deckPreviewElementLabel(event.target) });
      return;
    }

    if (deckPreviewLightboxOpen) {
      event.preventDefault();
      deckPreviewLog("keynav-lightbox", { key: event.key, target: deckPreviewElementLabel(event.target) });
      deckPreviewGo(event.key === "ArrowRight" ? 1 : -1);
      return;
    }

    const studio = document.getElementById("navStudio");
    const panel = document.getElementById("deckPreviewPanel");
    const targetInPreview = panel?.contains(event.target);
    const studioVisible = studio?.classList.contains("active");
    if (!targetInPreview && !studioVisible) {
      deckPreviewLog("keynav-ignored-hidden-context", {
        key: event.key,
        target: deckPreviewElementLabel(event.target),
        targetInPreview: !!targetInPreview,
        studioVisible: !!studioVisible,
      });
      return;
    }

    event.preventDefault();
    deckPreviewLog("keynav-preview", { key: event.key, target: deckPreviewElementLabel(event.target) });
    deckPreviewGo(event.key === "ArrowRight" ? 1 : -1);
  }

  function openDeckPreviewLightbox() {
    const slides = deckPreviewSlides();
    if (!slides.length) {
      deckPreviewLog("lightbox-open-abort-no-slides");
      return;
    }
    deckPreviewLog("lightbox-open-request");
    deckPreviewLightboxOpen = true;
    renderDeckPreviewLightbox();
    const lightbox = document.getElementById("deckPreviewLightbox");
    const card = lightbox?.querySelector(".deck-preview-lightbox-card");
    lightbox?.classList.remove("hidden");
    lightbox?.setAttribute("aria-hidden", "false");
    document.body.classList.add("deck-preview-lightbox-open");
    card?.focus({ preventScroll: true });
    logDeckPreviewControls("lightbox-opened-controls");
  }

  function closeDeckPreviewLightbox() {
    const lightbox = document.getElementById("deckPreviewLightbox");
    if (!lightbox || lightbox.classList.contains("hidden")) return;
    deckPreviewLightboxOpen = false;
    lightbox.classList.add("hidden");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("deck-preview-lightbox-open");
    document.querySelector("#deckPreviewStage .deck-preview-slide-hitbox")?.focus({ preventScroll: true });
  }

  function renderDeckPreviewLightbox() {
    const slides = deckPreviewSlides();
    const lightbox = document.getElementById("deckPreviewLightbox");
    const slideWrap = document.getElementById("deckPreviewLightboxSlide");
    const title = document.getElementById("deckPreviewLightboxTitle");
    const kicker = document.getElementById("deckPreviewLightboxKicker");
    const meta = document.getElementById("deckPreviewLightboxMeta");
    const prev = document.getElementById("btnDeckPreviewLightboxPrev");
    const next = document.getElementById("btnDeckPreviewLightboxNext");
    const clickPrev = document.getElementById("btnDeckPreviewLightboxClickPrev");
    const clickNext = document.getElementById("btnDeckPreviewLightboxClickNext");
    if (!lightbox || !slideWrap || !title || !kicker || !meta || !slides.length) {
      deckPreviewLog("lightbox-render-abort", {
        hasLightbox: !!lightbox,
        hasSlideWrap: !!slideWrap,
        hasTitle: !!title,
        hasKicker: !!kicker,
        hasMeta: !!meta,
        slides: slides.length,
      });
      return;
    }

    const slide = slides[deckPreviewIndex];
    deckPreviewLog("lightbox-render", {
      slideTitle: slidePreviewTitle(slide, deckPreviewIndex),
      total: slides.length,
    });
    kicker.textContent = deckPreviewKickerText(deckPreviewStatus);
    title.textContent = slidePreviewTitle(slide, deckPreviewIndex);
    meta.textContent = `${deckPreviewIndex + 1} / ${slides.length}`;
    slideWrap.replaceChildren(
      renderDeckPreviewSlide(slides, deckPreviewIndex, slides.length, { lightbox: true }),
      renderDeckPreviewDots(slides, { lightbox: true })
    );
    if (prev) prev.disabled = slides.length <= 1;
    if (next) next.disabled = slides.length <= 1;
    if (clickPrev) clickPrev.disabled = slides.length <= 1;
    if (clickNext) clickNext.disabled = slides.length <= 1;
    logDeckPreviewControls("lightbox-rendered-controls");
  }

  function slidePreviewTitle(slide, index) {
    return (slide?.title || slide?.headline || slide?.quote || slide?.message || `Slide ${index + 1}`).toString();
  }

  function slidePreviewSummary(slide) {
    return summarizeSpec(slide) || slide?.subtitle || slide?.label || slide?.cta || "Structured plan content.";
  }

  function renderDeckPreview(plan, opts = {}) {
    const panel = document.getElementById("deckPreviewPanel");
    const stage = document.getElementById("deckPreviewStage");
    const strip = document.getElementById("deckPreviewStrip");
    const title = document.getElementById("deckPreviewTitle");
    const kicker = document.getElementById("deckPreviewKicker");
    const meta = document.getElementById("deckPreviewMeta");
    if (!panel || !stage || !strip || !title || !kicker || !meta) return;

    const slides = Array.isArray(plan) ? plan : [];
    if (!slides.length && opts.fallbackToLast !== false) {
      const lastEntry = lastDeckPreviewEntry();
      if (lastEntry) {
        renderDeckPreview(lastEntry.plan, {
          ...opts,
          index: 0,
          status: "last",
          fallbackToLast: false,
          deckTitle: historyTitle(lastEntry),
        });
        return;
      }
    }

    deckPreviewPlan = slides;
    if (!slides.length) {
      deckPreviewLog("preview-render-empty");
      deckPreviewIndex = 0;
      deckPreviewStatus = "ready";
      deckPreviewPlan = [];
      deckPreviewDeckTitle = "";
      closeDeckPreviewLightbox();
      panel.classList.add("is-empty");
      panel.classList.remove("is-ready", "is-built");
      kicker.textContent = "Deck preview";
      title.textContent = "Waiting for a plan";
      meta.textContent = "0 slide";
      stage.innerHTML = `
        <div class="deck-preview-empty">
          <strong>No plan to preview yet</strong>
          <p>Generate or load a plan to display a structured mini-preview of the deck.</p>
        </div>`;
      strip.replaceChildren();
      syncDeckPreviewVisibility();
      return;
    }

    deckPreviewIndex = Math.min(Math.max(opts.index ?? deckPreviewIndex, 0), slides.length - 1);
    const slide = slides[deckPreviewIndex];
    const nextStatus = opts.status || "ready";
    const built = nextStatus === "built";
    const last = nextStatus === "last";
    deckPreviewStatus = built ? "built" : last ? "last" : "ready";
    if (opts.deckTitle !== undefined) {
      deckPreviewDeckTitle = String(opts.deckTitle || "");
    } else if (!last) {
      deckPreviewDeckTitle = "";
    }
    deckPreviewLog("preview-render", {
      requestedIndex: opts.index ?? null,
      resolvedIndex: deckPreviewIndex,
      total: slides.length,
      built,
      last,
      slideTitle: slidePreviewTitle(slide, deckPreviewIndex),
    });
    panel.classList.remove("is-empty");
    panel.classList.toggle("is-built", built || last);
    panel.classList.toggle("is-ready", !built && !last);
    kicker.textContent = deckPreviewKickerText(deckPreviewStatus, "Proposed plan");
    title.textContent = last && deckPreviewDeckTitle
      ? deckPreviewDeckTitle
      : slidePreviewTitle(slide, deckPreviewIndex);
    meta.textContent = `${deckPreviewIndex + 1} / ${slides.length}`;

    stage.replaceChildren(renderDeckPreviewStage(slides, deckPreviewIndex, slides.length));
    logDeckPreviewControls("preview-rendered-controls");
    strip.replaceChildren(...slides.map((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "deck-preview-thumb";
      button.classList.toggle("active", index === deckPreviewIndex);
      if (index === deckPreviewIndex) button.setAttribute("aria-current", "true");
      button.setAttribute("aria-label", `Show slide ${index + 1}`);
      button.title = slidePreviewTitle(item, index);

      const number = document.createElement("span");
      number.className = "deck-preview-thumb-number";
      number.textContent = String(index + 1);

      const canvas = document.createElement("span");
      canvas.className = "deck-preview-thumb-canvas";
      canvas.appendChild(renderDeckPreviewSlide(slides, index, slides.length, { thumbnail: true }));

      const label = document.createElement("span");
      label.className = "sr-only";
      label.textContent = slidePreviewTitle(item, index);

      button.append(number, canvas, label);
      button.addEventListener("click", () => deckPreviewSetIndex(index));
      return button;
    }));
    requestAnimationFrame(() => {
      strip.querySelector(".deck-preview-thumb.active")?.scrollIntoView({ block: "nearest", inline: "center" });
    });
    syncDeckPreviewVisibility();
  }

  function renderDeckPreviewStage(slides, index, total) {
    deckPreviewLog("stage-render", { index, total });
    const frame = document.createElement("div");
    frame.className = "deck-preview-stage-frame";

    const prev = renderDeckPreviewNavButton("previous", "<", -1, total);
    const next = renderDeckPreviewNavButton("next", ">", 1, total);

    const hitbox = document.createElement("button");
    hitbox.type = "button";
    hitbox.className = "deck-preview-slide-hitbox";
    hitbox.title = "Open large preview";
    hitbox.setAttribute("aria-label", "Open large slide preview");
    hitbox.appendChild(renderDeckPreviewSlide(slides, index, total));
    hitbox.addEventListener("click", openDeckPreviewLightbox);

    frame.append(hitbox, prev, next);
    frame.appendChild(renderDeckPreviewDots(slides));
    return frame;
  }

  function renderDeckPreviewNavButton(kind, label, delta, total) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `deck-preview-nav deck-preview-nav-${kind}`;
    button.disabled = total <= 1;
    button.setAttribute("aria-label", kind === "previous" ? "Show previous slide" : "Show next slide");
    button.textContent = label;
    wireDeckPreviewNavButton(button, delta);
    return button;
  }

  function renderDeckPreviewDots(slides, opts = {}) {
    const dots = document.createElement("div");
    dots.className = opts.lightbox
      ? "deck-preview-dots deck-preview-dots-lightbox"
      : "deck-preview-dots";
    dots.setAttribute("aria-label", "Slide navigation");

    slides.forEach((slide, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "deck-preview-dot";
      button.classList.toggle("active", index === deckPreviewIndex);
      if (index === deckPreviewIndex) button.setAttribute("aria-current", "true");
      button.setAttribute("aria-label", `Show slide ${index + 1}: ${slidePreviewTitle(slide, index)}`);
      button.title = slidePreviewTitle(slide, index);
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        deckPreviewSetIndex(index);
      });
      dots.appendChild(button);
    });

    return dots;
  }

  function renderDeckPreviewSlide(slides, index, total, opts = {}) {
    const renderer = window.PPTGen?.previewRenderer;
    if (renderer?.renderSlide) {
      try {
        return renderer.renderSlide(slides, index, { thumbnail: !!opts.thumbnail });
      } catch (error) {
        console.warn("Deck preview render failed:", error);
        return renderDeckPreviewFallback(slides[index], index, total, opts, error);
      }
    }
    return renderDeckPreviewFallback(slides[index], index, total, opts);
  }

  function renderDeckPreviewFallback(slide, index, total, opts = {}, error) {
    const layout = String(slide?.layout || "layout");
    const node = document.createElement("div");
    node.className = opts.thumbnail
      ? "deck-preview-fallback deck-preview-fallback-thumb"
      : `deck-preview-fallback deck-slide-preview deck-slide-${layout.replace(/[^a-z0-9_-]/gi, "-")}`;

    const kicker = document.createElement("span");
    kicker.className = "deck-preview-fallback-kicker";
    kicker.textContent = layout;

    const title = document.createElement("strong");
    title.textContent = slidePreviewTitle(slide, index);

    const summary = document.createElement("p");
    summary.textContent = error ? "Preview unavailable for this slide." : slidePreviewSummary(slide);

    node.append(kicker, title);
    if (!opts.thumbnail) {
      const foot = document.createElement("div");
      foot.className = "deck-preview-foot";
      const current = document.createElement("span");
      current.textContent = `Slide ${index + 1}`;
      const count = document.createElement("span");
      count.textContent = `${total} slides`;
      foot.append(current, count);
      node.append(summary, foot);
    }
    return node;
  }

  function renderSpeakerNotesReview(container, plan) {
    if (!container || !Array.isArray(plan)) return;
    const slidesWithNotes = plan
      .map((slide, index) => ({ slide, index }))
      .filter(item => typeof item.slide?.speakerNotes === "string" && item.slide.speakerNotes.trim());
    if (!slidesWithNotes.length) return;

    const section = document.createElement("div");
    section.className = "speaker-notes-review";
    for (const { slide, index } of slidesWithNotes) {
      const card = document.createElement("div");
      card.className = "speaker-note-card";
      const title = document.createElement("strong");
      title.textContent = `Notes slide ${index + 1} - ${slide.layout}`;
      const text = document.createElement("p");
      text.textContent = slide.speakerNotes.trim();
      card.append(title, text);
      section.appendChild(card);
    }
    container.appendChild(section);
  }

  // ---- Step 5 : build + download ------------------------------------------
  // Map a buildDeck error's `stage` tag to a human-readable level, so the
  // failed-build log line tells the user *where* it broke.
  function describeBuildStage(e) {
    switch (e?.stage) {
      case "validate": return "plan validation";
      case "preload":  return "loading icons/logos";
      case "renderer": return `slide ${e.slideIndex} (layout \`${e.layout}\`) — missing renderer`;
      case "slide":    return `slide ${e.slideIndex} (layout \`${e.layout}\`)`;
      case "export":   return "export .pptx";
      default:         return "build";
    }
  }

  async function onBuild() {
    if (!currentPlan) return;
    const btn = document.getElementById("btnBuild");
    btn.disabled = true;
    try {
      setStatus("Generating .pptx...");
      log("step", "User validation received, generating .pptx");
      const filename = `${slug(document.getElementById("topic").value)}-${timestamp()}.pptx`;
      const t0 = performance.now();
      const { blob } = await buildDeck(currentPlan, filename);
      log("ok", `build_deck completed (${Math.round(performance.now() - t0)} ms, ${Math.round(blob.size / 1024)} KB)`);
      downloadBlob(blob, filename);
      log("ok", `Download started: ${filename}`);

      const res = document.getElementById("result");
      document.getElementById("resultText").textContent =
        `✓ Deck generated: ${filename}. ${currentPlan.length} slides.`;
      document.getElementById("resultText").textContent =
        `${filename} is ready. ${currentPlan.length} slides generated.`;
      res.classList.remove("hidden");
      res.scrollIntoView({ behavior: "smooth" });
      renderDeckPreview(currentPlan, { status: "built" });
      // Plan consumed: clear the in-storage awaiting-validation copy.
      clearCurrentPlan();
    } catch (e) {
      console.error(e);
      // currentPlan is preserved on failure (clearCurrentPlan() runs only on
      // success), so the ↻ button can replay the local .pptx render without
      // re-running the LLM pipeline.
      log("error", `Build failed — ${describeBuildStage(e)}: ${e.message}`, e, {
        action: {
          label: "↻ Retry build",
          title: "Replay only the .pptx rendering (the plan is kept)",
          run: () => {
            if (!currentPlan) {
              log("warn", "Plan is no longer available — restart generation.");
              return;
            }
            onBuild();
          },
        },
      });
    } finally {
      btn.disabled = false;
      hideStatus();
    }
  }

  let restartComment = "";   // consumed once, injected into agent inputs

  // ---- Plan portability: copy / paste / resume ----------------------------

  async function onCopyPlan() {
    if (!currentPlan) return;
    const text = JSON.stringify(currentPlan, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      log("ok", "Plan copied to clipboard (JSON).");
    } catch (e) {
      // Clipboard API blocked on file:// in some browsers — show a textarea fallback.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:20px;left:20px;width:80%;height:60%;z-index:9999;padding:1rem;font-family:monospace;font-size:0.8rem;";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); log("ok", "Plan copied (fallback)."); }
      catch { log("warn", "Could not copy automatically — use Ctrl+C in the textarea."); }
      setTimeout(() => ta.remove(), 5000);
    }
  }

  function onUsePasted() {
    const raw = document.getElementById("pastePlan").value.trim();
    if (!raw) { alert("Paste a plan JSON first."); return; }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { alert("Invalid JSON: " + e.message); return; }
    // Accept either a bare array (plan) or a full history entry {plan, topic, ...}.
    const plan = Array.isArray(parsed) ? parsed : parsed.plan;
    if (!Array.isArray(plan)) { alert("The plan must be a JSON array."); return; }
    const repaired = repairPlan(plan);
    try { validatePlan(repaired); }
    catch (e) { alert("Invalid plan: " + e.message); return; }
    currentPlan = repaired;
    const display = (parsed.display) || buildDisplayFromPlan(repaired);
    saveCurrentPlan(repaired, display, parsed.warnings || []);
    switchToStudio();
    showPlan(display, parsed.warnings || []);
    log("step", `Plan loaded from paste — ${repaired.length} slides.`);
  }

  function onResume() {
    const history = getHistory();
    if (!history.length) return;
    loadHistoryEntry(history[0].id);
  }

  // ---- Plans history ------------------------------------------------------

  const HISTORY_CAP = 20;

  function getHistory() {
    try {
      const list = window.PPTGen.repoStore.getAll("history");
      if (!Array.isArray(list)) return [];
      return list.map(entry => window.PPTGen?.security?.normalizeHistoryEntry(entry))
        .filter(Boolean)
        .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))
        .slice(0, HISTORY_CAP);
    }
    catch { return []; }
  }

  async function saveHistory(list) {
    const normalized = list.map(entry => window.PPTGen.security.normalizeHistoryEntry(entry));
    if (normalized.some(entry => !entry)) throw new Error("Invalid history");
    const wanted = new Set(normalized.map(entry => entry.id));
    for (const entry of normalized) await window.PPTGen.repoStore.put("history", entry);
    for (const entry of window.PPTGen.repoStore.getAll("history")) {
      if (!wanted.has(entry.id)) await window.PPTGen.repoStore.remove("history", entry.id);
    }
  }

  async function addToHistory(entry) {
    if (window.PPTGen.repoStore.isReadOnly()) return;
    const full = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      savedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      topic: entry.topic,
      slideCount: entry.slideCount,
      plan: entry.plan,
      display: entry.display || "",
      warnings: entry.warnings || [],
    };
    await window.PPTGen.repoStore.put("history", full);
    const overflow = window.PPTGen.repoStore.getAll("history")
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))
      .slice(HISTORY_CAP);
    for (const old of overflow) await window.PPTGen.repoStore.remove("history", old.id);
    renderHistory();
    document.getElementById("btnResume").classList.remove("hidden");
  }

  function historyTitle(entry) {
    return String(entry.topic || slidePreviewTitle(entry.plan?.[0], 0) || "Untitled deck").trim();
  }

  function historySummary(entry) {
    const titles = (entry.plan || [])
      .map((slide, index) => slidePreviewTitle(slide, index))
      .filter(Boolean);
    const unique = [...new Set(titles)].slice(0, 5);
    return unique.length
      ? `Covers: ${unique.join(" / ")}`
      : "No slide summary available.";
  }

  function renderHistory() {
    const list = getHistory();
    const ul = document.getElementById("historyList");
    ul.replaceChildren();
    if (!list.length) {
      const empty = document.createElement("li");
      empty.className = "history-empty";
      empty.textContent = "No plan yet - generate one from Studio.";
      ul.appendChild(empty);
      renderDataBackupStats();
      return;
    }
    for (const entry of list) {
      const layouts = entry.plan.slice(1, -1).map(s => s.layout);
      const layoutCount = new Set(layouts).size;
      const li = document.createElement("li");
      li.className = "history-item";
      li.dataset.id = entry.id;
      const meta = document.createElement("div");
      meta.className = "history-meta";
      const topic = document.createElement("div");
      topic.className = "history-topic";
      topic.textContent = historyTitle(entry);
      const summary = document.createElement("div");
      summary.className = "history-summary";
      summary.textContent = historySummary(entry);
      const facts = document.createElement("div");
      facts.className = "history-facts";
      const fact = value => {
        const item = document.createElement("span");
        item.textContent = value;
        return item;
      };
      facts.append(
        fact(`${entry.slideCount} slides`),
        fact(`${layoutCount} layout styles`),
        fact(entry.savedAt),
      );
      meta.append(topic, summary, facts);
      const actions = document.createElement("div");
      actions.className = "history-actions";
      const actionButton = (label, className, handler, ariaLabel = label) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = label;
        button.setAttribute("aria-label", ariaLabel);
        button.addEventListener("click", handler);
        return button;
      };
      actions.append(
        actionButton("Open", "secondary", () => loadHistoryEntry(entry.id)),
        actionButton("Export", "secondary", () => exportHistoryEntry(entry.id)),
        actionButton("×", "secondary danger", () => deleteHistoryEntry(entry.id), `Delete ${historyTitle(entry)}`),
      );
      li.append(meta, actions);
      ul.appendChild(li);
    }
    renderDataBackupStats();
  }

  async function confirmProviderDestination(baseUrl) {
    let host;
    try { host = new URL(baseUrl).host; }
    catch { alert("Invalid Base URL."); return false; }
    const settings = window.PPTGen.repoStore.getDocument("settings");
    let sessionHost = "";
    try { sessionHost = sessionStorage.getItem("pptgen.confirmedProviderHost") || ""; } catch {}
    const previous = settings.confirmedProviderHost || sessionHost;
    if (previous === host) return true;
    const accepted = confirm(
      `Briefs, photos, and plans will be sent to:\n\n${host}\n\nContinue?`,
    );
    if (accepted && window.PPTGen.repoStore.isAvailable()) {
      await window.PPTGen.repoStore.putDocument("settings", { ...settings, confirmedProviderHost: host });
    } else if (accepted) {
      try { sessionStorage.setItem("pptgen.confirmedProviderHost", host); } catch {}
    }
    return accepted;
  }
  window.renderHistory = renderHistory;

  function loadHistoryEntry(id) {
    const entry = getHistory().find(e => e.id === id);
    if (!entry) return;
    const repaired = repairPlan(entry.plan);
    try { validatePlan(repaired); }
    catch (e) { alert("Invalid plan: " + e.message); return; }
    currentPlan = repaired;
    const display = entry.display || buildDisplayFromPlan(repaired);
    saveCurrentPlan(repaired, display, entry.warnings || []);
    switchToStudio();
    showPlan(display, entry.warnings || []);
    log("step", `Plan reloaded from history — ${repaired.length} slides (${entry.savedAt}).`);
  }

  function exportHistoryEntry(id) {
    const entry = getHistory().find(e => e.id === id);
    if (!entry) return;
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" });
    const safe = slug(entry.topic);
    downloadBlob(blob, `plan-${safe}-${entry.id}.json`);
  }

  async function deleteHistoryEntry(id) {
    try {
      await window.PPTGen.repoStore.remove("history", id);
      const list = getHistory();
      renderHistory();
      if (!list.length) document.getElementById("btnResume").classList.add("hidden");
    } catch (error) { alert(`Delete failed: ${error.message}`); }
  }

  async function onClearHistory() {
    if (!confirm("Clear the 20-plan history? This cannot be undone.")) return;
    try {
      await saveHistory([]);
      renderHistory();
      document.getElementById("btnResume").classList.add("hidden");
    } catch (error) { alert(`Delete failed: ${error.message}`); }
  }

  // ---- Config export / import --------------------------------------------

  function onExportConfig() {
    const includeKey = confirm(
      "Include the API key in the exported file?\n\n" +
      "Cancel = leave the key blank in the export (safer for sharing)."
    );
    const prefs = window.PPTGen.repoStore.getDocument("settings");
    prefs.apiKey = includeKey ? document.getElementById("apiKey").value : "";
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      prefs,
      gallery: window.PPTGen.repoStore.getDocument("gallery"),
      plansHistory: getHistory(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadBlob(blob, `aday-config-${ts}.json`);
    log("ok", `Config exported${includeKey ? " (with API key)" : " (without API key)"}.`);
  }

  async function onImportConfigFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      alert("Invalid file: maximum size is 4 MB.");
      return;
    }
    let payload;
    try {
      const text = await file.text();
      payload = window.PPTGen?.security?.normalizeConfigBackup(JSON.parse(text));
    } catch (err) {
      alert("Invalid file: " + err.message);
      return;
    }
    if (!payload) {
      alert("Invalid content or incompatible backup schema.");
      return;
    }
    const mergePlans = confirm(
      "Import mode:\n\n" +
      "OK = Merge plans (append to existing, cap 20)\n" +
      "Cancel = Fully replace local history"
    );
    if (payload.prefs) {
      if (payload.prefs.apiKey) sessionStorage.setItem("pptgen.apiKey", payload.prefs.apiKey);
      delete payload.prefs.apiKey;
      await window.PPTGen.repoStore.putDocument("settings", payload.prefs);
    }
    if (payload.gallery) {
      await window.PPTGen.repoStore.putDocument("gallery", payload.gallery);
    }
    if (Array.isArray(payload.plansHistory)) {
      const existing = mergePlans ? getHistory() : [];
      const merged = [...payload.plansHistory, ...existing].slice(0, HISTORY_CAP);
      await saveHistory(merged);
    }
    log("ok", "Config imported, reloading...");
    setTimeout(() => location.reload(), 300);
  }

  // Minimal fallback display for pasted/imported plans without a synth display.
  function buildDisplayFromPlan(plan) {
    const rows = plan.map((s, i) => {
      const contenu = summarizeSpec(s);
      return `| ${i + 1} | ${s.layout} | ${(s.title || "").slice(0, 40)} | ${contenu} |`;
    }).join("\n");
    return `**Loaded plan — ${plan.length} slides**\n\n`
      + `| # | Layout | Title | Content |\n`
      + `|---|--------|-------|---------|\n`
      + rows;
  }

  function summarizeSpec(s) {
    if (s.layout === "title")    return (s.subtitle || "").slice(0, 40);
    if (s.layout === "closing")  return (s.message || s.cta || "").slice(0, 40);
    if (s.cards)     return `${s.cards.length} cards`;
    if (s.stats)     return `${s.stats.length} KPIs`;
    if (s.steps)     return `${s.steps.length} steps`;
    if (s.stages)    return `${s.stages.length} stages`;
    if (s.levels)    return `${s.levels.length} levels`;
    if (s.tools)     return `${s.tools.length} logos`;
    if (s.tiers)     return `${s.tiers.length} tiers`;
    if (s.sets)      return `${s.sets.length} sets`;
    if (s.left && s.right) return "A vs B";
    if (s.value)     return `${s.value} — ${s.label || ""}`.slice(0, 40);
    if (s.quote)     return "Quote";
    return "";
  }

  // ---- Utilities ----------------------------------------------------------

  function downloadBlob(blob, filename) {
    window.PPTGen.download.saveBlob(blob, filename);
  }

  function slug(s) {
    return (s || "deck").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 50) || "deck";
  }

  function timestamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    }[c]));
  }

  // Minimal markdown renderer — handles bold, tables, lists. Good enough for
  // the synth `display` field; not a full markdown engine.
  function renderMarkdown(md) {
    const lines = md.split("\n");
    const out = [];
    let inTable = false, tableRows = [];
    const flushTable = () => {
      if (tableRows.length) {
        const [head, , ...body] = tableRows;   // skip the separator row
        out.push("<table><thead><tr>" +
          head.map(c => `<th>${inline(c)}</th>`).join("") +
          "</tr></thead><tbody>");
        body.forEach(r => {
          out.push("<tr>" + r.map(c => `<td>${inline(c)}</td>`).join("") + "</tr>");
        });
        out.push("</tbody></table>");
      }
      inTable = false; tableRows = [];
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("|") && line.endsWith("|")) {
        const cells = line.slice(1, -1).split("|").map(c => c.trim());
        tableRows.push(cells);
        inTable = true;
        continue;
      }
      if (inTable) flushTable();
      if (!line) { out.push(""); continue; }
      out.push(`<p>${inline(line)}</p>`);
    }
    if (inTable) flushTable();
    return out.join("\n");
  }

  function inline(s) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }
})();

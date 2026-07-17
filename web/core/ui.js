(function initUi(global) {
  "use strict";
  const PPTGen = global.PPTGen = global.PPTGen || {};
  let activeModal = null;
  let returnFocus = null;
  const focusSelector = [
    "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
    "textarea:not([disabled])", "a[href]", "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  function resolveModal(target) {
    return typeof target === "string" ? document.getElementById(target) : target;
  }
  function openModal(target, opener = document.activeElement) {
    const modal = resolveModal(target);
    if (!modal) return;
    returnFocus = opener instanceof HTMLElement ? opener : null;
    activeModal = modal;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    const focusables = modal.querySelectorAll(focusSelector);
    (focusables.length ? focusables[0] : modal.querySelector(".modal-box"))?.focus();
  }
  function closeModal(target = activeModal) {
    const modal = resolveModal(target);
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    if (activeModal === modal) activeModal = null;
    const previous = returnFocus;
    returnFocus = null;
    previous?.focus();
  }
  function onKeyDown(event) {
    if (!activeModal || activeModal.classList.contains("hidden")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal(activeModal);
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = [...activeModal.querySelectorAll(focusSelector)]
      .filter(element => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (!focusables.length) { event.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }
  function notify(message, level = "info") {
    const region = document.getElementById("appAnnouncements");
    if (!region) return;
    region.dataset.level = level;
    region.textContent = String(message || "");
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".modal").forEach(modal => modal.setAttribute("aria-hidden", "true"));
    document.addEventListener("keydown", onKeyDown);
  });
  PPTGen.ui = { openModal, closeModal, notify };
})(window);

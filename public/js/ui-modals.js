/* public/js/ui-modals.js */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function openModal(id) {
    const m = $(id);
    if (m) m.classList.add("show");
  }

  function closeModal(id) {
    const m = $(id);
    if (m) m.classList.remove("show");
  }

  // open
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-modal-open]");
    if (!btn) return;
    const mid = btn.getAttribute("data-modal-open");
    if (!mid) return;
    openModal(mid);
  });

  // close buttons
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-close]");
    if (!btn) return;
    const id = btn.getAttribute("data-close");
    if (id) closeModal(id);
  });

  // backdrop click closes itself
  document.addEventListener("click", (e) => {
    const back = e.target;
    if (!back || !(back instanceof HTMLElement)) return;
    if (!back.classList.contains("modal-backdrop")) return;
    // only when clicking backdrop (not inside modal)
    if (e.target === back && back.id) closeModal(back.id);
  });

  // ESC closes top-most open modal (simple)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".modal-backdrop.show");
    if (open && open.id) closeModal(open.id);
  });

  // expose small api (optional)
  window.UI_MODALS = { openModal, closeModal };
})();

/* public/js/offer-letters.js */
(() => {
  "use strict";

  const tabs = document.getElementById("tabs");
  if (!tabs) return;

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;

    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
    const pane = document.getElementById(btn.dataset.pane);
    if (pane) pane.classList.add("active");
  });
})();

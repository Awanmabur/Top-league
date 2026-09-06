(function () {
  "use strict";

  document.addEventListener("submit", function (event) {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;

    if (form.dataset.preventSubmit === "true") {
      event.preventDefault();
      return;
    }

    const message = String(form.dataset.confirm || "").trim();
    if (message && !window.confirm(message)) event.preventDefault();
  });

  document.addEventListener("change", function (event) {
    const control = event.target instanceof Element ? event.target.closest("[data-auto-submit]") : null;
    if (!control) return;
    const form = control.closest("form");
    if (!form) return;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  });

  document.addEventListener("click", function (event) {
    const target = event.target instanceof Element ? event.target.closest("[data-click-target],[data-print],[data-dismiss-parent],[data-close-target],[data-reload],[data-copy-target],[data-confirm-submit]") : null;
    if (!target) return;

    if (target.hasAttribute("data-print")) {
      event.preventDefault();
      window.print();
      return;
    }

    if (target.hasAttribute("data-reload")) {
      event.preventDefault();
      window.location.reload();
      return;
    }

    const confirmSubmit = String(target.getAttribute("data-confirm-submit") || "").trim();
    if (confirmSubmit && !window.confirm(confirmSubmit)) {
      event.preventDefault();
      return;
    }

    const closeTarget = String(target.getAttribute("data-close-target") || "").trim();
    if (closeTarget) {
      event.preventDefault();
      const node = document.getElementById(closeTarget);
      if (node) {
        node.classList.remove("show", "active", "open");
        if (node.classList.contains("modal-backdrop") || node.style.display) node.style.display = "none";
        node.setAttribute("aria-hidden", "true");
      }
      return;
    }

    const copyTarget = String(target.getAttribute("data-copy-target") || "").trim();
    if (copyTarget) {
      event.preventDefault();
      const source = document.getElementById(copyTarget);
      const value = source && "value" in source ? String(source.value || "") : String(source?.textContent || "");
      if (!value) return;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(value).then(() => window.alert("Copied.")).catch(() => {});
      } else if (source && typeof source.select === "function") {
        source.select();
        document.execCommand("copy");
        window.alert("Copied.");
      }
      return;
    }

    const clickTarget = String(target.getAttribute("data-click-target") || "").trim();
    if (clickTarget) {
      const node = document.getElementById(clickTarget);
      if (node) {
        event.preventDefault();
        node.click();
      }
      return;
    }

    if (target.hasAttribute("data-dismiss-parent")) {
      event.preventDefault();
      target.parentElement?.remove();
    }
  });
})();

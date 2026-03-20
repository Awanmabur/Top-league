// /public/js/status.js
(() => {
  const $ = (id) => document.getElementById(id);

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("show");
  }

  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("show");
  }

  // Global: buttons that open modals
  document.addEventListener("click", (e) => {
    const openBtn = e.target.closest("[data-open-modal]");
    if (openBtn) {
      openModal(openBtn.dataset.openModal);
      return;
    }

    const closeBtn = e.target.closest("[data-close-modal]");
    if (closeBtn) {
      closeModal(closeBtn.dataset.closeModal);
      return;
    }
  });

  // Close on backdrop click
  ["mUpload", "mUploadAny", "mPay", "mHelp"].forEach((mid) => {
    const el = $(mid);
    if (!el) return;
    el.addEventListener("click", (e) => {
      if (e.target.id === mid) closeModal(mid);
    });
  });

  // Tabs
  const tabs = $("tabs");
  if (tabs) {
    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;

      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
      const paneId = btn.dataset.pane;
      const pane = $(paneId);
      if (pane) pane.classList.add("active");
    });
  }

  // Print
  const btnPrint = $("btnPrint");
  if (btnPrint) btnPrint.addEventListener("click", () => window.print());

  // Copy Application ID (if button exists)
  const btnCopy = $("btnCopy");
  if (btnCopy) {
    btnCopy.addEventListener("click", () => {
      // Grab the Application ID shown in the KPI (2nd card)
      const el = document.querySelector(".grid-kpi .card:nth-child(2) .value");
      const id = el ? el.textContent.trim() : "";
      if (!id || id === "—") return alert("No Application ID found.");

      navigator.clipboard
        .writeText(id)
        .then(() => alert("Copied: " + id))
        .catch(() => prompt("Copy:", id));
    });
  }

  // Edit basic info
  const btnEditBasic = $("btnEditBasic");
  const btnCancelEdit = $("btnCancelEdit");
  const btnSaveBasic = $("btnSaveBasic");
  const basicFields = document.querySelectorAll(".basic");

  function setBasicEditable(on) {
    basicFields.forEach((i) => (i.disabled = !on));
    if (btnCancelEdit) btnCancelEdit.style.display = on ? "inline-flex" : "none";
    if (btnSaveBasic) btnSaveBasic.style.display = on ? "inline-flex" : "none";
    if (btnEditBasic) btnEditBasic.style.display = on ? "none" : "inline-flex";
  }

  if (btnEditBasic) btnEditBasic.addEventListener("click", () => setBasicEditable(true));
  if (btnCancelEdit) btnCancelEdit.addEventListener("click", () => window.location.reload());

  // Upload specific doc (fills modal hidden fields)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-upload");
    if (!btn) return;

    const key = btn.dataset.docKey || "";
    const label = btn.dataset.docLabel || "";

    const uKey = $("uKey");
    const uLabel = $("uLabel");

    if (uKey) uKey.value = key;
    if (uLabel) uLabel.value = label;

    openModal("mUpload");
  });

  // Preview doc
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-preview");
    if (!btn) return;

    const docKey = btn.dataset.docKey || "";
    if (!docKey) return alert("Preview not available.");

    // Application ID is on KPI
    const idEl = document.querySelector(".grid-kpi .card:nth-child(2) .value");
    const appId = idEl ? idEl.textContent.trim() : "";
    if (!appId || appId === "—") return alert("Missing Application ID.");

    window.open(
      "/admissions/status/documents/" + encodeURIComponent(appId) + "/" + encodeURIComponent(docKey),
      "_blank"
    );
  });

  // Help button in header
  const btnHelp = $("btnHelp");
  if (btnHelp) btnHelp.addEventListener("click", () => openModal("mHelp"));

  // Make close buttons work (optional)
  // Add data-close-modal="mUpload" etc on your X buttons if you want.
  window.__statusCloseModal = closeModal; // optional for debugging
})();

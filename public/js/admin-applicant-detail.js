(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- Toast ----------
  function toast(title, message, ms = 2400) {
    const wrap = $("toastWrap");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<div class="t"></div><div class="m"></div>`;
    el.querySelector(".t").textContent = title;
    el.querySelector(".m").textContent = message || "";
    wrap.appendChild(el);
    window.setTimeout(() => {
      try { wrap.removeChild(el); } catch (_) {}
    }, ms);
  }

  // ---------- Modals ----------
  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("show");
    el.setAttribute("aria-hidden", "false");
  }

  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
  }

  // Backdrop close
  ["mReq", "mInt", "mLetter"].forEach((mid) => {
    const el = $(mid);
    if (!el) return;
    el.addEventListener("click", (ev) => {
      if (ev.target && ev.target.id === mid) closeModal(mid);
    });
  });

  // Open/close via data attributes
  document.addEventListener("click", (e) => {
    const openBtn = e.target.closest("[data-open-modal]");
    if (openBtn) {
      const id = openBtn.dataset.openModal;
      openModal(id);
      if (id === "mReq") renderMissingDocs();
      return;
    }
    const closeBtn = e.target.closest("[data-close-modal]");
    if (closeBtn) {
      closeModal(closeBtn.dataset.closeModal);
      return;
    }
  });

  // ---------- Tabs ----------
  const tabs = $("tabs");
  if (tabs) {
    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;

      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
      const pane = document.getElementById(btn.dataset.pane);
      if (pane) pane.classList.add("active");
    });
  }

  function goPane(paneId) {
    const t = document.querySelector(`.tab[data-pane="${paneId}"]`);
    if (t) t.click();
  }

  // ---------- Top Actions ----------
  const btnBack = $("btnBack");
  if (btnBack) btnBack.addEventListener("click", () => history.back());

  const btnPrint = $("btnPrint");
  if (btnPrint) btnPrint.addEventListener("click", () => window.print());

  // ---------- Admit / Reject (REAL forms) ----------
  const btnAdmit = $("btnAdmit");
  const btnReject = $("btnReject");

  if (btnAdmit) {
    btnAdmit.addEventListener("click", () => {
      goPane("pane-review");
      const sel = $("classGroup");
      const form = $("formAccept");
      if (!form) return;

      if (sel && !sel.value) {
        sel.focus();
        toast("Class required", "Please select a class before admitting.");
        return;
      }
      form.submit();
    });
  }

  if (btnReject) {
    btnReject.addEventListener("click", () => {
      goPane("pane-review");
      const form = $("formReject");
      if (!form) return;

      const note = $("rejectNote");
      if (note && !note.value.trim()) {
        note && note.focus();
        if (!confirm("Reject without a reason note?")) return;
      } else {
        if (!confirm("Reject this applicant?")) return;
      }
      form.submit();
    });
  }

  // ---------- Finalize (maps to real server actions) ----------
  const btnFinalize = $("btnFinalize");
  if (btnFinalize) {
    btnFinalize.addEventListener("click", () => {
      const v = $("decValue") ? $("decValue").value : "review";

      if (v === "admitted") {
        // same as Admit button
        const sel = $("classGroup");
        const form = $("formAccept");
        if (!form) return;

        if (sel && !sel.value) {
          sel.focus();
          toast("Class required", "Please select a class before admitting.");
          return;
        }
        form.submit();
        return;
      }

      if (v === "rejected") {
        const form = $("formReject");
        if (!form) return;
        if (!confirm("Reject this applicant?")) return;
        form.submit();
        return;
      }

      if (v === "shortlist") {
        const f = $("formShortlist");
        if (!f) {
          toast("Missing form", "Shortlist form not found.");
          return;
        }
        f.submit();
        return;
      }

      if (v === "interview") {
        openModal("mInt");
        return;
      }

      toast("Saved (UI)", "Under Review saved in UI. Add a status endpoint if you want persistence.");
    });
  }

  // ---------- Request Docs modal (REAL form fields) ----------
  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderMissingDocs() {
    const dataEl = $("pageData");
    const missEl = $("missList");
    const keysEl = $("missingKeys");
    if (!dataEl || !missEl || !keysEl) return;

    const enc = dataEl.dataset.missing || "";
    let missing = [];
    try {
      missing = enc ? JSON.parse(decodeURIComponent(enc)) : [];
    } catch (_) {
      missing = [];
    }

    if (!missing.length) {
      missEl.innerHTML =
        '<div class="muted"><i class="fa-solid fa-circle-check"></i> No missing documents.</div>';
      keysEl.value = "";
      return;
    }

    missEl.innerHTML = missing
      .map((d) => {
        const icon = d.required ? "fa-circle-xmark" : "fa-triangle-exclamation";
        return `<div class="muted"><i class="fa-solid ${icon}"></i> ${escapeHtml(
          d.label || d.key
        )}</div>`;
      })
      .join("");

    keysEl.value = missing.map((d) => d.key).join(",");
  }
  renderMissingDocs();

  // ---------- Documents filter chips ----------
  const docFilters = $("docFilters");
  if (docFilters) {
    docFilters.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip[data-docfilter]");
      if (!chip) return;

      docFilters.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");

      const filter = chip.dataset.docfilter;
      const docs = document.querySelectorAll("#docGrid .doc");
      docs.forEach((d) => {
        if (filter === "all") d.style.display = "";
        else d.style.display = (d.dataset.status === filter) ? "" : "none";
      });
    });
  }

  // ---------- Tags (stored into hidden input for notes form) ----------
  const tags = new Set();
  const tagWrap = $("tagWrap");
  const tagList = $("tagList");
  const tagsField = $("tagsField");

  function refreshTags() {
    if (tagList) tagList.textContent = tags.size ? Array.from(tags).join(", ") : "None";
    if (tagsField) tagsField.value = tags.size ? Array.from(tags).join(",") : "";
    if (!tagWrap) return;
    tagWrap.querySelectorAll(".chip[data-tag]").forEach((c) => {
      c.classList.toggle("active", tags.has(c.dataset.tag));
    });
  }

  if (tagWrap) {
    tagWrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip[data-tag]");
      if (!btn) return;
      const t = btn.dataset.tag;
      if (tags.has(t)) tags.delete(t);
      else tags.add(t);
      refreshTags();
    });
  }
  refreshTags();

  // ---------- UI-only buttons so nothing feels dead ----------
  document.addEventListener("click", (e) => {
    const ui = e.target.closest("[data-ui-only]");
    if (!ui) return;

    const action = ui.dataset.uiOnly;
    if (action === "verify-all") toast("UI ready", "Verify-all is UI-only. Add a backend endpoint to persist.");
    else if (action === "verify-doc") toast("UI ready", "Document verification is UI-only. Add backend later.");
    else if (action === "upload-doc") toast("UI ready", "Upload is per-doc in your backend. Wire upload modal later.");
    else if (action === "save-checklist") toast("UI ready", "Checklist saved in UI. Add persistence endpoint later.");
    else if (action === "save-decision") toast("UI ready", "Decision draft saved in UI. Use Finalize to apply real actions.");
    else if (action === "cancel-interview") toast("UI ready", "Cancel interview is UI-only. Add backend endpoint later.");
    else if (action === "email") toast("UI ready", "Email action needs backend/email service.");
    else if (action === "sms") toast("UI ready", "SMS action needs backend/SMS provider.");
  });

  // Letter modal action (UI-only)
  const btnDoLetter = $("btnDoLetter");
  if (btnDoLetter) {
    btnDoLetter.addEventListener("click", () => {
      closeModal("mLetter");
      toast("Generated (UI)", "Letter generation is UI-ready. Add templates/backend to export PDF/DOCX.");
    });
  }
})();

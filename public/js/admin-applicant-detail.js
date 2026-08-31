(() => {
  const $ = (id) => document.getElementById(id);

  function toast(title, message, ms = 2400) {
    const wrap = $("toastWrap");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "toast";
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = title || "";
    const m = document.createElement("div");
    m.className = "m";
    m.textContent = message || "";
    el.append(t, m);
    wrap.appendChild(el);
    window.setTimeout(() => el.remove(), ms);
  }

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

  ["mReq", "mInt", "mLetter", "mUpload", "mEmail"].forEach((mid) => {
    const el = $(mid);
    if (!el) return;
    el.addEventListener("click", (ev) => {
      if (ev.target === el) closeModal(mid);
    });
  });

  document.addEventListener("click", (e) => {
    const openBtn = e.target.closest("[data-open-modal]");
    if (openBtn) {
      const id = openBtn.dataset.openModal;
      openModal(id);
      if (id === "mReq") renderMissingDocs();
      return;
    }
    const closeBtn = e.target.closest("[data-close-modal]");
    if (closeBtn) closeModal(closeBtn.dataset.closeModal);
  });

  document.querySelectorAll("form[data-confirm-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (!window.confirm(form.dataset.confirmForm || "Continue?")) event.preventDefault();
    });
  });

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
    const tab = document.querySelector(`.tab[data-pane="${paneId}"]`);
    if (tab) tab.click();
  }

  $("btnBack")?.addEventListener("click", () => history.back());
  $("btnPrint")?.addEventListener("click", () => window.print());

  function decisionNote() {
    return $("decNotes")?.value?.trim() || "";
  }

  function submitAccept() {
    goPane("pane-review");
    const select = $("classGroup");
    const form = $("formAccept");
    if (!form) return;
    if (select && !select.value) {
      select.focus();
      toast("Class required", "Please select a class before admitting.");
      return;
    }
    const note = $("acceptDecisionNote");
    if (note && decisionNote()) note.value = decisionNote();
    form.submit();
  }

  function submitReject() {
    goPane("pane-review");
    const form = $("formReject");
    if (!form) return;
    const note = $("rejectNote");
    if (note && decisionNote()) note.value = decisionNote();
    if (note && !note.value.trim()) {
      if (!window.confirm("Reject without a reason note?")) return;
    } else if (!window.confirm("Reject this applicant?")) return;
    form.submit();
  }

  $("btnAdmit")?.addEventListener("click", submitAccept);
  $("btnReject")?.addEventListener("click", submitReject);

  function applyDecision() {
    const value = $("decValue")?.value || "review";
    if (value === "admitted") return submitAccept();
    if (value === "rejected") return submitReject();
    if (value === "shortlist") return $("formShortlist")?.submit();
    if (value === "interview") return openModal("mInt");

    const note = $("reviewDecisionNote");
    if (note) note.value = decisionNote();
    const form = $("formReview");
    if (form) form.submit();
  }

  $("btnFinalize")?.addEventListener("click", applyDecision);
  $("btnSaveDecision")?.addEventListener("click", applyDecision);

  function readMissingDocs() {
    const dataEl = $("pageData");
    if (!dataEl) return [];
    try {
      return dataEl.dataset.missing ? JSON.parse(decodeURIComponent(dataEl.dataset.missing)) : [];
    } catch (_) {
      return [];
    }
  }

  function renderMissingDocs() {
    const missEl = $("missList");
    const keysEl = $("missingKeys");
    if (!missEl || !keysEl) return;
    const missing = readMissingDocs();
    missEl.replaceChildren();
    if (!missing.length) {
      const row = document.createElement("div");
      row.className = "muted";
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-circle-check";
      row.append(icon, document.createTextNode(" No missing documents."));
      missEl.appendChild(row);
      keysEl.value = "";
      return;
    }
    missing.forEach((doc) => {
      const row = document.createElement("div");
      row.className = "muted";
      const icon = document.createElement("i");
      icon.className = `fa-solid ${doc.required ? "fa-circle-xmark" : "fa-triangle-exclamation"}`;
      row.append(icon, document.createTextNode(` ${String(doc.label || doc.key || "Document")}`));
      missEl.appendChild(row);
    });
    keysEl.value = missing.map((doc) => String(doc.key || "")).filter(Boolean).join(",");
  }
  renderMissingDocs();

  const docFilters = $("docFilters");
  if (docFilters) {
    docFilters.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip[data-docfilter]");
      if (!chip) return;
      docFilters.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const filter = chip.dataset.docfilter;
      document.querySelectorAll("#docGrid .doc").forEach((doc) => {
        doc.style.display = filter === "all" || doc.dataset.status === filter ? "" : "none";
      });
    });
  }

  const tags = new Set();
  const dataEl = $("pageData");
  if (dataEl?.dataset.tags) {
    try {
      const initial = JSON.parse(decodeURIComponent(dataEl.dataset.tags));
      if (Array.isArray(initial)) initial.forEach((tag) => tags.add(String(tag)));
    } catch (_) {}
  }
  const tagWrap = $("tagWrap");
  const tagList = $("tagList");
  const tagsField = $("tagsField");

  function refreshTags() {
    const values = Array.from(tags);
    if (tagList) tagList.textContent = values.length ? values.join(", ") : "None";
    if (tagsField) tagsField.value = values.join(",");
    tagWrap?.querySelectorAll(".chip[data-tag]").forEach((chip) => {
      chip.classList.toggle("active", tags.has(chip.dataset.tag));
    });
  }

  tagWrap?.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip[data-tag]");
    if (!btn) return;
    const tag = btn.dataset.tag;
    if (tags.has(tag)) tags.delete(tag);
    else tags.add(tag);
    refreshTags();
  });
  refreshTags();
})();

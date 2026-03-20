/* public/js/applicant-view.js */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const qs = (sel) => document.querySelector(sel);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  function readApplicantData() {
    // We store JSON in <input type="hidden" id="applicantData" value="ENCODED_JSON">
    const el = $("applicantData");
    if (!el) return null;

    const raw = el.value || "";
    if (!raw) return null;

    try {
      const decoded = decodeURIComponent(raw);
      return JSON.parse(decoded);
    } catch (e) {
      console.error("Failed to parse applicantData JSON:", e);
      console.log("Raw applicantData:", raw.slice(0, 200));
      return null;
    }
  }

  function initials(name) {
    const s = String(name || "").trim();
    if (!s) return "NA";
    return s
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => (x ? x[0] : ""))
      .join("")
      .toUpperCase();
  }

  function openModal(id) {
    const m = $(id);
    if (m) m.classList.add("show");
  }
  function closeModal(id) {
    const m = $(id);
    if (m) m.classList.remove("show");
  }

  function stagePill(status) {
    const s = String(status || "").trim();
    const map = {
      submitted: `<span class="pill infopill"><i class="fa-solid fa-paper-plane"></i> Submitted</span>`,
      under_review: `<span class="pill warnpill"><i class="fa-solid fa-magnifying-glass"></i> Under Review</span>`,
      accepted: `<span class="pill ok"><i class="fa-solid fa-check"></i> Accepted</span>`,
      rejected: `<span class="pill bad"><i class="fa-solid fa-xmark"></i> Rejected</span>`,
      converted: `<span class="pill ok"><i class="fa-solid fa-user-check"></i> Converted</span>`,
    };
    return map[s] || `<span class="pill infopill"><i class="fa-solid fa-circle-info"></i> ${s || "—"}</span>`;
  }

  function docsCount(server) {
    const docs = (server && server.docs) || {};
    const base = ["idDocument", "transcript", "passportPhoto"];
    let done = base.filter((k) => docs[k] && docs[k].uploaded).length;
    const otherOk = docs.otherDocs && docs.otherDocs.uploaded;
    if (otherOk) done += 1;
    return { done, total: 4 };
  }

  function renderHeader(server) {
    const av = $("aAvatar");
    const nm = $("aName");
    const meta = $("aMeta");
    const sp = $("aStagePill");
    const dp = $("aDocsPill");

    if (av) av.textContent = initials(server?.name);
    if (nm) nm.textContent = server?.name || "Applicant";
    if (meta) {
      const prog = server?.program || "—";
      const intake = server?.intake || "—";
      const sub = server?.submitted || "—";
      meta.textContent = `${server?.id || "—"} • ${prog} • Intake: ${intake} • Submitted: ${sub}`;
    }

    if (sp) sp.outerHTML = `<span id="aStagePill">${stagePill(server?.status)}</span>`;

    const dc = docsCount(server);
    if (dp) {
      const ok = dc.done === dc.total;
      dp.outerHTML = `
        <span id="aDocsPill" class="pill ${ok ? "ok" : "warnpill"}">
          <i class="fa-solid ${ok ? "fa-check" : "fa-file-circle-exclamation"}"></i>
          Docs ${dc.done}/${dc.total}
        </span>`;
    }
  }

  function renderDocs(server, filter = "all") {
    const grid = $("docGrid");
    if (!grid) return;

    const docs = (server && server.docs) || {};

    const cards = [
      {
        key: "idDocument",
        label: "ID Document",
        required: true,
        uploaded: !!docs.idDocument?.uploaded,
        url: docs.idDocument?.url || "",
      },
      {
        key: "transcript",
        label: "Transcript",
        required: true,
        uploaded: !!docs.transcript?.uploaded,
        url: docs.transcript?.url || "",
      },
      {
        key: "passportPhoto",
        label: "Passport Photo",
        required: true,
        uploaded: !!docs.passportPhoto?.uploaded,
        url: docs.passportPhoto?.url || "",
      },
      {
        key: "otherDocs",
        label: "Other Documents",
        required: false,
        uploaded: !!docs.otherDocs?.uploaded,
        items: Array.isArray(docs.otherDocs?.items) ? docs.otherDocs.items : [],
      },
    ];

    const items = cards.filter((x) => {
      if (filter === "missing") return !x.uploaded;
      if (filter === "uploaded") return x.uploaded;
      return true;
    });

    grid.innerHTML = items
      .map((x) => {
        const st = x.uploaded
          ? `<span class="pill ok"><i class="fa-solid fa-check"></i> Uploaded</span>`
          : `<span class="pill bad"><i class="fa-solid fa-xmark"></i> Missing</span>`;

        let meta = "";
        let viewBtn = "";

        if (x.key === "otherDocs") {
          const n = (x.items || []).length;
          meta = `Files: ${n}`;
          if (n) {
            viewBtn = (x.items || [])
              .map((d) => {
                const url = (d && d.url) || "#";
                const name = (d && (d.originalName || d.fileName)) || "doc";
                return `<a class="btn light small" style="text-decoration:none" target="_blank" rel="noreferrer" href="${url}">
                          <i class="fa-solid fa-eye"></i> ${name}
                        </a>`;
              })
              .join(" ");
          } else {
            viewBtn = `<button class="btn light small" type="button" disabled><i class="fa-solid fa-eye"></i> View</button>`;
          }
        } else {
          meta = `Link: ${x.uploaded ? "Available" : "—"}`;
          viewBtn =
            x.uploaded && x.url
              ? `<a class="btn light small" style="text-decoration:none" target="_blank" rel="noreferrer" href="${x.url}">
                   <i class="fa-solid fa-eye"></i> View
                 </a>`
              : `<button class="btn light small" type="button" disabled><i class="fa-solid fa-eye"></i> View</button>`;
        }

        return `
          <div class="doc">
            <div class="doc-top">
              <div>
                <div class="doc-name">
                  ${x.label}
                  ${x.required ? '<span class="muted">(Required)</span>' : '<span class="muted">(Optional)</span>'}
                </div>
                <div class="doc-meta">${meta}</div>
              </div>
              ${st}
            </div>
            <div class="divider"></div>
            <div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap">
              ${viewBtn}
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderMissingInModal(server) {
    const missList = $("missList");
    if (!missList) return;

    const docs = (server && server.docs) || {};
    const miss = [];
    if (!docs.idDocument?.uploaded) miss.push("ID Document");
    if (!docs.transcript?.uploaded) miss.push("Transcript");
    if (!docs.passportPhoto?.uploaded) miss.push("Passport Photo");

    missList.innerHTML = miss.length
      ? miss.map((x) => `<div class="muted"><i class="fa-solid fa-circle-xmark"></i> ${x}</div>`).join("")
      : `<div class="muted"><i class="fa-solid fa-circle-check"></i> No missing documents.</div>`;
  }

  function setActiveTab(paneId) {
    qsa(".tab").forEach((t) => t.classList.remove("active"));
    qsa(".pane").forEach((p) => p.classList.remove("active"));

    const tab = qs(`.tab[data-pane="${paneId}"]`);
    const pane = $(paneId);
    if (tab) tab.classList.add("active");
    if (pane) pane.classList.add("active");
  }

  function safeOn(id, evt, fn) {
    const el = $(id);
    if (!el) return;
    el.addEventListener(evt, fn);
  }

  // Init after DOM is ready
  document.addEventListener("DOMContentLoaded", () => {
    const server = readApplicantData() || { docs: {} };

    // Header + docs
    renderHeader(server);
    renderDocs(server, "all");
    renderMissingInModal(server);

    // Demo score = docs completeness
    const dc = docsCount(server);
    const score = Math.min(100, 50 + dc.done * 12);
    if ($("screenScore")) $("screenScore").textContent = `${score} / 100`;

    safeOn("btnRecalc", "click", () => {
      const dc2 = docsCount(server);
      const score2 = Math.min(100, 50 + dc2.done * 12);
      if ($("screenScore")) $("screenScore").textContent = `${score2} / 100`;
      alert("Recalculated screening score (demo).");
    });

    // Tabs
    const tabs = $("tabs");
    if (tabs) {
      tabs.addEventListener("click", (e) => {
        const btn = e.target.closest(".tab");
        if (!btn) return;
        setActiveTab(btn.dataset.pane);
      });
    }

    // Docs filter chips
    const docFilters = $("docFilters");
    if (docFilters) {
      docFilters.addEventListener("click", (e) => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        qsa("#docFilters .chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        renderDocs(server, chip.dataset.docfilter || "all");
      });
    }

    // Close buttons using data-close
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-close]");
      if (!btn) return;
      closeModal(btn.getAttribute("data-close"));
    });

    // Close on backdrop click
    ["mReq", "mInt", "mLetter"].forEach((mid) => {
      const m = $(mid);
      if (!m) return;
      m.addEventListener("click", (e) => {
        if (e.target && e.target.id === mid) closeModal(mid);
      });
    });

    // Top buttons
    safeOn("btnBack", "click", () => (window.location = "/admin/admissions/applicants"));
    safeOn("btnPrint", "click", () => window.print());
    safeOn("btnExport", "click", () => alert("Export application bundle (PDF/ZIP) — backend later."));

    // Request docs modal
    safeOn("btnRequestDocs", "click", () => {
      renderMissingInModal(server);
      openModal("mReq");
    });
    safeOn("btnRequestMissing", "click", () => {
      renderMissingInModal(server);
      openModal("mReq");
    });
    safeOn("btnSendReq", "click", () => {
      closeModal("mReq");
      alert("Request sent (UI). Wire email/SMS later.");
    });

    // Interview modal (UI only)
    safeOn("btnSchedule", "click", () => openModal("mInt"));
    safeOn("btnSaveInterview", "click", () => {
      closeModal("mInt");
      alert("Interview saved (UI). Wire backend later.");
    });

    // Letter modal (UI only)
    safeOn("btnGenerateLetter", "click", () => openModal("mLetter"));
    safeOn("btnDoLetter", "click", () => {
      closeModal("mLetter");
      alert("Letter generated (UI). Wire backend later.");
    });

    // Shortlist button -> set status=under_review + submit statusForm
    safeOn("btnShortlist", "click", () => {
      setActiveTab("pane-review");
      const sel = $("decValue");
      const form = $("statusForm");
      if (sel) sel.value = "under_review";
      if (form) form.requestSubmit();
    });

    // Reject button -> set status=rejected + submit statusForm
    safeOn("btnReject", "click", () => {
      setActiveTab("pane-review");
      const sel = $("decValue");
      const form = $("statusForm");
      if (sel) sel.value = "rejected";
      if (form) form.requestSubmit();
    });

    // Admit button -> jump to review and focus classGroup
    safeOn("btnAdmit", "click", () => {
      setActiveTab("pane-review");
      const cg = $("classGroup");
      if (cg) cg.focus();
    });

    // Right panel buttons (UI-only)
    safeOn("btnSaveAdminNotes", "click", () => alert("Admin notes saved (UI). Wire backend later."));
    safeOn("btnEmailApplicant", "click", () => alert("Email applicant (backend later)."));
    safeOn("btnSmsApplicant", "click", () => alert("SMS applicant (backend later)."));

    // Quick links
    safeOn("lnkOpenInvoice", "click", (e) => { e.preventDefault(); alert("Open fee invoice (backend later)."); });
    safeOn("lnkOfferLetter", "click", (e) => { e.preventDefault(); alert("Open offer letter (backend later)."); });
    safeOn("lnkHistory", "click", (e) => { e.preventDefault(); alert("Applicant history (backend later)."); });
  });
})();

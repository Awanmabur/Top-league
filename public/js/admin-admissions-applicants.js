(function () {
  const $ = (id) => document.getElementById(id);

  function readApplicantsData() {
    const el = $("applicantsData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse applicants data:", err);
      return [];
    }
  }

  const APPLICANTS = readApplicantsData();
  if (!$("tbodyApplicants")) return;

  const state = {
    selected: new Set(),
    currentViewId: null,
  };

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("show");
    document.body.style.overflow = "";
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function statusPill(status) {
    if (status === "accepted" || status === "converted") {
      return `<span class="pill ok"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(status === "converted" ? "Converted" : "Accepted")}</span>`;
    }
    if (status === "rejected") {
      return `<span class="pill bad"><i class="fa-solid fa-xmark"></i> Rejected</span>`;
    }
    if (status === "under_review") {
      return `<span class="pill warn"><i class="fa-solid fa-magnifying-glass"></i> Under Review</span>`;
    }
    return `<span class="pill info"><i class="fa-solid fa-paper-plane"></i> Submitted</span>`;
  }

  function docsPill(docs) {
    const done = [
      docs?.passportPhoto,
      docs?.idDocument,
      docs?.transcript,
      Number(docs?.otherDocsCount || 0) > 0,
    ].filter(Boolean).length;
    const total = 4;

    if (done === total) {
      return `<span class="pill ok"><i class="fa-solid fa-folder-open"></i> ${done}/${total}</span>`;
    }
    return `<span class="pill warn"><i class="fa-solid fa-folder-open"></i> ${done}/${total}</span>`;
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map((x) => x[0]).join("") || "A").toUpperCase();
  }

  function formatDate(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toISOString().slice(0, 10);
  }

  function renderTable() {
    $("tbodyApplicants").innerHTML =
      APPLICANTS.map((a) => {
        const checked = state.selected.has(a.id) ? "checked" : "";

        return `
          <tr class="row-clickable" data-id="${escapeHtml(a.id)}">
            <td class="col-check no-print">
              <input type="checkbox" class="rowCheck" data-id="${escapeHtml(a.id)}" ${checked}>
            </td>

            <td class="col-applicant">
              <div class="row-flex">
                <div class="avatar">${escapeHtml(initials(a.name))}</div>
                <div class="app-main">
                  <div class="app-title" title="${escapeHtml(a.name)}">${escapeHtml(a.name || "—")}</div>
                  <div class="app-sub" title="${escapeHtml((a.email || "—") + " • " + (a.phone || "—"))}">
                    ${escapeHtml(a.email || "—")} • ${escapeHtml(a.phone || "—")}
                  </div>
                </div>
              </div>
            </td>

            <td class="col-application">
              <span class="cell-ellipsis strong" title="${escapeHtml(a.applicationId || "—")}">
                ${escapeHtml(a.applicationId || "—")}
              </span>
              <span class="cell-ellipsis muted">${escapeHtml(a.intake || "—")}</span>
            </td>

            <td class="col-program">
              <span class="cell-ellipsis" title="${escapeHtml(a.programLabel || "—")}">
                ${escapeHtml(a.programLabel || "—")}
              </span>
            </td>

            <td class="col-stage">${statusPill(a.status)}</td>

            <td class="col-docs">${docsPill(a.docs)}</td>

            <td class="col-payment">
              <span class="pill info"><i class="fa-solid fa-circle"></i> ${escapeHtml(a.paymentLabel || "N/A")}</span>
            </td>

            <td class="col-submitted">
              <span class="cell-ellipsis">${escapeHtml(formatDate(a.submittedAt))}</span>
            </td>

            <td class="col-actions no-print">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actReview" type="button" title="Review"><i class="fa-solid fa-magnifying-glass"></i></button>
                <button class="btn-xs actAccept" type="button" title="Accept"><i class="fa-solid fa-check"></i></button>
                <button class="btn-xs actReject" type="button" title="Reject"><i class="fa-solid fa-xmark"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
      <tr>
        <td colspan="9" style="padding:18px;">
          <div class="muted">No applicants found.</div>
        </td>
      </tr>
      `;

    const allSelected = APPLICANTS.length > 0 && APPLICANTS.every((a) => state.selected.has(a.id));
    if ($("checkAll")) $("checkAll").checked = allSelected;
    syncBulkbar();
  }

  function docsHtml(d) {
    const items = [
      ["Passport Photo", !!d?.passportPhoto],
      ["ID Document", !!d?.idDocument],
      ["Transcript", !!d?.transcript],
      ["Other Docs", Number(d?.otherDocsCount || 0) > 0],
    ];

    return items.map(([label, ok]) => `${label}: ${ok ? "Available" : "Missing"}`).join("\n");
  }

  function updateNoteCounter() {
    const note = $("vNote");
    if (!note || !$("noteCount")) return;
    $("noteCount").textContent = `${note.value.length} / 1200`;
  }

  function openViewModal(a) {
    if (!a) return;

    state.currentViewId = a.id;

    $("vName").textContent = a.name || "—";
    $("vApplicationId").textContent = a.applicationId || "—";
    $("vEmail").textContent = a.email || "—";
    $("vPhone").textContent = a.phone || "—";
    $("vSubmitted").textContent = formatDate(a.submittedAt);
    $("vProgram").textContent = a.programLabel || "—";
    $("vIntake").textContent = a.intake || "—";
    $("vPayment").textContent = a.paymentLabel || "N/A";
    $("vStatus").innerHTML = statusPill(a.status || "submitted");
    $("vDocs").textContent = docsHtml(a.docs || {});
    $("vNote").value = a.adminNotes || "";

    updateNoteCounter();
    openModal("mView");
  }

  function submitBulk(action, ids) {
    if (!ids.length) return;
    $("bulkIds").value = ids.join(",");
    $("bulkAction").value = action;
    $("bulkMessage").value =
      ($("vNote") && state.currentViewId && ids.length === 1)
        ? $("vNote").value.trim()
        : "";
    $("bulkForm").submit();
  }

  function downloadCsv(filename, rows) {
    const esc = (value) => {
      const s = String(value ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const csv = rows.map((row) => row.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadTemplate() {
    downloadCsv("applicants-import-template.csv", [
      ["firstName", "lastName", "email", "phone", "programCode", "intake", "status"],
    ]);
  }

  $("btnExport")?.addEventListener("click", function () {
    const url = new URL(window.location.origin + "/admin/admissions/applicants/export");
    const params = new URLSearchParams(window.location.search);
    params.forEach((value, key) => url.searchParams.set(key, value));
    window.location.href = url.toString();
  });

  $("btnTemplate")?.addEventListener("click", downloadTemplate);
  $("btnPrint")?.addEventListener("click", function () {
    window.print();
  });

  $("btnImport")?.addEventListener("click", function () {
    openModal("mImport");
  });

  $("btnBulk")?.addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one applicant.");
    $("bulkbar").classList.add("show");
  });

  $("bulkReview")?.addEventListener("click", function () {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one applicant.");
    if (!window.confirm(`Move ${ids.length} selected applicant(s) to review?`)) return;
    submitBulk("set_under_review", ids);
  });

  $("bulkAccept")?.addEventListener("click", function () {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one applicant.");
    if (!window.confirm(`Accept ${ids.length} selected applicant(s)?`)) return;
    submitBulk("accept", ids);
  });

  $("bulkReject")?.addEventListener("click", function () {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one applicant.");
    if (!window.confirm(`Reject ${ids.length} selected applicant(s)?`)) return;
    submitBulk("reject", ids);
  });

  $("bulkClear")?.addEventListener("click", function () {
    state.selected.clear();
    renderTable();
  });

  $("checkAll")?.addEventListener("change", function (e) {
    if (e.target.checked) APPLICANTS.forEach((a) => state.selected.add(a.id));
    else APPLICANTS.forEach((a) => state.selected.delete(a.id));
    renderTable();
  });

  $("tbodyApplicants")?.addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyApplicants")?.addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const a = APPLICANTS.find((x) => x.id === tr.dataset.id);
    if (!a) return;

    if (e.target.closest(".rowCheck")) return;
    if (e.target.closest(".actView")) return openViewModal(a);

    if (e.target.closest(".actReview")) {
      if (!window.confirm(`Move "${a.name}" to review?`)) return;
      return submitBulk("set_under_review", [a.id]);
    }

    if (e.target.closest(".actAccept")) {
      if (!window.confirm(`Accept "${a.name}"?`)) return;
      return submitBulk("accept", [a.id]);
    }

    if (e.target.closest(".actReject")) {
      if (!window.confirm(`Reject "${a.name}"?`)) return;
      return submitBulk("reject", [a.id]);
    }

    openViewModal(a);
  });

  $("btnOpenDetail")?.addEventListener("click", function () {
    const a = APPLICANTS.find((x) => x.id === state.currentViewId);
    if (!a) return;
    window.location.href = a.openUrl;
  });

  $("btnMoveReview")?.addEventListener("click", function () {
    const a = APPLICANTS.find((x) => x.id === state.currentViewId);
    if (!a) return;
    submitBulk("set_under_review", [a.id]);
  });

  $("btnQuickAccept")?.addEventListener("click", function () {
    const a = APPLICANTS.find((x) => x.id === state.currentViewId);
    if (!a) return;
    submitBulk("accept", [a.id]);
  });

  $("btnQuickReject")?.addEventListener("click", function () {
    const a = APPLICANTS.find((x) => x.id === state.currentViewId);
    if (!a) return;
    submitBulk("reject", [a.id]);
  });

  $("vNote")?.addEventListener("input", updateNoteCounter);

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mView", "mImport"].forEach(function (mid) {
    const el = $(mid);
    if (!el) return;
    el.addEventListener("click", function (e) {
      if (e.target.id === mid) closeModal(mid);
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach(function (el) {
        el.classList.remove("show");
      });
      document.body.style.overflow = "";
    }
  });

  renderTable();
  updateNoteCounter();
})();
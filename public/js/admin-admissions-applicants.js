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

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function statusPill(status) {
    const value = status === "accepted" || status === "converted"
      ? (status === "converted" ? "Converted" : "Accepted")
      : status === "rejected"
        ? "Rejected"
        : status === "under_review"
          ? "Under Review"
          : "Submitted";
    const tone = status === "accepted" || status === "converted" ? "ok" : status === "rejected" ? "bad" : status === "under_review" ? "warn" : "info";
    const icon = status === "accepted" || status === "converted" ? "fa-circle-check" : status === "rejected" ? "fa-xmark" : status === "under_review" ? "fa-magnifying-glass" : "fa-paper-plane";
    const pill = make("span", `pill ${tone}`);
    const i = make("i", `fa-solid ${icon}`);
    pill.append(i, document.createTextNode(` ${value}`));
    return pill;
  }

  function docsPill(docs) {
    const done = [docs?.passportPhoto, docs?.idDocument, docs?.transcript].filter(Boolean).length;
    const total = 3;
    const pill = make("span", `pill ${done === total ? "ok" : "warn"}`);
    pill.append(make("i", "fa-solid fa-folder-open"), document.createTextNode(` ${done}/${total}`));
    return pill;
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

  function actionButton(className, title, iconClass) {
    const button = make("button", `btn-xs ${className}`);
    button.type = "button";
    button.title = title;
    button.appendChild(make("i", `fa-solid ${iconClass}`));
    return button;
  }

  function renderTable() {
    const host = $("tbodyApplicants");
    host.replaceChildren();

    if (!APPLICANTS.length) {
      const tr = make("tr");
      const td = make("td");
      td.colSpan = 9;
      td.style.padding = "18px";
      td.appendChild(make("div", "muted", "No applicants found."));
      tr.appendChild(td);
      host.appendChild(tr);
    } else {
      APPLICANTS.forEach((a) => {
        const tr = make("tr", "row-clickable");
        tr.dataset.id = String(a.id || "");

        const checkTd = make("td", "col-check no-print");
        const checkbox = make("input", "rowCheck");
        checkbox.type = "checkbox";
        checkbox.dataset.id = String(a.id || "");
        checkbox.checked = state.selected.has(a.id);
        checkTd.appendChild(checkbox);

        const applicantTd = make("td", "col-applicant");
        const flex = make("div", "row-flex");
        flex.appendChild(make("div", "avatar", initials(a.name)));
        const appMain = make("div", "app-main");
        const title = make("div", "app-title", a.name || "—");
        title.title = String(a.name || "");
        const sub = make("div", "app-sub", `${a.email || "—"} • ${a.phone || "—"}`);
        sub.title = `${a.email || "—"} • ${a.phone || "—"}`;
        appMain.append(title, sub);
        flex.appendChild(appMain);
        applicantTd.appendChild(flex);

        const applicationTd = make("td", "col-application");
        const appId = make("span", "cell-ellipsis strong", a.applicationId || "—");
        appId.title = String(a.applicationId || "—");
        applicationTd.append(appId, make("span", "cell-ellipsis muted", a.intake || "—"));

        const programTd = make("td", "col-program");
        const program = make("span", "cell-ellipsis", a.programLabel || "—");
        program.title = String(a.programLabel || "—");
        programTd.appendChild(program);

        const statusTd = make("td", "col-stage");
        statusTd.appendChild(statusPill(a.status));
        const docsTd = make("td", "col-docs");
        docsTd.appendChild(docsPill(a.docs));
        const paymentTd = make("td", "col-payment");
        const payment = make("span", "pill info");
        payment.append(make("i", "fa-solid fa-circle"), document.createTextNode(` ${a.paymentLabel || "N/A"}`));
        paymentTd.appendChild(payment);
        const submittedTd = make("td", "col-submitted");
        submittedTd.appendChild(make("span", "cell-ellipsis", formatDate(a.submittedAt)));

        const actionsTd = make("td", "col-actions no-print");
        const actions = make("div", "actions");
        actions.append(
          actionButton("actView", "View", "fa-eye"),
          actionButton("actReview", "Review", "fa-magnifying-glass"),
          actionButton("actAccept", "Accept", "fa-check"),
          actionButton("actReject", "Reject", "fa-xmark"),
        );
        actionsTd.appendChild(actions);

        tr.append(checkTd, applicantTd, applicationTd, programTd, statusTd, docsTd, paymentTd, submittedTd, actionsTd);
        host.appendChild(tr);
      });
    }

    const allSelected = APPLICANTS.length > 0 && APPLICANTS.every((a) => state.selected.has(a.id));
    if ($("checkAll")) $("checkAll").checked = allSelected;
    syncBulkbar();
  }

  function docsHtml(d) {
    const items = [
      ["Passport Photo", !!d?.passportPhoto],
      ["ID Document", !!d?.idDocument],
      ["Transcript", !!d?.transcript],
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
    $("vStatus").replaceChildren(statusPill(a.status || "submitted"));
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
(function () {
  const $ = (id) => document.getElementById(id);

  function readParentsData() {
    const el = $("parentsData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse parents data:", err);
      return [];
    }
  }

  const PARENTS = readParentsData();
  if (!$("tbodyParents")) return;

  const state = {
    selected: new Set(),
    currentViewId: null,
  };

  function splitComma(text) {
    return String(text || "")
      .split(",")
      .map((x) => x.trim().replace(/\s+/g, " "))
      .filter(Boolean);
  }

  function isObjectId(v) {
    return /^[a-fA-F0-9]{24}$/.test(String(v || "").trim());
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
    if (!document.querySelector(".modal-backdrop.show")) {
      document.body.style.overflow = "";
    }
  }

  function submitRowAction(actionUrl) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    form.submit();
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function statusPill(status) {
    const pill = document.createElement("span");
    const icon = document.createElement("i");
    const labels = {
      active: ["ok", "fa-circle-check", "Active"],
      on_hold: ["warn", "fa-pause", "On Hold"],
      suspended: ["bad", "fa-ban", "Suspended"],
      archived: ["info", "fa-box-archive", "Archived"],
    };
    const [tone, iconName, label] = labels[status] || labels.archived;
    pill.className = `pill ${tone}`;
    icon.className = `fa-solid ${iconName}`;
    pill.append(icon, document.createTextNode(` ${label}`));
    return pill;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function actionButton(className, title, iconClass) {
    const button = el("button", `btn-xs ${className}`);
    button.type = "button";
    button.title = title;
    const icon = el("i", `fa-solid ${iconClass}`);
    button.appendChild(icon);
    return button;
  }

  function formatDate(value) {
    if (!value) return "—";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function renderTable() {
    const tbody = $("tbodyParents");
    const fragment = document.createDocumentFragment();

    if (!PARENTS.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 9;
      td.style.padding = "18px";
      td.appendChild(el("div", "muted", "No parents found."));
      tr.appendChild(td);
      fragment.appendChild(tr);
    } else {
      PARENTS.forEach((p) => {
        const kids = Array.isArray(p.childrenStudentIds) ? p.childrenStudentIds : [];
        const tr = el("tr", "row-clickable");
        tr.dataset.id = String(p.id || "");

        const checkTd = el("td", "col-check");
        const checkbox = el("input", "rowCheck");
        checkbox.type = "checkbox";
        checkbox.dataset.id = String(p.id || "");
        checkbox.checked = state.selected.has(p.id);
        checkTd.appendChild(checkbox);

        const parentTd = el("td", "col-parent");
        const parentMain = el("div", "parent-main");
        const title = el("div", "parent-title", p.fullName || "—");
        title.title = p.fullName || "—";
        const sub = el("div", "parent-sub", p.relationship || "—");
        sub.title = p.relationship || "—";
        parentMain.append(title, sub);
        parentTd.appendChild(parentMain);

        const valueCell = (className, value) => {
          const td = el("td", className);
          const span = el("span", "cell-ellipsis", value || "—");
          span.title = value || "—";
          td.appendChild(span);
          return td;
        };

        const kidsTd = el("td", "col-kids");
        kidsTd.appendChild(el("span", "cell-ellipsis", String(kids.length)));
        const statusTd = el("td", "col-status");
        statusTd.appendChild(statusPill(p.status));
        const createdTd = el("td", "col-created");
        createdTd.appendChild(el("span", "cell-ellipsis", formatDate(p.createdAt)));

        const actionsTd = el("td", "col-actions");
        const actions = el("div", "actions");
        actions.append(
          actionButton("actView", "View", "fa-eye"),
          actionButton("actEdit", "Edit", "fa-pen"),
          actionButton("actResend", "Resend Setup", "fa-paper-plane"),
          actionButton("actArchive", "Archive", "fa-box-archive"),
          actionButton("actDelete", "Delete", "fa-trash")
        );
        actionsTd.appendChild(actions);

        tr.append(
          checkTd, parentTd, valueCell("col-email", p.email), valueCell("col-phone", p.phone),
          valueCell("col-relationship", p.relationship), kidsTd, statusTd, createdTd, actionsTd
        );
        fragment.appendChild(tr);
      });
    }

    tbody.replaceChildren(fragment);
    $("checkAll").checked = PARENTS.length > 0 && PARENTS.every((p) => state.selected.has(p.id));
    syncBulkbar();
  }

  function fillHiddenKids(values) {
    const wrap = $("mKidsWrap");
    wrap.replaceChildren();

    values.forEach((v) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "childrenStudentIds[]";
      input.value = v;
      wrap.appendChild(input);
    });

    $("mChildrenCount").value = String(values.length);
  }

  function updateCounters() {
    $("notesCount").textContent = `${$("mNotes").value.length} / 1200`;
  }

  function openEditor(prefill) {
    const p = prefill || null;

    $("mTitle").textContent = p ? "Edit Parent" : "Add Parent";
    $("parentForm").action = p ? `/admin/parents/${encodeURIComponent(p.id)}` : "/admin/parents";

    $("mFullName").value = p ? p.fullName || "" : "";
    $("mEmail").value = p ? p.email || "" : "";
    $("mPhone").value = p ? p.phone || "" : "";
    $("mRelationship").value = p ? p.relationship || "" : "";
    $("mStatus").value = p ? p.status || "active" : "active";
    $("mKids").value = p ? (Array.isArray(p.childrenStudentIds) ? p.childrenStudentIds.join(", ") : "") : "";
    $("mNotes").value = p ? p.notes || "" : "";
    $("mChildrenCount").value = p ? String((p.childrenStudentIds || []).length) : "0";
    $("mKidsWrap").replaceChildren();

    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(p) {
    if (!p) return;
    state.currentViewId = p.id;
    $("vFullName").textContent = p.fullName || "—";
    $("vEmail").textContent = p.email || "—";
    $("vPhone").textContent = p.phone || "—";
    $("vRelationship").textContent = p.relationship || "—";
    $("vChildrenCount").textContent = String((p.childrenStudentIds || []).length || 0);
    $("vStatus").replaceChildren(statusPill(p.status || "active"));
    $("vNotes").textContent = p.notes || "—";

    const host = $("vKids");
    const kids = Array.isArray(p.childrenStudentIds) ? p.childrenStudentIds : [];
    if (!kids.length) {
      host.replaceChildren(el("span", "muted", "No student IDs"));
    } else {
      const nodes = kids.map((id) => {
        const span = el("span", "tag");
        const icon = el("i", "fa-solid fa-user-graduate");
        span.append(icon, document.createTextNode(` ${id}`));
        return span;
      });
      host.replaceChildren(...nodes);
    }
    openModal("mView");
  }

  function saveParent() {
    const fullName = $("mFullName").value.trim();
    const email = $("mEmail").value.trim();
    const status = $("mStatus").value.trim();

    if (!fullName) return alert("Full name is required.");
    if (!email) return alert("Email is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert("Enter a valid email.");
    if (!status) return alert("Status is required.");

    const kids = splitComma($("mKids").value)
      .filter(isObjectId)
      .slice(0, 200);

    fillHiddenKids(kids);
    $("parentForm").submit();
  }

  function csvSafe(value) {
    const s = String(value ?? "");
    if (/^[=+\-@]/.test(s)) return `'${s}`;
    return s;
  }

  function downloadCsv(filename, rows) {
    const esc = (value) => {
      const s = String(value ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const csv = rows.map((row) => row.map((v) => esc(csvSafe(v))).join(",")).join("\n");
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

  function exportParents() {
    const params = new URLSearchParams(window.location.search);
    params.delete("page");
    const query = params.toString();
    window.location.assign(`/admin/parents/export${query ? `?${query}` : ""}`);
  }

  function downloadTemplate() {
    const rows = [
      ["fullName", "email", "phone", "relationship", "status", "childrenStudentIds", "notes"],
      ["Jane Doe", "jane@example.com", "+256700000001", "Mother", "active", "65f111111111111111111111,65f222222222222222222222", "Primary contact"],
      ["John Doe", "john@example.com", "+256700000002", "Father", "on_hold", "65f333333333333333333333", "Pays tuition"],
    ];
    downloadCsv("parents-import-template.csv", rows);
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickMother").addEventListener("click", function () {
    openEditor();
    $("mRelationship").value = "Mother";
  });

  $("quickFather").addEventListener("click", function () {
    openEditor();
    $("mRelationship").value = "Father";
  });

  $("btnImport").addEventListener("click", function () {
    openModal("mImport");
  });

  $("btnExport").addEventListener("click", exportParents);
  $("downloadTemplate").addEventListener("click", downloadTemplate);

  $("btnPrint").addEventListener("click", function () {
    window.print();
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one parent.");
    $("bulkbar").classList.add("show");
  });

  $("bulkArchive").addEventListener("click", function () {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one parent.");
    if (!window.confirm(`Archive ${ids.length} selected parent(s)?`)) return;
    $("bulkIds").value = ids.join(",");
    $("bulkForm").submit();
  });

  $("bulkResend").addEventListener("click", function () {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one parent.");
    if (!window.confirm(`Send setup links to ${ids.length} selected parent(s)?`)) return;
    $("bulkResendIds").value = ids.join(",");
    $("bulkResendForm").submit();
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    renderTable();
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) PARENTS.forEach((p) => state.selected.add(p.id));
    else PARENTS.forEach((p) => state.selected.delete(p.id));
    renderTable();
  });

  $("tbodyParents").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyParents").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const p = PARENTS.find((x) => x.id === tr.dataset.id);
    if (!p) return;

    if (
      e.target.closest(".rowCheck") ||
      e.target.closest(".actions") ||
      e.target.closest(".btn-xs")
    ) {
      if (e.target.closest(".actView")) return openViewModal(p);
      if (e.target.closest(".actEdit")) return openEditor(p);

      if (e.target.closest(".actResend")) {
        if (!window.confirm(`Resend setup link to "${p.fullName}"?`)) return;
        return submitRowAction(`/admin/parents/${encodeURIComponent(p.id)}/resend-setup`);
      }

      if (e.target.closest(".actArchive")) {
        if (!window.confirm(`Archive "${p.fullName}"?`)) return;
        return submitRowAction(`/admin/parents/${encodeURIComponent(p.id)}/archive`);
      }

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${p.fullName}" permanently?`)) return;
        return submitRowAction(`/admin/parents/${encodeURIComponent(p.id)}/delete`);
      }

      return;
    }

    openViewModal(p);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const p = PARENTS.find((x) => x.id === state.currentViewId);
    if (!p) return;
    closeModal("mView");
    openEditor(p);
  });

  $("viewResendBtn").addEventListener("click", function () {
    const p = PARENTS.find((x) => x.id === state.currentViewId);
    if (!p) return;
    if (!window.confirm(`Resend setup link to "${p.fullName}"?`)) return;
    submitRowAction(`/admin/parents/${encodeURIComponent(p.id)}/resend-setup`);
  });

  $("saveBtn").addEventListener("click", saveParent);
  $("mNotes").addEventListener("input", updateCounters);

  $("mKids").addEventListener("input", function () {
    const kids = splitComma($("mKids").value).filter(isObjectId).slice(0, 200);
    $("mChildrenCount").value = String(kids.length);
  });

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mEdit", "mView", "mImport"].forEach(function (mid) {
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
  updateCounters();
})();
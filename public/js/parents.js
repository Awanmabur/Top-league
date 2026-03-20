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

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

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
    if (status === "active") {
      return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>';
    }
    if (status === "on_hold") {
      return '<span class="pill warn"><i class="fa-solid fa-pause"></i> On Hold</span>';
    }
    if (status === "suspended") {
      return '<span class="pill bad"><i class="fa-solid fa-ban"></i> Suspended</span>';
    }
    return '<span class="pill info"><i class="fa-solid fa-box-archive"></i> Archived</span>';
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
    $("tbodyParents").innerHTML =
      PARENTS.map((p) => {
        const checked = state.selected.has(p.id) ? "checked" : "";
        const kids = Array.isArray(p.childrenStudentIds) ? p.childrenStudentIds : [];
        return `
          <tr class="row-clickable" data-id="${escapeHtml(p.id)}">
            <td class="col-check">
              <input type="checkbox" class="rowCheck" data-id="${escapeHtml(p.id)}" ${checked}>
            </td>

            <td class="col-parent">
              <div class="parent-main">
                <div class="parent-title" title="${escapeHtml(p.fullName || "—")}">${escapeHtml(p.fullName || "—")}</div>
                <div class="parent-sub" title="${escapeHtml(p.relationship || "—")}">${escapeHtml(p.relationship || "—")}</div>
              </div>
            </td>

            <td class="col-email">
              <span class="cell-ellipsis" title="${escapeHtml(p.email || "—")}">${escapeHtml(p.email || "—")}</span>
            </td>

            <td class="col-phone">
              <span class="cell-ellipsis" title="${escapeHtml(p.phone || "—")}">${escapeHtml(p.phone || "—")}</span>
            </td>

            <td class="col-relationship">
              <span class="cell-ellipsis" title="${escapeHtml(p.relationship || "—")}">${escapeHtml(p.relationship || "—")}</span>
            </td>

            <td class="col-kids">
              <span class="cell-ellipsis">${escapeHtml(String(kids.length || 0))}</span>
            </td>

            <td class="col-status">
              ${statusPill(p.status)}
            </td>

            <td class="col-created">
              <span class="cell-ellipsis">${escapeHtml(formatDate(p.createdAt))}</span>
            </td>

            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actResend" type="button" title="Resend Setup"><i class="fa-solid fa-paper-plane"></i></button>
                <button class="btn-xs actArchive" type="button" title="Archive"><i class="fa-solid fa-box-archive"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
      <tr>
        <td colspan="9" style="padding:18px;">
          <div class="muted">No parents found.</div>
        </td>
      </tr>
      `;

    $("checkAll").checked = PARENTS.length > 0 && PARENTS.every((p) => state.selected.has(p.id));
    syncBulkbar();
  }

  function fillHiddenKids(values) {
    const wrap = $("mKidsWrap");
    wrap.innerHTML = "";

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
    $("mKidsWrap").innerHTML = "";

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
    $("vStatus").innerHTML = statusPill(p.status || "active");
    $("vNotes").textContent = p.notes || "—";

    const host = $("vKids");
    host.innerHTML = "";

    const kids = Array.isArray(p.childrenStudentIds) ? p.childrenStudentIds : [];
    if (!kids.length) {
      host.innerHTML = '<span class="muted">No student IDs</span>';
    } else {
      kids.forEach((id) => {
        const span = document.createElement("span");
        span.className = "tag";
        span.innerHTML = `<i class="fa-solid fa-user-graduate"></i> ${escapeHtml(id)}`;
        host.appendChild(span);
      });
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
    const rows = [
      ["Full Name", "Email", "Phone", "Relationship", "Status", "ChildrenStudentIds", "Notes", "CreatedAt"],
      ...PARENTS.map((p) => [
        p.fullName || "",
        p.email || "",
        p.phone || "",
        p.relationship || "",
        p.status || "",
        (p.childrenStudentIds || []).join(" | "),
        p.notes || "",
        formatDate(p.createdAt),
      ]),
    ];

    downloadCsv("parents-export.csv", rows);
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
(function () {
  const $ = (id) => document.getElementById(id);

  function readDepartmentsData() {
    const el = $("departmentsData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse departments data:", err);
      return [];
    }
  }

  const DEPARTMENTS = readDepartmentsData();
  if (!$("tbodyDepartments")) return;

  const state = {
    selected: new Set(),
    currentViewId: null,
    codeTouched: false,
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
    document.body.style.overflow = document.querySelector(".modal-backdrop.show") ? "hidden" : "";
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
    return '<span class="pill warn"><i class="fa-solid fa-circle-pause"></i> Inactive</span>';
  }

  function deptInitials(name) {
    const stop = new Set(["DEPARTMENT", "OF", "THE", "AND", "SCHOOL", "FACULTY"]);
    const words = String(name || "")
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !stop.has(w));

    if (!words.length) return "DEPT";
    const letters = words.map((w) => w[0]).join("").slice(0, 8);
    if (letters.length >= 2) return letters;
    return (words[0] || "DEPT").slice(0, 4);
  }

  function slugCode(input) {
    return String(input || "")
      .trim()
      .toUpperCase()
      .replace(/&/g, "AND")
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 30);
  }

  function maybeAutoCode() {
    const codeEl = $("mCode");
    const nameEl = $("mName");
    const facultyEl = $("mFaculty");

    if (!codeEl || !nameEl || !facultyEl) return;
    if (state.codeTouched && codeEl.value.trim()) return;

    const name = nameEl.value.trim();
    if (!name) return;

    const opt = facultyEl.options[facultyEl.selectedIndex];
    const facultyCode = opt ? String(opt.dataset.code || "").trim().toUpperCase() : "";
    const base = facultyCode ? `${facultyCode}-${deptInitials(name)}` : deptInitials(name);
    codeEl.value = slugCode(base);
  }

  function renderTable() {
    $("tbodyDepartments").innerHTML =
      DEPARTMENTS.map((d) => {
        const checked = state.selected.has(d.id) ? "checked" : "";

        return `
          <tr class="row-clickable" data-id="${escapeHtml(d.id)}">
            <td class="col-check">
              <input type="checkbox" class="rowCheck" data-id="${escapeHtml(d.id)}" ${checked}>
            </td>

            <td class="col-name">
              <div class="dept-main">
                <div class="dept-title" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</div>
                <div class="dept-sub" title="${escapeHtml(d.description || "—")}">${escapeHtml(d.description || "—")}</div>
              </div>
            </td>

            <td class="col-code">
              <span class="cell-ellipsis" title="${escapeHtml(d.code || "—")}">${escapeHtml(d.code || "—")}</span>
            </td>

            <td class="col-faculty">
              <span class="cell-ellipsis" title="${escapeHtml(d.facultyName || "—")}">${escapeHtml(d.facultyName || "—")}</span>
            </td>

            <td class="col-hod">
              <span class="cell-ellipsis" title="${escapeHtml(d.hodName || "—")}">${escapeHtml(d.hodName || "—")}</span>
            </td>

            <td class="col-email">
              <span class="cell-ellipsis" title="${escapeHtml(d.publicEmail || "—")}">${escapeHtml(d.publicEmail || "—")}</span>
            </td>

            <td class="col-phone">
              <span class="cell-ellipsis" title="${escapeHtml(d.phone || "—")}">${escapeHtml(d.phone || "—")}</span>
            </td>

            <td class="col-programs">
              <span class="cell-ellipsis">${escapeHtml(String((d.programLabels || []).length))}</span>
            </td>

            <td class="col-courses">
              <span class="cell-ellipsis">${escapeHtml(String((d.courseCodes || []).length))}</span>
            </td>

            <td class="col-status">
              ${statusPill(d.status)}
            </td>

            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actToggle" type="button" title="Toggle Status"><i class="fa-solid fa-rotate"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
      <tr>
        <td colspan="11" style="padding:18px;">
          <div class="muted">No departments found.</div>
        </td>
      </tr>
      `;

    $("checkAll").checked = DEPARTMENTS.length > 0 && DEPARTMENTS.every((d) => state.selected.has(d.id));
    syncBulkbar();
  }

  function updateCounters() {
    $("notesCount").textContent = `${$("mNotes").value.length} / 2000`;
  }

  function selectedValues(selectEl) {
    if (!selectEl) return [];
    return Array.from(selectEl.selectedOptions).map((o) => String(o.value || "").trim()).filter(Boolean);
  }

  function setSelectedByIds(selectEl, ids) {
    if (!selectEl) return;
    const idSet = new Set((ids || []).map(String));
    Array.from(selectEl.options).forEach((opt) => {
      opt.selected = idSet.has(String(opt.value));
    });
  }

  function fillHiddenList(values, wrapId, inputName) {
    const wrap = $(wrapId);
    wrap.innerHTML = "";

    values.forEach((v) => {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = inputName;
      inp.value = v;
      wrap.appendChild(inp);
    });
  }

  function filterSelect(searchId, selectId) {
    const search = $(searchId);
    const select = $(selectId);
    if (!search || !select) return;

    search.addEventListener("input", function () {
      const q = String(search.value || "").trim().toLowerCase();
      Array.from(select.options).forEach((opt) => {
        const txt = String(opt.textContent || "").toLowerCase();
        opt.hidden = q ? !txt.includes(q) : false;
      });
    });
  }

  function openEditor(prefill) {
    const d = prefill || null;

    $("mTitle").textContent = d ? "Edit Department" : "Add Department";
    $("deptForm").action = d ? `/admin/departments/${encodeURIComponent(d.id)}` : "/admin/departments";

    $("mName").value = d ? d.name || "" : "";
    $("mCode").value = d ? d.code || "" : "";
    $("mStatus").value = d ? d.status || "active" : "active";
    $("mFaculty").value = d ? d.facultyId || "" : "";
    $("mHod").value = d ? d.hodId || "" : "";
    $("mOffice").value = d ? d.officeLocation || "" : "";
    $("mEmail").value = d ? d.publicEmail || "" : "";
    $("mPhone").value = d ? d.phone || "" : "";
    $("mDescription").value = d ? d.description || "" : "";
    $("mNotes").value = d ? d.notes || "" : "";

    setSelectedByIds($("mProgramsSel"), d ? d.programs || [] : []);
    setSelectedByIds($("mCoursesSel"), d ? d.courses || [] : []);

    $("mProgramsWrap").innerHTML = "";
    $("mCoursesWrap").innerHTML = "";

    state.codeTouched = !!(d && d.code);
    if (!d) maybeAutoCode();

    updateCounters();
    openModal("mEdit");
  }

  function renderTagList(hostId, items, iconClass) {
    const host = $(hostId);
    host.innerHTML = "";

    if (!Array.isArray(items) || !items.length) {
      host.innerHTML = '<span class="muted">None</span>';
      return;
    }

    items.forEach((item) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.innerHTML = `<i class="${iconClass}"></i> ${escapeHtml(item)}`;
      host.appendChild(span);
    });
  }

  function openViewModal(d) {
    if (!d) return;

    state.currentViewId = d.id;

    $("vName").textContent = d.name || "—";
    $("vCode").textContent = d.code || "—";
    $("vFaculty").textContent = d.facultyName || "—";
    $("vHod").textContent = d.hodName || "—";
    $("vOffice").textContent = d.officeLocation || "—";
    $("vEmail").textContent = d.publicEmail || "—";
    $("vPhone").textContent = d.phone || "—";
    $("vDescription").textContent = d.description || "—";
    $("vStatus").innerHTML = statusPill(d.status || "active");
    $("vNotes").textContent = d.notes || "—";

    renderTagList("vPrograms", d.programLabels || [], "fa-solid fa-graduation-cap");
    renderTagList("vCourses", d.courseCodes || [], "fa-solid fa-book");

    openModal("mView");
  }

  function saveDepartment() {
    const name = $("mName").value.trim();
    if (!name) return alert("Department name is required.");

    fillHiddenList(selectedValues($("mProgramsSel")).slice(0, 500), "mProgramsWrap", "programs[]");
    fillHiddenList(selectedValues($("mCoursesSel")).slice(0, 500), "mCoursesWrap", "courses[]");

    $("deptForm").submit();
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

  function exportDepartments() {
    const rows = [
      ["Name", "Code", "Faculty", "HOD", "Status", "Office", "Email", "Phone", "Description", "Notes", "Programs", "Courses"],
      ...DEPARTMENTS.map((d) => [
        d.name || "",
        d.code || "",
        d.facultyName || "",
        d.hodName || "",
        d.status || "",
        d.officeLocation || "",
        d.publicEmail || "",
        d.phone || "",
        d.description || "",
        d.notes || "",
        (d.programLabels || []).join(" | "),
        (d.courseCodes || []).join(" | "),
      ]),
    ];

    downloadCsv("departments-export.csv", rows);
  }

  function submitBulkStatus(status) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one department.");
    $("bulkIds").value = ids.join(",");
    $("bulkStatus").value = status;
    $("bulkStatusForm").submit();
  }

  function submitBulkDelete() {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one department.");
    if (!window.confirm(`Delete ${ids.length} selected department(s)?`)) return;
    $("bulkDeleteIds").value = ids.join(",");
    $("bulkDeleteForm").submit();
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickActive").addEventListener("click", function () {
    openEditor();
    $("mStatus").value = "active";
  });

  $("quickInactive").addEventListener("click", function () {
    openEditor();
    $("mStatus").value = "inactive";
  });

  $("btnImport").addEventListener("click", function () {
    openModal("mImport");
  });

  $("quickImport").addEventListener("click", function () {
    openModal("mImport");
  });

  $("btnExport").addEventListener("click", exportDepartments);
  $("btnPrint").addEventListener("click", function () {
    window.print();
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one department.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate").addEventListener("click", function () {
    submitBulkStatus("active");
  });

  $("bulkDeactivate").addEventListener("click", function () {
    submitBulkStatus("inactive");
  });

  $("bulkDelete").addEventListener("click", submitBulkDelete);

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    renderTable();
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) DEPARTMENTS.forEach((d) => state.selected.add(d.id));
    else DEPARTMENTS.forEach((d) => state.selected.delete(d.id));
    renderTable();
  });

  $("tbodyDepartments").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyDepartments").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const d = DEPARTMENTS.find((x) => x.id === tr.dataset.id);
    if (!d) return;

    if (
      e.target.closest(".rowCheck") ||
      e.target.closest(".actions") ||
      e.target.closest(".btn-xs")
    ) {
      if (e.target.closest(".actView")) return openViewModal(d);
      if (e.target.closest(".actEdit")) return openEditor(d);

      if (e.target.closest(".actToggle")) {
        const next = d.status === "active" ? "inactive" : "active";
        if (!window.confirm(`Set "${d.name}" to ${next}?`)) return;
        $("bulkIds").value = d.id;
        $("bulkStatus").value = next;
        return $("bulkStatusForm").submit();
      }

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${d.name}" permanently?`)) return;
        return submitRowAction(`/admin/departments/${encodeURIComponent(d.id)}/delete`);
      }

      return;
    }

    openViewModal(d);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const d = DEPARTMENTS.find((x) => x.id === state.currentViewId);
    if (!d) return;
    closeModal("mView");
    openEditor(d);
  });

  $("saveBtn").addEventListener("click", saveDepartment);
  $("mNotes").addEventListener("input", updateCounters);

  $("mCode").addEventListener("input", function () {
    state.codeTouched = $("mCode").value.trim().length > 0;
  });

  $("mName").addEventListener("input", function () {
    if (!state.codeTouched) maybeAutoCode();
  });

  $("mFaculty").addEventListener("change", function () {
    if (!state.codeTouched) maybeAutoCode();
  });

  filterSelect("mProgramsSearch", "mProgramsSel");
  filterSelect("mCoursesSearch", "mCoursesSel");

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
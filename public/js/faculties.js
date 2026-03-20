(function () {
  const $ = (id) => document.getElementById(id);

  function readFacultiesData() {
    const el = $("facultiesData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse faculties data:", err);
      return [];
    }
  }

  const FACULTIES = readFacultiesData();
  if (!$("tbodyFaculties")) return;

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
      .map((x) => x.trim())
      .filter(Boolean);
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

  function submitRowAction(actionUrl, statusValue) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    if ($("rowStatusValue")) $("rowStatusValue").value = statusValue || "";
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

  function renderLinkedCounts(f) {
    const d = Array.isArray(f.departmentLabels) ? f.departmentLabels.length : 0;
    const p = Array.isArray(f.programLabels) ? f.programLabels.length : 0;
    const c = Array.isArray(f.courseLabels) ? f.courseLabels.length : 0;
    return `${d} dept • ${p} prog • ${c} course`;
  }

  function renderTable() {
    $("tbodyFaculties").innerHTML =
      FACULTIES.map((f) => {
        const checked = state.selected.has(f.id) ? "checked" : "";

        return `
          <tr class="row-clickable" data-id="${escapeHtml(f.id)}">
            <td class="col-check">
              <input type="checkbox" class="rowCheck" data-id="${escapeHtml(f.id)}" ${checked}>
            </td>

            <td class="col-faculty">
              <div class="faculty-main">
                <div class="faculty-title" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
                <div class="faculty-sub" title="${escapeHtml(f.publicEmail || "—")}">${escapeHtml(f.publicEmail || "—")}</div>
              </div>
            </td>

            <td class="col-code">
              <span class="cell-ellipsis" title="${escapeHtml(f.code || "—")}">${escapeHtml(f.code || "—")}</span>
            </td>

            <td class="col-dean">
              <span class="cell-ellipsis" title="${escapeHtml(f.deanName || "—")}">${escapeHtml(f.deanName || "—")}</span>
            </td>

            <td class="col-contact">
              <span class="cell-ellipsis" title="${escapeHtml((f.publicEmail || "—") + " • " + (f.phone || "—"))}">
                ${escapeHtml(f.publicEmail || "—")} • ${escapeHtml(f.phone || "—")}
              </span>
            </td>

            <td class="col-links">
              <span class="cell-ellipsis" title="${escapeHtml(renderLinkedCounts(f))}">${escapeHtml(renderLinkedCounts(f))}</span>
            </td>

            <td class="col-office">
              <span class="cell-ellipsis" title="${escapeHtml(f.officeLocation || "—")}">${escapeHtml(f.officeLocation || "—")}</span>
            </td>

            <td class="col-status">
              ${statusPill(f.status)}
            </td>

            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actToggle" type="button" title="Toggle Status"><i class="fa-solid fa-repeat"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
      <tr>
        <td colspan="9" style="padding:18px;">
          <div class="muted">No faculties found.</div>
        </td>
      </tr>
      `;

    $("checkAll").checked = FACULTIES.length > 0 && FACULTIES.every((f) => state.selected.has(f.id));
    syncBulkbar();
  }

  function fillHiddenList(wrapId, inputName, values) {
    const wrap = $(wrapId);
    if (!wrap) return;
    wrap.innerHTML = "";

    values.forEach((v) => {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = inputName;
      inp.value = v;
      wrap.appendChild(inp);
    });
  }

  function updateCounters() {
    $("descCount").textContent = `${$("mDesc").value.length} / 1200`;
  }

  function openEditor(prefill) {
    const f = prefill || null;

    $("mTitle").textContent = f ? "Edit Faculty" : "Add Faculty";
    $("facultyForm").action = f ? `/admin/faculties/${encodeURIComponent(f.id)}` : "/admin/faculties";

    $("mName").value = f ? f.name || "" : "";
    $("mCode").value = f ? f.code || "" : "";
    $("mStatus").value = f ? f.status || "active" : "active";
    $("mDean").value = f ? f.deanId || "" : "";
    $("mEmail").value = f ? f.publicEmail || "" : "";
    $("mPhone").value = f ? f.phone || "" : "";
    $("mOffice").value = f ? f.officeLocation || "" : "";
    $("mDesc").value = f ? f.description || "" : "";
    $("mDepartments").value = f ? (Array.isArray(f.departments) ? f.departments.join(", ") : "") : "";
    $("mPrograms").value = f ? (Array.isArray(f.programs) ? f.programs.join(", ") : "") : "";
    $("mCourses").value = f ? (Array.isArray(f.courses) ? f.courses.join(", ") : "") : "";

    $("mDepartmentsWrap").innerHTML = "";
    $("mProgramsWrap").innerHTML = "";
    $("mCoursesWrap").innerHTML = "";

    updateCounters();
    openModal("mEdit");
  }

  function renderTagList(hostId, items, icon) {
    const host = $(hostId);
    host.innerHTML = "";

    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) {
      host.innerHTML = '<span class="muted">None</span>';
      return;
    }

    arr.forEach((label) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.innerHTML = `<i class="${icon}"></i> ${escapeHtml(label)}`;
      host.appendChild(span);
    });
  }

  function openViewModal(f) {
    if (!f) return;
    state.currentViewId = f.id;

    $("vName").textContent = f.name || "—";
    $("vCode").textContent = f.code || "—";
    $("vDean").textContent = f.deanName || "—";
    $("vEmail").textContent = f.publicEmail || "—";
    $("vPhone").textContent = f.phone || "—";
    $("vOffice").textContent = f.officeLocation || "—";
    $("vDesc").textContent = f.description || "—";
    $("vStatus").innerHTML = statusPill(f.status || "active");

    renderTagList("vDepartments", f.departmentLabels || [], "fa-solid fa-building");
    renderTagList("vPrograms", f.programLabels || [], "fa-solid fa-graduation-cap");
    renderTagList("vCourses", f.courseLabels || [], "fa-solid fa-book");

    openModal("mView");
  }

  function saveFaculty() {
    const name = $("mName").value.trim();
    if (!name) return alert("Faculty name is required.");

    const departments = splitComma($("mDepartments").value).slice(0, 200);
    const programs = splitComma($("mPrograms").value).slice(0, 200);
    const courses = splitComma($("mCourses").value).slice(0, 200);

    fillHiddenList("mDepartmentsWrap", "departments[]", departments);
    fillHiddenList("mProgramsWrap", "programs[]", programs);
    fillHiddenList("mCoursesWrap", "courses[]", courses);

    $("facultyForm").submit();
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

  function exportFaculties() {
    const rows = [
      ["Name", "Code", "Status", "Dean", "PublicEmail", "Phone", "OfficeLocation", "Description", "Departments", "Programs", "Courses"],
      ...FACULTIES.map((f) => [
        f.name || "",
        f.code || "",
        f.status || "",
        f.deanName || "",
        f.publicEmail || "",
        f.phone || "",
        f.officeLocation || "",
        f.description || "",
        (f.departmentLabels || []).join(" | "),
        (f.programLabels || []).join(" | "),
        (f.courseLabels || []).join(" | "),
      ]),
    ];

    downloadCsv("faculties-export.csv", rows);
  }

  function runBulk(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one faculty.");

    if (action === "delete") {
      if (!window.confirm(`Delete ${ids.length} selected faculty record(s)?`)) return;
    } else {
      if (!window.confirm(`Apply "${action}" to ${ids.length} selected faculty record(s)?`)) return;
    }

    $("bulkActionValue").value = action;
    $("bulkIds").value = ids.join(",");
    $("bulkForm").submit();
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

  $("btnExport").addEventListener("click", exportFaculties);
  $("btnPrint").addEventListener("click", function () {
    window.print();
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one faculty.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate").addEventListener("click", function () {
    runBulk("activate");
  });

  $("bulkDeactivate").addEventListener("click", function () {
    runBulk("deactivate");
  });

  $("bulkDelete").addEventListener("click", function () {
    runBulk("delete");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    renderTable();
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) FACULTIES.forEach((f) => state.selected.add(f.id));
    else FACULTIES.forEach((f) => state.selected.delete(f.id));
    renderTable();
  });

  $("tbodyFaculties").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyFaculties").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const f = FACULTIES.find((x) => x.id === tr.dataset.id);
    if (!f) return;

    if (
      e.target.closest(".rowCheck") ||
      e.target.closest(".actions") ||
      e.target.closest(".btn-xs")
    ) {
      if (e.target.closest(".actView")) return openViewModal(f);
      if (e.target.closest(".actEdit")) return openEditor(f);

      if (e.target.closest(".actToggle")) {
        const next = f.status === "active" ? "inactive" : "active";
        if (!window.confirm(`Change status of "${f.name}" to ${next}?`)) return;
        return submitRowAction(`/admin/faculties/${encodeURIComponent(f.id)}/status`, next);
      }

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${f.name}" permanently?`)) return;
        return submitRowAction(`/admin/faculties/${encodeURIComponent(f.id)}/delete`);
      }

      return;
    }

    openViewModal(f);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const f = FACULTIES.find((x) => x.id === state.currentViewId);
    if (!f) return;
    closeModal("mView");
    openEditor(f);
  });

  $("saveBtn").addEventListener("click", saveFaculty);
  $("mDesc").addEventListener("input", updateCounters);

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
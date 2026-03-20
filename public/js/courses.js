(function () {
  const $ = (id) => document.getElementById(id);

  function readCoursesData() {
    const el = $("coursesData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse courses data:", err);
      return [];
    }
  }

  const COURSES = readCoursesData();
  if (!$("tbodyCourses")) return;

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

  function submitRowAction(actionUrl, status) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    if ($("rowStatusField")) $("rowStatusField").value = status || "";
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
    if (status === "archived") {
      return '<span class="pill bad"><i class="fa-solid fa-box-archive"></i> Archived</span>';
    }
    return '<span class="pill warn"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
  }

  function titleCase(v) {
    const s = String(v || "");
    if (!s) return "—";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function renderTable() {
    $("tbodyCourses").innerHTML =
      COURSES.map((c) => {
        const checked = state.selected.has(c.id) ? "checked" : "";
        const staff = [c.coordinatorName || "—", c.lecturerName || "—"].join(" / ");

        return `
          <tr class="row-clickable" data-id="${escapeHtml(c.id)}">
            <td class="col-check">
              <input type="checkbox" class="rowCheck" data-id="${escapeHtml(c.id)}" ${checked}>
            </td>

            <td class="col-course">
              <div class="course-main">
                <div class="course-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</div>
                <div class="course-sub" title="${escapeHtml(c.code || "—")}">${escapeHtml(c.code || "—")}</div>
              </div>
            </td>

            <td class="col-program">
              <span class="cell-ellipsis" title="${escapeHtml(c.programName || "—")}">
                ${escapeHtml(c.programName || "—")}
              </span>
            </td>

            <td class="col-department">
              <span class="cell-ellipsis" title="${escapeHtml(c.departmentName || "—")}">
                ${escapeHtml(c.departmentName || "—")}
              </span>
            </td>

            <td class="col-level">
              <span class="cell-ellipsis" title="${escapeHtml(c.level || "—")}">
                ${escapeHtml(c.level || "—")}
              </span>
            </td>

            <td class="col-yos">
              <span class="cell-ellipsis">${escapeHtml(String(c.yearOfStudy || 0))}</span>
            </td>

            <td class="col-sem">
              <span class="cell-ellipsis">${escapeHtml(String(c.semester || 0))}</span>
            </td>

            <td class="col-type">
              <span class="cell-ellipsis">${escapeHtml(titleCase(c.type))}</span>
            </td>

            <td class="col-mode">
              <span class="cell-ellipsis">${escapeHtml(titleCase(c.studyMode))}</span>
            </td>

            <td class="col-credits">
              <span class="cell-ellipsis">${escapeHtml(String(c.credits || 0))} / ${escapeHtml(String(c.contactHours || 0))}</span>
            </td>

            <td class="col-staff">
              <span class="cell-ellipsis" title="${escapeHtml(staff)}">
                ${escapeHtml(staff)}
              </span>
            </td>

            <td class="col-status">
              ${statusPill(c.status)}
            </td>

            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actStatus" type="button" title="Change Status"><i class="fa-solid fa-rotate"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
      <tr>
        <td colspan="13" style="padding:18px;">
          <div class="muted">No courses found.</div>
        </td>
      </tr>
      `;

    $("checkAll").checked = COURSES.length > 0 && COURSES.every((c) => state.selected.has(c.id));
    syncBulkbar();
  }

  function fillPrereqHidden(values) {
    const wrap = $("mPrereqWrap");
    if (!wrap) return;
    wrap.innerHTML = "";

    values.forEach((v) => {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = "prerequisites[]";
      inp.value = v;
      wrap.appendChild(inp);
    });
  }

  function updateCounters() {
    $("descCount").textContent = `${$("mDescription").value.length} / 1200`;
    $("objCount").textContent = `${$("mObjectives").value.length} / 1200`;
    $("outlineCount").textContent = `${$("mOutline").value.length} / 5000`;
  }

  function openEditor(prefill) {
    const c = prefill || null;

    $("mTitleBar").textContent = c ? "Edit Course" : "Add Course";
    $("courseForm").action = c ? `/admin/courses/${encodeURIComponent(c.id)}` : "/admin/courses";

    $("mTitle").value = c ? c.title || "" : "";
    $("mCode").value = c ? c.code || "" : "";
    $("mStatus").value = c ? c.status || "active" : "active";
    $("mShortTitle").value = c ? c.shortTitle || "" : "";
    $("mLevel").value = c ? c.level || "" : "";
    $("mProgram").value = c ? c.programId || "" : "";
    $("mDepartment").value = c ? c.departmentId || "" : "";
    $("mYearOfStudy").value = c ? String(c.yearOfStudy ?? 1) : "1";
    $("mSemester").value = c ? String(c.semester ?? 1) : "1";
    $("mCredits").value = c ? String(c.credits || 0) : "";
    $("mContactHours").value = c ? String(c.contactHours || 0) : "";
    $("mType").value = c ? c.type || "core" : "core";
    $("mStudyMode").value = c ? c.studyMode || "day" : "day";
    $("mCoordinator").value = c ? c.coordinatorId || "" : "";
    $("mLecturer").value = c ? c.lecturerId || "" : "";
    $("mDescription").value = c ? c.description || "" : "";
    $("mObjectives").value = c ? c.objectives || "" : "";
    $("mOutline").value = c ? c.outline || "" : "";

    const preSel = $("mPrerequisites");
    if (preSel) {
      const ids = c && Array.isArray(c.prerequisites) ? c.prerequisites : [];
      Array.from(preSel.options).forEach((o) => {
        o.selected = ids.includes(o.value);
      });
    }

    $("mPrereqWrap").innerHTML = "";
    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(c) {
    if (!c) return;

    state.currentViewId = c.id;

    $("vTitle").textContent = c.title || "—";
    $("vCode").textContent = c.code || "—";
    $("vShortTitle").textContent = c.shortTitle || "—";
    $("vLevel").textContent = c.level || "—";
    $("vProgram").textContent = c.programName || "—";
    $("vDepartment").textContent = c.departmentName || "—";
    $("vYearSemester").textContent = `Year ${Number(c.yearOfStudy || 0)} • Semester ${Number(c.semester || 0)}`;
    $("vCreditsHours").textContent = `Credits ${Number(c.credits || 0)} • Hours ${Number(c.contactHours || 0)}`;
    $("vTypeMode").textContent = `${titleCase(c.type)} • ${titleCase(c.studyMode)}`;
    $("vCoordinator").textContent = c.coordinatorName || "—";
    $("vLecturer").textContent = c.lecturerName || "—";
    $("vStatus").innerHTML = statusPill(c.status || "active");
    $("vDescription").textContent = c.description || "—";
    $("vObjectives").textContent = c.objectives || "—";
    $("vOutline").textContent = c.outline || "—";

    const host = $("vPrerequisites");
    host.innerHTML = "";
    const prereqs = Array.isArray(c.prerequisiteLabels) ? c.prerequisiteLabels : [];

    if (!prereqs.length) {
      host.innerHTML = '<span class="muted">No prerequisites</span>';
    } else {
      prereqs.forEach((p) => {
        const span = document.createElement("span");
        span.className = "tag";
        span.innerHTML = `<i class="fa-solid fa-link"></i> ${escapeHtml(p.label)}`;
        host.appendChild(span);
      });
    }

    openModal("mView");
  }

  function saveCourse() {
    const title = $("mTitle").value.trim();
    if (!title) return alert("Course title is required.");

    const preSel = $("mPrerequisites");
    const ids = preSel ? Array.from(preSel.selectedOptions).map((o) => o.value) : [];
    fillPrereqHidden(ids);

    $("courseForm").submit();
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

  function exportCourses() {
    const rows = [
      [
        "Title",
        "Code",
        "ShortTitle",
        "Program",
        "Department",
        "Level",
        "YearOfStudy",
        "Semester",
        "Credits",
        "ContactHours",
        "Type",
        "StudyMode",
        "Coordinator",
        "Lecturer",
        "Status",
        "Description",
        "Objectives",
        "Outline",
        "Prerequisites"
      ],
      ...COURSES.map((c) => [
        c.title || "",
        c.code || "",
        c.shortTitle || "",
        c.programName || "",
        c.departmentName || "",
        c.level || "",
        c.yearOfStudy || 0,
        c.semester || 0,
        c.credits || 0,
        c.contactHours || 0,
        c.type || "",
        c.studyMode || "",
        c.coordinatorName || "",
        c.lecturerName || "",
        c.status || "",
        c.description || "",
        c.objectives || "",
        c.outline || "",
        (c.prerequisiteLabels || []).map((x) => x.label).join(" | "),
      ]),
    ];

    downloadCsv("courses-export.csv", rows);
  }

  function submitBulk(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one course.");

    if (action === "delete" && !window.confirm(`Delete ${ids.length} selected course(s) permanently?`)) return;
    if (action === "archive" && !window.confirm(`Archive ${ids.length} selected course(s)?`)) return;

    $("bulkActionField").value = action;
    $("bulkIdsField").value = ids.join(",");
    $("bulkForm").submit();
  }

  function updateStatusCurrent(nextStatus) {
    const c = COURSES.find((x) => x.id === state.currentViewId);
    if (!c) return;
    if (!window.confirm(`Set "${c.title}" to ${nextStatus}?`)) return;
    submitRowAction(`/admin/courses/${encodeURIComponent(c.id)}/status`, nextStatus);
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickCore").addEventListener("click", function () {
    openEditor();
    $("mType").value = "core";
  });

  $("quickElective").addEventListener("click", function () {
    openEditor();
    $("mType").value = "elective";
  });

  $("quickOnline").addEventListener("click", function () {
    openEditor();
    $("mStudyMode").value = "online";
  });

  $("btnExport").addEventListener("click", exportCourses);
  $("btnPrint").addEventListener("click", function () {
    window.print();
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one course.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate").addEventListener("click", function () {
    submitBulk("activate");
  });

  $("bulkDraft").addEventListener("click", function () {
    submitBulk("draft");
  });

  $("bulkArchive").addEventListener("click", function () {
    submitBulk("archive");
  });

  $("bulkDelete").addEventListener("click", function () {
    submitBulk("delete");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    renderTable();
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) COURSES.forEach((c) => state.selected.add(c.id));
    else COURSES.forEach((c) => state.selected.delete(c.id));
    renderTable();
  });

  $("tbodyCourses").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyCourses").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const c = COURSES.find((x) => x.id === tr.dataset.id);
    if (!c) return;

    if (
      e.target.closest(".rowCheck") ||
      e.target.closest(".actions") ||
      e.target.closest(".btn-xs")
    ) {
      if (e.target.closest(".actView")) return openViewModal(c);
      if (e.target.closest(".actEdit")) return openEditor(c);

      if (e.target.closest(".actStatus")) {
        const next = c.status === "active" ? "draft" : "active";
        if (!window.confirm(`Change "${c.title}" to ${next}?`)) return;
        return submitRowAction(`/admin/courses/${encodeURIComponent(c.id)}/status`, next);
      }

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${c.title}" permanently?`)) return;
        return submitRowAction(`/admin/courses/${encodeURIComponent(c.id)}/delete`);
      }

      return;
    }

    openViewModal(c);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const c = COURSES.find((x) => x.id === state.currentViewId);
    if (!c) return;
    closeModal("mView");
    openEditor(c);
  });

  $("viewActivateBtn").addEventListener("click", function () {
    updateStatusCurrent("active");
  });

  $("viewDraftBtn").addEventListener("click", function () {
    updateStatusCurrent("draft");
  });

  $("viewArchiveBtn").addEventListener("click", function () {
    updateStatusCurrent("archived");
  });

  $("saveBtn").addEventListener("click", saveCourse);
  $("mDescription").addEventListener("input", updateCounters);
  $("mObjectives").addEventListener("input", updateCounters);
  $("mOutline").addEventListener("input", updateCounters);

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mEdit", "mView"].forEach(function (mid) {
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
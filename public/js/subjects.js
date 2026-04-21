(function () {
  const $ = (id) => document.getElementById(id);
  const BASE_PATH = "/admin/subjects";

  function readJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.value || JSON.stringify(fallback));
    } catch (err) {
      console.error("Failed to parse JSON:", id, err);
      return fallback;
    }
  }

  const SUBJECTS = readJson("subjectsData", []);
  const CLASSES = readJson("classesData", []);
  const STRUCTURE = readJson("structureData", []);
  const SECTIONS_MAP = readJson("sectionsMap", {});
  const STREAMS = readJson("streamsData", []);
  if (!$("tbodySubjects")) return;

  const state = { selected: new Set(), currentViewId: null };

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
    if (status === "active") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>';
    if (status === "archived") return '<span class="pill bad"><i class="fa-solid fa-box-archive"></i> Archived</span>';
    return '<span class="pill warn"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
  }

  function schoolLevelLabel(v) {
    const map = { nursery: "Nursery", primary: "Primary", secondary: "Secondary" };
    return map[v] || v || "—";
  }

  function categoryLabel(v) {
    const map = {
      core: "Core",
      practical: "Practical",
      language: "Language",
      religious: "Religious",
      "co-curricular": "Co-curricular",
      general: "General",
    };
    return map[v] || v || "—";
  }

  function campusesForUnit(unitId) {
    const unit = STRUCTURE.find((x) => String(x.id) === String(unitId));
    return unit ? (unit.campuses || []) : [];
  }

  function levelsForCampus(unitId, campusId) {
    const campus = campusesForUnit(unitId).find((x) => String(x.id) === String(campusId));
    return campus ? (campus.levels || []) : [];
  }

  function classOptions(unitId, campusId, levelType) {
    return CLASSES.filter((c) =>
      (!unitId || String(c.schoolUnitId) === String(unitId)) &&
      (!campusId || String(c.campusId) === String(campusId)) &&
      (!levelType || String(c.levelType) === String(levelType))
    );
  }

  function fillCampusOptions(unitId, selected) {
    const html = campusesForUnit(unitId).map((c) => (
      `<option value="${escapeHtml(c.id)}" ${String(selected || "") === String(c.id) ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )).join("");
    $("mCampusId").innerHTML = `<option value="">— Select Campus —</option>${html}`;
    if (selected && $("mCampusId").value !== String(selected)) $("mCampusId").value = "";
  }

  function fillLevelOptions(unitId, campusId, selectedLevelType) {
    const campusLevels = levelsForCampus(unitId, campusId);
    let options = campusLevels.map((l) => ({
      type: String(l.type || "").toLowerCase(),
      name: l.name || schoolLevelLabel(l.type),
    })).filter((l) => l.type);

    if (!options.length) {
      options = [
        { type: "nursery", name: "Nursery" },
        { type: "primary", name: "Primary" },
        { type: "secondary", name: "Secondary" },
      ];
    }

    const html = options.map((l) => (
      `<option value="${escapeHtml(l.type)}" ${String(selectedLevelType || "") === String(l.type) ? "selected" : ""}>${escapeHtml(l.name)}</option>`
    )).join("");

    $("mLevelType").innerHTML = `<option value="">— Select Level —</option>${html}`;
    if (selectedLevelType && $("mLevelType").value !== String(selectedLevelType)) $("mLevelType").value = "";
  }

  function fillClassOptions(unitId, campusId, levelType, selected) {
    const html = classOptions(unitId, campusId, levelType).map((c) => {
      const label = [
        c.name || c.classLevel || "Class",
        c.classLevel ? `(${c.classLevel})` : "",
        c.stream ? `• ${c.stream}` : "",
        c.academicYear ? `• ${c.academicYear}` : "",
      ].filter(Boolean).join(" ");
      return `<option value="${escapeHtml(c.id)}" ${String(selected || "") === String(c.id) ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");

    $("mClassId").innerHTML = `<option value="">— Select Class —</option>${html}`;
    if (selected && $("mClassId").value !== String(selected)) $("mClassId").value = "";
  }

  function fillSectionOptions(classId, selected) {
    const html = (SECTIONS_MAP[String(classId)] || []).map((s) => (
      `<option value="${escapeHtml(s.id)}" ${String(selected || "") === String(s.id) ? "selected" : ""}>${escapeHtml(s.name)}</option>`
    )).join("");
    $("mSectionId").innerHTML = `<option value="">— Whole Class —</option>${html}`;
    if (selected && $("mSectionId").value !== String(selected)) $("mSectionId").value = "";
  }

  function fillStreamOptions(classId, sectionId, selected) {
    const rows = STREAMS.filter((s) =>
      (!classId || String(s.classId || "") === String(classId)) &&
      (!sectionId || !s.sectionId || String(s.sectionId || "") === String(sectionId))
    );
    const html = rows.map((s) => {
      const value = String(s.id || s._id || "");
      return `<option value="${escapeHtml(value)}" ${String(selected || "") === value ? "selected" : ""}>${escapeHtml(s.name || s.label || "Stream")}</option>`;
    }).join("");
    $("mStreamId").innerHTML = `<option value="">— All Streams —</option>${html}`;
    if (selected && $("mStreamId").value !== String(selected)) $("mStreamId").value = "";
  }

  function renderTable() {
    $("tbodySubjects").innerHTML =
      SUBJECTS.map((s) => {
        const checked = state.selected.has(s.id) ? "checked" : "";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(s.id)}">
            <td class="col-check"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(s.id)}" ${checked}></td>
            <td class="col-subject">
              <div class="subject-main">
                <div class="subject-title" title="${escapeHtml(s.title || "—")}">${escapeHtml(s.title || "—")}</div>
                <div class="subject-sub" title="${escapeHtml(s.code || "—")}">${escapeHtml(s.code || "—")}</div>
              </div>
            </td>
            <td class="col-level"><span class="cell-ellipsis">${escapeHtml(schoolLevelLabel(s.levelType))}</span></td>
            <td class="col-class"><span class="cell-ellipsis">${escapeHtml(s.className || "—")}</span></td>
            <td class="col-section"><span class="cell-ellipsis">${escapeHtml(s.sectionName || "Whole Class")}</span></td>
            <td class="col-stream"><span class="cell-ellipsis">${escapeHtml(s.streamName || "All Streams")}</span></td>
            <td class="col-term"><span class="cell-ellipsis">${escapeHtml("Term " + Number(s.term || 1))}</span></td>
            <td class="col-category"><span class="cell-ellipsis">${escapeHtml(categoryLabel(s.category))}</span></td>
            <td class="col-teacher"><span class="cell-ellipsis">${escapeHtml(s.teacherName || "—")}</span></td>
            <td class="col-status">${statusPill(s.status)}</td>
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
      }).join("") || `<tr><td colspan="11" style="padding:18px;"><div class="muted">No subjects found.</div></td></tr>`;

    $("checkAll").checked = SUBJECTS.length > 0 && SUBJECTS.every((s) => state.selected.has(s.id));
    syncBulkbar();
  }

  function updateCounters() {
    $("descCount").textContent = `${$("mDescription").value.length} / 1200`;
    $("objCount").textContent = `${$("mObjectives").value.length} / 1200`;
    $("outlineCount").textContent = `${$("mOutline").value.length} / 5000`;
  }

  function openEditor(prefill) {
    const s = prefill || null;

    $("mTitleBar").textContent = s ? "Edit Subject" : "Add Subject";
    $("subjectForm").action = s ? `${BASE_PATH}/${encodeURIComponent(s.id)}` : BASE_PATH;

    $("mTitle").value = s ? s.title || "" : "";
    $("mCode").value = s ? s.code || "" : "";
    $("mStatus").value = s ? s.status || "active" : "active";
    $("mShortTitle").value = s ? s.shortTitle || "" : "";
    $("mSchoolUnitId").value = s ? s.schoolUnitId || "" : "";
    fillCampusOptions($("mSchoolUnitId").value, s ? s.campusId : "");
    fillLevelOptions($("mSchoolUnitId").value, $("mCampusId").value, s ? s.levelType : "");
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mLevelType").value, s ? s.classId : "");
    fillSectionOptions($("mClassId").value, s ? s.sectionId : "");
    fillStreamOptions($("mClassId").value, s ? s.sectionId : "", s ? s.streamId : "");
    $("mTerm").value = s ? String(s.term ?? 1) : "1";
    $("mAcademicYear").value = s ? s.academicYear || "" : "";
    $("mCategory").value = s ? s.category || "core" : "core";
    $("mIsCompulsory").checked = s ? !!s.isCompulsory : true;
    $("mWeeklyPeriods").value = s ? String(s.weeklyPeriods || 0) : "";
    $("mPassMark").value = s ? String(s.passMark || 0) : "";
    $("mAssessmentMethod").value = s ? s.assessmentMethod || "" : "";
    $("mTeacher").value = s ? s.teacherId || "" : "";
    $("mDescription").value = s ? s.description || "" : "";
    $("mObjectives").value = s ? s.objectives || "" : "";
    $("mOutline").value = s ? s.outline || "" : "";

    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(s) {
    if (!s) return;
    state.currentViewId = s.id;

    $("vTitle").textContent = s.title || "—";
    $("vCode").textContent = s.code || "—";
    $("vStatus").innerHTML = statusPill(s.status || "active");
    $("vClass").textContent = s.className || "—";
    $("vLevel").textContent = schoolLevelLabel(s.levelType);
    $("vSection").textContent = s.sectionName || "Whole Class";
    $("vStream").textContent = s.streamName || "All Streams";
    $("vTerm").textContent = `Term ${Number(s.term || 1)}`;
    $("vCategoryType").textContent = `${categoryLabel(s.category)} • ${s.isCompulsory ? "Compulsory" : "Optional"}`;
    $("vPeriodsPass").textContent = `Periods ${Number(s.weeklyPeriods || 0)} • Pass Mark ${Number(s.passMark || 0)}%`;
    $("vAssessment").textContent = s.assessmentMethod || "—";
    $("vTeacher").textContent = s.teacherName || "—";
    $("vDescription").textContent = s.description || "—";
    $("vObjectives").textContent = s.objectives || "—";
    $("vOutline").textContent = s.outline || "—";

    openModal("mView");
  }

  function saveSubject() {
    const missing = [];
    if (!$("mTitle").value.trim()) missing.push("subject name");
    if (!$("mSchoolUnitId").value) missing.push("school unit");
    if (!$("mCampusId").value) missing.push("campus");
    if (!$("mLevelType").value) missing.push("level");
    if (!$("mClassId").value) missing.push("class");

    if (missing.length) {
      return alert(`Please select: ${missing.join(", ")}.`);
    }

    $("subjectForm").submit();
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

  function exportSubjects() {
    const rows = [[
      "Title", "Code", "SchoolUnit", "Campus", "LevelType", "Class", "Section", "Stream", "Term", "AcademicYear", "Category",
      "Compulsory", "WeeklyPeriods", "PassMark", "Teacher", "Status", "AssessmentMethod", "Description"
    ]].concat(SUBJECTS.map((s) => ([
      s.title || "",
      s.code || "",
      s.schoolUnitName || "",
      s.campusName || "",
      s.levelType || "",
      s.className || "",
      s.sectionName || "",
      s.streamName || "",
      s.term || 1,
      s.academicYear || "",
      s.category || "",
      s.isCompulsory ? "Yes" : "No",
      s.weeklyPeriods || 0,
      s.passMark || 0,
      s.teacherName || "",
      s.status || "",
      s.assessmentMethod || "",
      s.description || "",
    ])));

    downloadCsv("subjects-export.csv", rows);
  }

  function submitBulk(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one subject.");
    if (action === "delete" && !window.confirm(`Delete ${ids.length} selected subject(s) permanently?`)) return;
    if (action === "archive" && !window.confirm(`Archive ${ids.length} selected subject(s)?`)) return;
    $("bulkActionField").value = action;
    $("bulkIdsField").value = ids.join(",");
    $("bulkForm").submit();
  }

  function updateStatusCurrent(nextStatus) {
    const s = SUBJECTS.find((x) => x.id === state.currentViewId);
    if (!s) return;
    if (!window.confirm(`Set "${s.title}" to ${nextStatus}?`)) return;
    submitRowAction(`${BASE_PATH}/${encodeURIComponent(s.id)}/status`, nextStatus);
  }

  $("mSchoolUnitId").addEventListener("change", function () {
    fillCampusOptions($("mSchoolUnitId").value, "");
    fillLevelOptions($("mSchoolUnitId").value, "", "");
    fillClassOptions($("mSchoolUnitId").value, "", "", "");
    fillSectionOptions("", "");
    fillStreamOptions("", "", "");
  });

  $("mCampusId").addEventListener("change", function () {
    fillLevelOptions($("mSchoolUnitId").value, $("mCampusId").value, "");
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, "", "");
    fillSectionOptions("", "");
    fillStreamOptions("", "", "");
  });

  $("mLevelType").addEventListener("change", function () {
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mLevelType").value, "");
    fillSectionOptions("", "");
    fillStreamOptions("", "", "");
  });

  $("mClassId").addEventListener("change", function () {
    fillSectionOptions($("mClassId").value, "");
    fillStreamOptions($("mClassId").value, "", "");
  });

  $("mSectionId").addEventListener("change", function () {
    fillStreamOptions($("mClassId").value, $("mSectionId").value, "");
  });

  $("btnCreate").addEventListener("click", function () { openEditor(); });
  $("quickCore").addEventListener("click", function () { openEditor(); $("mCategory").value = "core"; });
  $("quickLanguage").addEventListener("click", function () { openEditor(); $("mCategory").value = "language"; });
  $("quickSecondary").addEventListener("click", function () {
    openEditor();
    $("mLevelType").value = "secondary";
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, "secondary", "");
  });

  $("btnExport").addEventListener("click", exportSubjects);
  $("btnPrint").addEventListener("click", function () { window.print(); });
  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one subject.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate").addEventListener("click", function () { submitBulk("activate"); });
  $("bulkDraft").addEventListener("click", function () { submitBulk("draft"); });
  $("bulkArchive").addEventListener("click", function () { submitBulk("archive"); });
  $("bulkDelete").addEventListener("click", function () { submitBulk("delete"); });
  $("bulkClear").addEventListener("click", function () { state.selected.clear(); renderTable(); });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) SUBJECTS.forEach((s) => state.selected.add(s.id));
    else SUBJECTS.forEach((s) => state.selected.delete(s.id));
    renderTable();
  });

  $("tbodySubjects").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodySubjects").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const s = SUBJECTS.find((x) => x.id === tr.dataset.id);
    if (!s) return;

    if (e.target.closest(".rowCheck") || e.target.closest(".actions") || e.target.closest(".btn-xs")) {
      if (e.target.closest(".actView")) return openViewModal(s);
      if (e.target.closest(".actEdit")) return openEditor(s);

      if (e.target.closest(".actStatus")) {
        const next = s.status === "active" ? "draft" : "active";
        if (!window.confirm(`Change "${s.title}" to ${next}?`)) return;
        return submitRowAction(`${BASE_PATH}/${encodeURIComponent(s.id)}/status`, next);
      }

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${s.title}" permanently?`)) return;
        return submitRowAction(`${BASE_PATH}/${encodeURIComponent(s.id)}/delete`);
      }
      return;
    }

    openViewModal(s);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const s = SUBJECTS.find((x) => x.id === state.currentViewId);
    if (!s) return;
    closeModal("mView");
    openEditor(s);
  });

  $("viewActivateBtn").addEventListener("click", function () { updateStatusCurrent("active"); });
  $("viewDraftBtn").addEventListener("click", function () { updateStatusCurrent("draft"); });
  $("viewArchiveBtn").addEventListener("click", function () { updateStatusCurrent("archived"); });

  $("saveBtn").addEventListener("click", saveSubject);
  $("mDescription").addEventListener("input", updateCounters);
  $("mObjectives").addEventListener("input", updateCounters);
  $("mOutline").addEventListener("input", updateCounters);

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () { closeModal(btn.dataset.closeModal); });
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
      document.querySelectorAll(".modal-backdrop.show").forEach(function (el) { el.classList.remove("show"); });
      document.body.style.overflow = "";
    }
  });

  renderTable();
  updateCounters();
})();

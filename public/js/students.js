(function () {
  const $ = (id) => document.getElementById(id);

  function readJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.value || JSON.stringify(fallback));
    } catch (err) {
      console.error(`Failed to parse ${id}:`, err);
      return fallback;
    }
  }

  const STUDENTS = readJson("studentsData", []);
  const SUBJECTS = readJson("subjectsData", []);
  const STRUCTURE = readJson("structureData", []);
  const CLASSES = readJson("classesData", []);
  const LEVEL_CLASS_MAP = readJson("classLevelMap", {});
  if (!$("tbodyStudents")) return;

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

  function schoolLevelLabel(v) {
    const map = { nursery: "Nursery", primary: "Primary", secondary: "Secondary" };
    return map[String(v || "").toLowerCase()] || v || "—";
  }

  function statusPill(status) {
    if (status === "active") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>';
    if (status === "on_hold") return '<span class="pill warn"><i class="fa-solid fa-ban"></i> On Hold</span>';
    if (status === "suspended") return '<span class="pill bad"><i class="fa-solid fa-triangle-exclamation"></i> Suspended</span>';
    if (status === "graduated") return '<span class="pill info"><i class="fa-solid fa-graduation-cap"></i> Graduated</span>';
    return '<span class="pill arch"><i class="fa-solid fa-box-archive"></i> Archived</span>';
  }

  function subjectLabelList(subjects) {
    if (!Array.isArray(subjects) || !subjects.length) return "—";
    return subjects
      .map((s) => {
        const code = String(s?.code || "").trim();
        const title = String(s?.title || s?.shortTitle || "").trim();
        return code && title ? `${code} — ${title}` : (code || title || "");
      })
      .filter(Boolean)
      .join(", ") || "—";
  }

  function selectedSubjectIds(student) {
    return student && Array.isArray(student.subjects)
      ? student.subjects.map((x) => String(x.id || x._id || x || ""))
      : [];
  }

  function campusesForUnit(unitId) {
    const unit = STRUCTURE.find((x) => String(x.id) === String(unitId));
    return unit ? (unit.campuses || []) : [];
  }

  function levelsForCampus(unitId, campusId) {
    const campus = campusesForUnit(unitId).find((x) => String(x.id) === String(campusId));
    return campus ? (campus.levels || []) : [];
  }

  function classLevelsForSchoolLevel(level) {
    return LEVEL_CLASS_MAP[String(level || "").toLowerCase()] || [];
  }

  function classesForSelection(unitId, campusId, schoolLevel, classLevel) {
    return CLASSES.filter((c) => {
      if (unitId && String(c.schoolUnitId || "") !== String(unitId)) return false;
      if (campusId && String(c.campusId || "") !== String(campusId)) return false;
      if (schoolLevel && String(c.schoolLevel || "").toLowerCase() !== String(schoolLevel || "").toLowerCase()) return false;
      if (classLevel && String(c.classLevel || "") !== String(classLevel || "")) return false;
      return true;
    });
  }

  function subjectMatches(studentLevel, studentClassLevel, studentTerm, subject) {
    const schoolLevel = String(studentLevel || "").toLowerCase();
    if (schoolLevel && String(subject.schoolLevel || "").toLowerCase() && String(subject.schoolLevel || "").toLowerCase() !== schoolLevel) return false;
    if (studentTerm && Number(subject.term || 0) && Number(subject.term) !== Number(studentTerm)) return false;
    const classLevels = Array.isArray(subject.classLevels) ? subject.classLevels : [];
    if (studentClassLevel && classLevels.length && !classLevels.includes(studentClassLevel)) return false;
    return true;
  }

  function fillCampusOptions(unitId, selected) {
    const options = campusesForUnit(unitId)
      .map((c) => `<option value="${escapeHtml(c.id)}" ${String(selected || "") === String(c.id) ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
      .join("");
    $("mCampusId").innerHTML = `<option value="">— Select Campus —</option>${options}`;
  }

  function fillLevelOptions(unitId, campusId, selected) {
    let levels = levelsForCampus(unitId, campusId);
    if (!levels.length && selected) {
      levels = [{ type: selected, name: schoolLevelLabel(selected) }];
    }
    const options = levels
      .map((l) => `<option value="${escapeHtml(l.type)}" ${String(selected || "") === String(l.type) ? "selected" : ""}>${escapeHtml(l.name || schoolLevelLabel(l.type))}</option>`)
      .join("");
    $("mSchoolLevel").innerHTML = `<option value="">— Select School Level —</option>${options}`;
  }

  function fillClassLevelOptions(levelType, selected) {
    let levels = classLevelsForSchoolLevel(levelType);
    if (!levels.length && selected) levels = [selected];
    const options = levels
      .map((item) => `<option value="${escapeHtml(item)}" ${String(selected || "") === String(item) ? "selected" : ""}>${escapeHtml(item)}</option>`)
      .join("");
    $("mClassLevel").innerHTML = `<option value="">— Select Class Level —</option>${options}`;
  }

  function fillClassOptions(unitId, campusId, schoolLevel, classLevel, selected) {
    let classes = classesForSelection(unitId, campusId, schoolLevel, classLevel);
    if (!classes.length && selected) {
      const fallback = CLASSES.find((x) => String(x.id) === String(selected));
      if (fallback) classes = [fallback];
    }
    const options = classes
      .map((c) => {
        const section = c.section ? ` • ${c.section}` : "";
        const label = `${c.name || c.code || c.classLevel}${section}`;
        return `<option value="${escapeHtml(c.id)}" ${String(selected || "") === String(c.id) ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
    $("mClassId").innerHTML = `<option value="">— Select Class —</option>${options}`;
  }

  function fillSectionOptions(unitId, campusId, schoolLevel, selectedClassId, selectedSection) {
    const sections = new Set();
    const matchedClasses = selectedClassId ? CLASSES.filter((c) => String(c.id) === String(selectedClassId)) : classesForSelection(unitId, campusId, schoolLevel, $("mClassLevel").value);

    matchedClasses.forEach((c) => {
      if (c.section) sections.add(c.section);
    });

    levelsForCampus(unitId, campusId)
      .filter((level) => !schoolLevel || String(level.type || "").toLowerCase() === String(schoolLevel || "").toLowerCase())
      .forEach((level) => {
        (level.sections || []).forEach((section) => {
          if (section.name) sections.add(section.name);
        });
      });

    let values = Array.from(sections);
    if (!values.length && selectedSection) values = [selectedSection];

    const options = values
      .map((section) => `<option value="${escapeHtml(section)}" ${String(selectedSection || "") === String(section) ? "selected" : ""}>${escapeHtml(section)}</option>`)
      .join("");
    $("mSection").innerHTML = `<option value="">— Select Section —</option>${options}`;
  }

  function fillSubjectOptions(student) {
    const level = $("mSchoolLevel").value;
    const classLevel = $("mClassLevel").value;
    const term = $("mTerm").value;
    const selectedIds = new Set(selectedSubjectIds(student));
    const selectedOptionIds = new Set(Array.from($("mSubjects").selectedOptions || []).map((o) => o.value));

    $("mSubjects").innerHTML = SUBJECTS
      .filter((subject) => subjectMatches(level, classLevel, term, subject))
      .map((subject) => {
        const id = String(subject._id || subject.id || "");
        const label = [subject.code, subject.title || subject.shortTitle].filter(Boolean).join(" — ") || id;
        const isSelected = selectedIds.has(id) || selectedOptionIds.has(id);
        return `<option value="${escapeHtml(id)}" ${isSelected ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function syncSelectionWidgets(student) {
    fillCampusOptions($("mSchoolUnitId").value, student?.campusId || $("mCampusId").value);
    fillLevelOptions($("mSchoolUnitId").value, $("mCampusId").value, student?.schoolLevel || $("mSchoolLevel").value);
    fillClassLevelOptions($("mSchoolLevel").value, student?.classLevel || $("mClassLevel").value);
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mSchoolLevel").value, $("mClassLevel").value, student?.classId || $("mClassId").value);
    fillSectionOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mSchoolLevel").value, student?.classId || $("mClassId").value, student?.section || $("mSection").value);
    fillSubjectOptions(student || null);
  }

  function applySelectedClass(selectedClassId) {
    const c = CLASSES.find((x) => String(x.id) === String(selectedClassId));
    if (!c) return;

    if (c.schoolUnitId) $("mSchoolUnitId").value = c.schoolUnitId;
    fillCampusOptions($("mSchoolUnitId").value, c.campusId || "");
    if (c.campusId) $("mCampusId").value = c.campusId;
    fillLevelOptions($("mSchoolUnitId").value, $("mCampusId").value, c.schoolLevel || "");
    if (c.schoolLevel) $("mSchoolLevel").value = c.schoolLevel;
    fillClassLevelOptions($("mSchoolLevel").value, c.classLevel || "");
    if (c.classLevel) $("mClassLevel").value = c.classLevel;
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mSchoolLevel").value, $("mClassLevel").value, c.id);
    $("mClassId").value = c.id;
    fillSectionOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mSchoolLevel").value, c.id, c.section || "");
    if (c.section) $("mSection").value = c.section;
    if (!$("mAcademicYear").value && c.academicYear) $("mAcademicYear").value = c.academicYear;
    if ((!$("mTerm").value || $("mTerm").value === "1") && c.term) $("mTerm").value = String(c.term);
    fillSubjectOptions(null);
  }

  function renderTable() {
    $("tbodyStudents").innerHTML =
      STUDENTS.map((s) => {
        const checked = state.selected.has(s.id) ? "checked" : "";
        const holdText = s.holdType ? `${s.holdType}${s.holdReason ? " • " + s.holdReason : ""}` : "—";
        const placement = [s.schoolUnitName, s.campusName, s.className || s.classLevel, s.section].filter(Boolean).join(" • ");

        return `
          <tr class="row-clickable" data-id="${escapeHtml(s.id)}">
            <td class="col-check"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(s.id)}" ${checked}></td>

            <td class="col-student">
              <div class="student-main">
                <div class="student-title" title="${escapeHtml(s.fullName || [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "))}">
                  ${escapeHtml(s.fullName || [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ") || "—")}
                </div>
                <div class="student-sub" title="${escapeHtml(s.regNo || "—")}">${escapeHtml(s.regNo || "—")}</div>
              </div>
            </td>

            <td class="col-placement"><span class="cell-ellipsis" title="${escapeHtml(placement || "—")}">${escapeHtml(placement || "—")}</span></td>
            <td class="col-level"><span class="cell-ellipsis">${escapeHtml(schoolLevelLabel(s.schoolLevel))}</span></td>
            <td class="col-class"><span class="cell-ellipsis">${escapeHtml(s.classLevel || "—")}</span></td>
            <td class="col-subjects"><span class="cell-ellipsis" title="${escapeHtml(subjectLabelList(s.subjects))}">${escapeHtml(subjectLabelList(s.subjects))}</span></td>
            <td class="col-term"><span class="cell-ellipsis">${escapeHtml("Term " + Number(s.term || 1))}</span></td>
            <td class="col-academic"><span class="cell-ellipsis">${escapeHtml(s.academicYear || "—")}</span></td>
            <td class="col-contacts"><span class="cell-ellipsis" title="${escapeHtml([s.email, s.phone].filter(Boolean).join(" • ") || "—")}">${escapeHtml([s.email, s.phone].filter(Boolean).join(" • ") || "—")}</span></td>
            <td class="col-status">${statusPill(s.status)}</td>
            <td class="col-hold"><span class="cell-ellipsis" title="${escapeHtml(holdText)}">${escapeHtml(holdText)}</span></td>

            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actResend" type="button" title="Resend Setup"><i class="fa-solid fa-envelope"></i></button>
                <button class="btn-xs actArchive" type="button" title="Archive"><i class="fa-solid fa-box-archive"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `<tr><td colspan="12" style="padding:18px;"><div class="muted">No students found.</div></td></tr>`;

    $("checkAll").checked = STUDENTS.length > 0 && STUDENTS.every((s) => state.selected.has(s.id));
    syncBulkbar();
  }

  function openEditor(prefill) {
    const s = prefill || null;

    $("mTitleBar").textContent = s ? "Edit Student" : "Add Student";
    $("studentForm").action = s ? `/tenant/students/${encodeURIComponent(s.id)}` : "/tenant/students";

    $("mRegNo").value = s ? s.regNo || "" : "";
    $("mFullName").value = s ? s.fullName || "" : "";
    $("mStatus").value = s ? s.status || "active" : "active";
    $("mFirstName").value = s ? s.firstName || "" : "";
    $("mMiddleName").value = s ? s.middleName || "" : "";
    $("mLastName").value = s ? s.lastName || "" : "";
    $("mGender").value = s ? s.gender || "" : "";
    $("mNationality").value = s ? s.nationality || "" : "";
    $("mAddress").value = s ? s.address || "" : "";
    $("mSchoolUnitId").value = s ? s.schoolUnitId || "" : "";
    $("mCampusId").innerHTML = "";
    $("mSchoolLevel").innerHTML = "";
    $("mClassLevel").innerHTML = "";
    $("mClassId").innerHTML = "";
    $("mSection").innerHTML = "";
    $("mTerm").value = s ? String(s.term || 1) : "1";
    $("mAcademicYear").value = s ? s.academicYear || "" : "";
    $("mEmail").value = s ? s.email || "" : "";
    $("mPhone").value = s ? s.phone || "" : "";
    $("mGuardianName").value = s ? s.guardianName || "" : "";
    $("mGuardianPhone").value = s ? s.guardianPhone || "" : "";
    $("mGuardianEmail").value = s ? s.guardianEmail || "" : "";
    $("mHoldType").value = s ? s.holdType || "" : "";
    $("mHoldReason").value = s ? s.holdReason || "" : "";

    syncSelectionWidgets(s);
    $("mCampusId").value = s ? s.campusId || "" : $("mCampusId").value;
    $("mSchoolLevel").value = s ? s.schoolLevel || "" : $("mSchoolLevel").value;
    $("mClassLevel").value = s ? s.classLevel || "" : $("mClassLevel").value;
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mSchoolLevel").value, $("mClassLevel").value, s ? s.classId || "" : "");
    $("mClassId").value = s ? s.classId || "" : "";
    fillSectionOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mSchoolLevel").value, $("mClassId").value, s ? s.section || s.stream || "" : "");
    $("mSection").value = s ? s.section || s.stream || "" : "";
    fillSubjectOptions(s);

    $("holdReasonCount").textContent = `${$("mHoldReason").value.length} / 200`;
    openModal("mEdit");
  }

  function openViewModal(s) {
    if (!s) return;

    state.currentViewId = s.id;
    $("vFullName").textContent = s.fullName || [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ") || "—";
    $("vRegNo").textContent = s.regNo || "—";
    $("vStatus").innerHTML = statusPill(s.status || "active");
    $("vSchoolUnit").textContent = s.schoolUnitName || "—";
    $("vCampus").textContent = s.campusName || "—";
    $("vClassName").textContent = s.className || "—";
    $("vSection").textContent = s.section || s.stream || "—";
    $("vSchoolLevel").textContent = schoolLevelLabel(s.schoolLevel);
    $("vClassLevel").textContent = s.classLevel || "—";
    $("vTerm").textContent = `Term ${Number(s.term || 1)}`;
    $("vAcademicYear").textContent = s.academicYear || "—";
    $("vEmail").textContent = s.email || "—";
    $("vPhone").textContent = s.phone || "—";
    $("vGuardian").textContent = [s.guardianName, s.guardianPhone, s.guardianEmail].filter(Boolean).join(" • ") || "—";
    $("vSubjects").textContent = subjectLabelList(s.subjects);
    $("vHold").textContent = s.holdType ? `${s.holdType}${s.holdReason ? " • " + s.holdReason : ""}` : "—";

    openModal("mView");
  }

  function saveStudent() {
    const schoolLevel = $("mSchoolLevel").value;
    const classLevel = $("mClassLevel").value;
    const missing = [];

    if (!schoolLevel) missing.push("school level");
    if (!classLevel) missing.push("class level");
    if (!$("mSchoolUnitId").value) missing.push("school unit");
    if (!$("mCampusId").value) missing.push("campus");

    if (missing.length) {
      return alert(`Please select ${missing.join(", ")}.`);
    }

    $("studentForm").submit();
  }

  function submitBulk(action, extra = {}) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one student.");

    if (action === "delete" && !window.confirm(`Delete ${ids.length} selected student(s)?`)) return;
    if (action === "archive" && !window.confirm(`Archive ${ids.length} selected student(s)?`)) return;

    $("bulkActionVal").value = action;
    $("bulkStatusVal").value = extra.status || "";
    $("bulkHoldTypeVal").value = extra.holdType || "";
    $("bulkHoldReasonVal").value = extra.holdReason || "";
    $("bulkIdsVal").value = ids.join(",");
    $("bulkForm").submit();
  }

  function updateHoldCounter() {
    $("holdReasonCount").textContent = `${$("mHoldReason").value.length} / 200`;
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickActive").addEventListener("click", function () {
    openEditor();
    $("mStatus").value = "active";
  });

  $("quickHold").addEventListener("click", function () {
    openEditor();
    $("mStatus").value = "on_hold";
  });

  $("btnImport").addEventListener("click", function () {
    openModal("mImport");
  });

  $("quickImport").addEventListener("click", function () {
    openModal("mImport");
  });

  $("btnPrint").addEventListener("click", function () {
    window.print();
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one student.");
    $("bulkbar").classList.add("show");
  });

  $("bulkSetStatus").addEventListener("click", function () {
    const status = prompt("Enter status: active, on_hold, suspended, graduated, archived");
    if (!status) return;
    submitBulk("set_status", { status });
  });

  $("bulkApplyHold").addEventListener("click", function () {
    const holdType = prompt("Enter hold type:");
    if (!holdType) return;
    const holdReason = prompt("Enter hold reason (optional):") || "";
    submitBulk("set_hold", { holdType, holdReason });
  });

  $("bulkClearHold").addEventListener("click", function () {
    submitBulk("clear_hold");
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
    if (e.target.checked) STUDENTS.forEach((s) => state.selected.add(s.id));
    else STUDENTS.forEach((s) => state.selected.delete(s.id));
    renderTable();
  });

  $("tbodyStudents").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyStudents").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const s = STUDENTS.find((x) => x.id === tr.dataset.id);
    if (!s) return;

    if (e.target.closest(".rowCheck") || e.target.closest(".actions") || e.target.closest(".btn-xs")) {
      if (e.target.closest(".actView")) return openViewModal(s);
      if (e.target.closest(".actEdit")) return openEditor(s);

      if (e.target.closest(".actResend")) {
        if (!window.confirm(`Resend setup link for "${s.fullName || s.regNo}"?`)) return;
        return submitRowAction(`/tenant/students/${encodeURIComponent(s.id)}/resend-setup`);
      }

      if (e.target.closest(".actArchive")) {
        if (!window.confirm(`Archive "${s.fullName || s.regNo}"?`)) return;
        return submitRowAction(`/tenant/students/${encodeURIComponent(s.id)}/archive`);
      }

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${s.fullName || s.regNo}"?`)) return;
        return submitRowAction(`/tenant/students/${encodeURIComponent(s.id)}/delete`);
      }

      return;
    }

    openViewModal(s);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const s = STUDENTS.find((x) => x.id === state.currentViewId);
    if (!s) return;
    closeModal("mView");
    openEditor(s);
  });

  $("viewArchiveBtn").addEventListener("click", function () {
    const s = STUDENTS.find((x) => x.id === state.currentViewId);
    if (!s) return;
    if (!window.confirm(`Archive "${s.fullName || s.regNo}"?`)) return;
    submitRowAction(`/tenant/students/${encodeURIComponent(s.id)}/archive`);
  });

  $("viewResendBtn").addEventListener("click", function () {
    const s = STUDENTS.find((x) => x.id === state.currentViewId);
    if (!s) return;
    if (!window.confirm(`Resend setup link for "${s.fullName || s.regNo}"?`)) return;
    submitRowAction(`/tenant/students/${encodeURIComponent(s.id)}/resend-setup`);
  });

  $("saveBtn").addEventListener("click", saveStudent);
  $("mHoldReason").addEventListener("input", updateHoldCounter);

  $("mSchoolUnitId").addEventListener("change", function () {
    fillCampusOptions($("mSchoolUnitId").value, "");
    fillLevelOptions($("mSchoolUnitId").value, "", "");
    fillClassLevelOptions("", "");
    fillClassOptions($("mSchoolUnitId").value, "", "", "", "");
    fillSectionOptions($("mSchoolUnitId").value, "", "", "", "");
    fillSubjectOptions(null);
  });

  $("mCampusId").addEventListener("change", function () {
    fillLevelOptions($("mSchoolUnitId").value, $("mCampusId").value, "");
    fillClassLevelOptions("", "");
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, "", "", "");
    fillSectionOptions($("mSchoolUnitId").value, $("mCampusId").value, "", "", "");
    fillSubjectOptions(null);
  });

  $("mSchoolLevel").addEventListener("change", function () {
    fillClassLevelOptions($("mSchoolLevel").value, "");
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mSchoolLevel").value, "", "");
    fillSectionOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mSchoolLevel").value, "", "");
    fillSubjectOptions(null);
  });

  $("mClassLevel").addEventListener("change", function () {
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mSchoolLevel").value, $("mClassLevel").value, "");
    fillSectionOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mSchoolLevel").value, "", "");
    fillSubjectOptions(null);
  });

  $("mClassId").addEventListener("change", function () {
    applySelectedClass($("mClassId").value);
  });

  $("mTerm").addEventListener("change", function () {
    fillSubjectOptions(null);
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

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      const key = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const pane = document.getElementById("tab-" + key);
      if (pane) pane.classList.add("active");
    });
  });

  renderTable();
  updateHoldCounter();
})();
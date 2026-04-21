(function () {
  const $ = (id) => document.getElementById(id);

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

  const CLASSES = readJson("classesData", []);
  const STRUCTURE = readJson("structureData", []);
  const CLASS_LEVEL_MAP = readJson("classLevelMap", {});
  const SECTIONS = readJson("sectionsData", []);
  const STREAMS = readJson("streamsData", []);
  const DEFAULT_LEVEL_OPTIONS = [
    { type: "nursery", name: "Nursery" },
    { type: "primary", name: "Primary" },
    { type: "secondary", name: "Secondary" },
  ];
  const DEFAULT_CLASS_LEVEL_MAP = {
    nursery: ["BABY", "MIDDLE", "TOP"],
    primary: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"],
    secondary: ["S1", "S2", "S3", "S4", "S5", "S6"],
  };
  if (!$("tbodyClasses")) return;

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
    return '<span class="pill warn"><i class="fa-solid fa-circle-pause"></i> Inactive</span>';
  }

  function schoolLevelLabel(level) {
    const map = { nursery: "Nursery", primary: "Primary", secondary: "Secondary" };
    return map[level] || level || "—";
  }

  function shiftLabel(shift) {
    const map = { day: "Day", boarding: "Boarding", both: "Both" };
    return map[shift] || shift || "—";
  }

  function campusesForUnit(unitId) {
    const unit = STRUCTURE.find((x) => String(x.id) === String(unitId));
    return unit ? (unit.campuses || []) : [];
  }

  function levelsForCampus(unitId, campusId) {
    const campus = campusesForUnit(unitId).find((x) => String(x.id) === String(campusId));
    return campus ? (campus.levels || []) : [];
  }

  function sectionOptions(unitId, campusId, levelType, classLevel) {
    return SECTIONS.filter((section) =>
      (!unitId || String(section.schoolUnitId || "") === String(unitId)) &&
      (!campusId || String(section.campusId || "") === String(campusId)) &&
      (!levelType || String(section.levelType || "") === String(levelType)) &&
      (!classLevel || String(section.classLevel || "").toUpperCase() === String(classLevel || "").toUpperCase())
    );
  }

  function streamOptions(unitId, campusId, levelType, classLevel, sectionId) {
    return STREAMS.filter((stream) =>
      (!unitId || String(stream.schoolUnitId || "") === String(unitId)) &&
      (!campusId || String(stream.campusId || "") === String(campusId)) &&
      (!levelType || String(stream.levelType || "") === String(levelType)) &&
      (!classLevel || String(stream.classLevel || "").toUpperCase() === String(classLevel || "").toUpperCase()) &&
      (!sectionId || !String(stream.sectionId || "") || String(stream.sectionId || "") === String(sectionId))
    );
  }

  function fillCampusOptions(unitId, selected) {
    const options = campusesForUnit(unitId).map((c) => (
      `<option value="${escapeHtml(c.id)}" ${String(selected || "") === String(c.id) ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )).join("");
    $("mCampusId").innerHTML = `<option value="">— Select Campus —</option>${options}`;
  }

  function fillLevelOptions(unitId, campusId, selectedLevelType) {
    const rawLevels = levelsForCampus(unitId, campusId);
    const normalized = rawLevels
      .map((l) => ({
        type: String(l?.type || "").toLowerCase(),
        name: l?.name || schoolLevelLabel(l?.type),
      }))
      .filter((l) => l.type);

    const unique = [];
    const seen = new Set();
    normalized.forEach((l) => {
      if (seen.has(l.type)) return;
      seen.add(l.type);
      unique.push(l);
    });

    const levels = unique.length ? unique : DEFAULT_LEVEL_OPTIONS;
    const preferred = String(selectedLevelType || "").toLowerCase();
    const matchExists = levels.some((l) => String(l.type) === preferred);
    const finalSelected = matchExists ? preferred : "";

    const options = levels.map((l) => (
      `<option value="${escapeHtml(l.type)}" ${String(finalSelected) === String(l.type) ? "selected" : ""}>${escapeHtml(l.name || schoolLevelLabel(l.type))}</option>`
    )).join("");
    $("mLevelType").innerHTML = `<option value="">— Select Level —</option>${options}`;
  }

  function fillClassLevelOptions(levelType, selectedClassLevel) {
    const normalizedType = String(levelType || "").toLowerCase();
    const levels = CLASS_LEVEL_MAP[normalizedType] || DEFAULT_CLASS_LEVEL_MAP[normalizedType] || [];
    const normalizedSelected = String(selectedClassLevel || "").toUpperCase();
    const matchExists = levels.some((item) => String(item) === normalizedSelected);
    const finalSelected = matchExists ? normalizedSelected : "";

    const options = levels.map((item) => (
      `<option value="${escapeHtml(item)}" ${String(finalSelected) === String(item) ? "selected" : ""}>${escapeHtml(item)}</option>`
    )).join("");
    $("mClassLevel").innerHTML = `<option value="">— Select Class Level —</option>${options}`;
  }

  function fillSectionOptions(selectedSectionId) {
    const select = $("mSectionId");
    if (!select) return;

    const unitId = $("mSchoolUnitId").value;
    const campusId = $("mCampusId").value;
    const levelType = $("mLevelType").value;
    const classLevel = $("mClassLevel").value;

    const optionsList = sectionOptions(unitId, campusId, levelType, classLevel);
    const selected = String(selectedSectionId || "");

    const options = optionsList.map((section) => {
      const labelBits = [section.name || "Section"];
      if (section.className) labelBits.push(section.className);
      if (section.classStream) labelBits.push(section.classStream);
      return `<option value="${escapeHtml(section._id || section.id)}" ${String(section._id || section.id) === selected ? "selected" : ""}>${escapeHtml(labelBits.join(" • "))}</option>`;
    }).join("");

    select.innerHTML = `<option value="">— No Section —</option>${options}`;
    $("sectionHint").textContent = optionsList.length
      ? `${optionsList.length} optional section option(s) available.`
      : "No sections found for this placement. You can still save the class without selecting a section.";
  }

  function fillStreamOptions(selectedStreamId) {
    const select = $("mStreamId");
    if (!select) return;

    const unitId = $("mSchoolUnitId").value;
    const campusId = $("mCampusId").value;
    const levelType = $("mLevelType").value;
    const classLevel = $("mClassLevel").value;
    const sectionId = $("mSectionId") ? $("mSectionId").value : "";

    const optionsList = streamOptions(unitId, campusId, levelType, classLevel, sectionId);
    const selected = String(selectedStreamId || "");

    const options = optionsList.map((stream) => {
      const labelBits = [stream.name || "Stream"];
      if (stream.sectionName) labelBits.push(stream.sectionName);
      if (stream.className) labelBits.push(stream.className);
      return `<option value="${escapeHtml(stream._id || stream.id)}" ${String(stream._id || stream.id) === selected ? "selected" : ""}>${escapeHtml(labelBits.join(" • "))}</option>`;
    }).join("");

    select.innerHTML = `<option value="">— No Stream —</option>${options}`;
    $("streamHint").textContent = optionsList.length
      ? `${optionsList.length} optional stream option(s) available.`
      : "No streams found for this placement. You can still save the class without selecting a stream.";
  }

  function renderTable() {
    $("tbodyClasses").innerHTML =
      CLASSES.map((c) => {
        const checked = state.selected.has(c.id) ? "checked" : "";

        return `
          <tr class="row-clickable" data-id="${escapeHtml(c.id)}">
            <td class="col-check"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(c.id)}" ${checked}></td>
            <td class="col-class">
              <div class="class-main">
                <div class="class-title" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
                <div class="class-sub" title="${escapeHtml(c.code || "—")}">${escapeHtml(c.code || "—")}</div>
              </div>
            </td>
            <td class="col-level"><span class="cell-ellipsis">${escapeHtml(schoolLevelLabel(c.levelType))}</span></td>
            <td class="col-classlevel"><span class="cell-ellipsis">${escapeHtml(c.classLevel || "—")}</span></td>
            <td class="col-section"><span class="cell-ellipsis">${escapeHtml(c.sectionName || "—")}</span></td>
            <td class="col-stream"><span class="cell-ellipsis">${escapeHtml(c.streamName || c.stream || "—")}</span></td>
            <td class="col-term"><span class="cell-ellipsis">T${escapeHtml(String(Number(c.term || 1)))}</span></td>
            <td class="col-year"><span class="cell-ellipsis">${escapeHtml(c.academicYear || "—")}</span></td>
            <td class="col-shift"><span class="cell-ellipsis">${escapeHtml(shiftLabel(c.shift))}</span></td>
            <td class="col-capacity"><span class="cell-ellipsis">${escapeHtml(String(c.capacity || 0))} / ${escapeHtml(String(c.enrolledCount || 0))}</span></td>
            <td class="col-teacher"><span class="cell-ellipsis">${escapeHtml(c.classTeacherName || "—")}</span></td>
            <td class="col-status">${statusPill(c.status)}</td>
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
      `<tr><td colspan="13" style="padding:18px;"><div class="muted">No classes found.</div></td></tr>`;

    $("checkAll").checked = CLASSES.length > 0 && CLASSES.every((c) => state.selected.has(c.id));
    syncBulkbar();
  }

  function updateCounters() {
    $("descCount").textContent = `${$("mDescription").value.length} / 1200`;
  }

  function openEditor(prefill) {
    const c = prefill || null;

    $("mTitle").textContent = c ? "Edit Class" : "Add Class";
    $("classForm").action = c ? `/admin/classes/${encodeURIComponent(c.id)}` : "/admin/classes";

    $("mName").value = c ? c.name || "" : "";
    $("mCode").value = c ? c.code || "" : "";
    $("mStatus").value = c ? c.status || "active" : "active";
    $("mSchoolUnitId").value = c ? c.schoolUnitId || "" : "";
    fillCampusOptions($("mSchoolUnitId").value, c ? c.campusId : "");
    fillLevelOptions($("mSchoolUnitId").value, $("mCampusId").value, c ? c.levelType : "");
    fillClassLevelOptions($("mLevelType").value, c ? c.classLevel : "");
    fillSectionOptions(c ? c.sectionId : "");
    fillStreamOptions(c ? c.streamId : "");
    $("mTerm").value = c ? String(c.term ?? 1) : "1";
    $("mAcademicYear").value = c ? c.academicYear || "" : "";
    $("mClassTeacher").value = c ? c.classTeacherId || "" : "";
    $("mShift").value = c ? c.shift || "day" : "day";
    $("mCapacity").value = c ? String(c.capacity || 0) : "";
    $("mEnrolledCount").value = c ? String(c.enrolledCount || 0) : "";
    $("mRoom").value = c ? c.room || "" : "";
    $("mDescription").value = c ? c.description || "" : "";

    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(c) {
    if (!c) return;
    state.currentViewId = c.id;

    $("vName").textContent = c.name || "—";
    $("vCode").textContent = c.code || "—";
    $("vStatus").innerHTML = statusPill(c.status || "active");
    $("vSchoolLevel").textContent = schoolLevelLabel(c.levelType);
    $("vClassLevel").textContent = c.classLevel || "—";
    $("vClassTeacher").textContent = c.classTeacherName || "—";
    $("vAcademicYear").textContent = c.academicYear || "—";
    $("vTerm").textContent = `Term ${Number(c.term || 1)}`;
    $("vSection").textContent = c.sectionName || "—";
    $("vStream").textContent = c.streamName || c.stream || "—";
    $("vShift").textContent = shiftLabel(c.shift);
    $("vCapacity").textContent = `Capacity ${Number(c.capacity || 0)} • Enrolled ${Number(c.enrolledCount || 0)}`;
    $("vRoomCampus").textContent = `${c.room || "—"} • ${c.campusName || "—"}`;
    $("vDescription").textContent = c.description || "—";

    openModal("mView");
  }

  function saveClass() {
    const name = $("mName").value.trim();
    if (!name) return alert("Class name is required.");

    const missing = [];
    if (!$("mSchoolUnitId").value) missing.push("school unit");
    if (!$("mCampusId").value) missing.push("campus");
    if (!$("mLevelType").value) missing.push("level");
    if (!$("mClassLevel").value) missing.push("class level");
    if (missing.length) {
      return alert(`Please select: ${missing.join(", ")}.`);
    }

    $("classForm").submit();
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

  function exportClasses() {
    const rows = [[
      "Name", "Code", "SchoolUnit", "Campus", "LevelType", "ClassLevel", "Section", "Stream", "Term",
      "AcademicYear", "ClassTeacher", "Shift", "Capacity", "EnrolledCount", "Room", "Status", "Description"
    ]].concat(CLASSES.map((c) => ([
      c.name || "",
      c.code || "",
      c.schoolUnitName || "",
      c.campusName || "",
      c.levelType || "",
      c.classLevel || "",
      c.sectionName || "",
      c.streamName || c.stream || "",
      c.term || 1,
      c.academicYear || "",
      c.classTeacherName || "",
      c.shift || "",
      c.capacity || 0,
      c.enrolledCount || 0,
      c.room || "",
      c.status || "",
      c.description || "",
    ])));

    downloadCsv("classes-export.csv", rows);
  }

  function submitBulk(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one class.");
    if (action === "delete" && !window.confirm(`Delete ${ids.length} selected class(es) permanently?`)) return;
    if (action === "archive" && !window.confirm(`Archive ${ids.length} selected class(es)?`)) return;
    $("bulkActionField").value = action;
    $("bulkIdsField").value = ids.join(",");
    $("bulkForm").submit();
  }

  function updateStatusCurrent(nextStatus) {
    const c = CLASSES.find((x) => x.id === state.currentViewId);
    if (!c) return;
    if (!window.confirm(`Set "${c.name}" to ${nextStatus}?`)) return;
    submitRowAction(`/admin/classes/${encodeURIComponent(c.id)}/status`, nextStatus);
  }

  $("btnCreate").addEventListener("click", function () { openEditor(); });
  $("quickNursery").addEventListener("click", function () {
    openEditor();
    $("mLevelType").value = "nursery";
    fillClassLevelOptions("nursery", "BABY");
    fillSectionOptions("");
    fillStreamOptions("");
  });
  $("quickPrimary").addEventListener("click", function () {
    openEditor();
    $("mLevelType").value = "primary";
    fillClassLevelOptions("primary", "P1");
    fillSectionOptions("");
    fillStreamOptions("");
  });
  $("quickSecondary").addEventListener("click", function () {
    openEditor();
    $("mLevelType").value = "secondary";
    fillClassLevelOptions("secondary", "S1");
    fillSectionOptions("");
    fillStreamOptions("");
  });

  $("mSchoolUnitId").addEventListener("change", function () {
    fillCampusOptions($("mSchoolUnitId").value, "");
    fillLevelOptions($("mSchoolUnitId").value, "", "");
    fillClassLevelOptions("", "");
    fillSectionOptions("");
    fillStreamOptions("");
  });
  $("mCampusId").addEventListener("change", function () {
    fillLevelOptions($("mSchoolUnitId").value, $("mCampusId").value, "");
    fillClassLevelOptions("", "");
    fillSectionOptions("");
    fillStreamOptions("");
  });
  $("mLevelType").addEventListener("change", function () {
    fillClassLevelOptions($("mLevelType").value, "");
    fillSectionOptions("");
    fillStreamOptions("");
  });
  $("mClassLevel").addEventListener("change", function () {
    fillSectionOptions("");
    fillStreamOptions("");
  });
  $("mSectionId").addEventListener("change", function () {
    fillStreamOptions("");
  });

  $("btnExport").addEventListener("click", exportClasses);
  $("btnPrint").addEventListener("click", function () { window.print(); });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one class.");
    $("bulkbar").classList.add("show");
  });
  $("bulkActivate").addEventListener("click", function () { submitBulk("activate"); });
  $("bulkDeactivate").addEventListener("click", function () { submitBulk("deactivate"); });
  $("bulkArchive").addEventListener("click", function () { submitBulk("archive"); });
  $("bulkDelete").addEventListener("click", function () { submitBulk("delete"); });
  $("bulkClear").addEventListener("click", function () { state.selected.clear(); renderTable(); });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) CLASSES.forEach((c) => state.selected.add(c.id));
    else CLASSES.forEach((c) => state.selected.delete(c.id));
    renderTable();
  });

  $("tbodyClasses").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyClasses").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const c = CLASSES.find((x) => x.id === tr.dataset.id);
    if (!c) return;

    if (e.target.closest(".rowCheck") || e.target.closest(".actions") || e.target.closest(".btn-xs")) {
      if (e.target.closest(".actView")) return openViewModal(c);
      if (e.target.closest(".actEdit")) return openEditor(c);

      if (e.target.closest(".actStatus")) {
        const next = c.status === "active" ? "inactive" : "active";
        if (!window.confirm(`Change "${c.name}" to ${next}?`)) return;
        return submitRowAction(`/admin/classes/${encodeURIComponent(c.id)}/status`, next);
      }

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${c.name}" permanently?`)) return;
        return submitRowAction(`/admin/classes/${encodeURIComponent(c.id)}/delete`);
      }
      return;
    }

    openViewModal(c);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const c = CLASSES.find((x) => x.id === state.currentViewId);
    if (!c) return;
    closeModal("mView");
    openEditor(c);
  });

  $("viewActivateBtn").addEventListener("click", function () { updateStatusCurrent("active"); });
  $("viewInactiveBtn").addEventListener("click", function () { updateStatusCurrent("inactive"); });
  $("viewArchiveBtn").addEventListener("click", function () { updateStatusCurrent("archived"); });

  $("saveBtn").addEventListener("click", saveClass);
  $("mDescription").addEventListener("input", updateCounters);

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

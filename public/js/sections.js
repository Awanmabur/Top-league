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

  const SECTIONS = readJson("sectionsData", []);
  const CLASSES = readJson("classesData", []);
  const STREAMS = readJson("streamsData", []);
  const STRUCTURE = readJson("structureData", []);
  if (!$("tbodySections")) return;

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
    form.action = actionUrl;
    $("rowStatusField").value = status || "";
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

  function schoolLevelLabel(v) {
    const map = { nursery: "Nursery", primary: "Primary", secondary: "Secondary" };
    return map[v] || v || "—";
  }

  function campusesForUnit(unitId) {
    const unit = STRUCTURE.find((x) => String(x.id) === String(unitId));
    return unit ? (unit.campuses || []) : [];
  }

  function classOptions(unitId, campusId, levelType) {
    return CLASSES.filter((c) =>
      (!unitId || String(c.schoolUnitId) === String(unitId)) &&
      (!campusId || String(c.campusId) === String(campusId)) &&
      (!levelType || String(c.levelType) === String(levelType))
    );
  }

  function streamOptions(unitId, campusId, levelType, classId) {
    return STREAMS.filter((s) =>
      (!unitId || String(s.schoolUnitId) === String(unitId)) &&
      (!campusId || String(s.campusId) === String(campusId)) &&
      (!levelType || String(s.levelType) === String(levelType)) &&
      (!classId || String(s.classId || "") === String(classId))
    );
  }

  function fillCampusOptions(unitId, selected) {
    const html = campusesForUnit(unitId).map((c) => (
      `<option value="${escapeHtml(c.id)}" ${String(selected || "") === String(c.id) ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )).join("");
    $("mCampusId").innerHTML = `<option value="">— Select Campus —</option>${html}`;
  }

  function fillClassOptions(unitId, campusId, levelType, selected) {
    const html = classOptions(unitId, campusId, levelType).map((c) => (
      `<option value="${escapeHtml(c.id)}" ${String(selected || "") === String(c.id) ? "selected" : ""}>${escapeHtml(c.name || c.classLevel || "Class")} • ${escapeHtml(c.stream || "A")} • ${escapeHtml(c.academicYear || "")}</option>`
    )).join("");
    $("mClassId").innerHTML = `<option value="">— Select Class —</option>${html}`;
  }

  function fillStreamOptions(unitId, campusId, levelType, classId, selected) {
    const html = streamOptions(unitId, campusId, levelType, classId).map((s) => (
      `<option value="${escapeHtml(s.id)}" ${String(selected || "") === String(s.id) ? "selected" : ""}>${escapeHtml(s.name || s.code || "Stream")}${s.className ? " • " + escapeHtml(s.className) : ""}</option>`
    )).join("");
    $("mStreamId").innerHTML = `<option value="">— No Stream —</option>${html}`;
  }

  function renderTable() {
    $("tbodySections").innerHTML =
      SECTIONS.map((s) => {
        const checked = state.selected.has(s.id) ? "checked" : "";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(s.id)}">
            <td class="col-check"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(s.id)}" ${checked}></td>
            <td class="col-section"><div class="section-main"><div class="section-title">${escapeHtml(s.name)}</div><div class="section-sub">${escapeHtml(s.code || "—")}</div></div></td>
            <td class="col-level">${escapeHtml(schoolLevelLabel(s.levelType))}</td>
            <td class="col-class">${escapeHtml(s.className || "—")}</td>
            <td class="col-stream">${escapeHtml(s.streamName || "—")}</td>
            <td class="col-teacher">${escapeHtml(s.teacherName || "—")}</td>
            <td class="col-capacity">${escapeHtml(String(s.capacity || 0))} / ${escapeHtml(String(s.enrolledCount || 0))}</td>
            <td class="col-room">${escapeHtml(s.room || "—")}</td>
            <td class="col-status">${statusPill(s.status)}</td>
            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actStatus" type="button"><i class="fa-solid fa-rotate"></i></button>
                <button class="btn-xs actDelete" type="button"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") || `<tr><td colspan="10" style="padding:18px;"><div class="muted">No sections found.</div></td></tr>`;

    $("checkAll").checked = SECTIONS.length > 0 && SECTIONS.every((s) => state.selected.has(s.id));
    syncBulkbar();
  }

  function updateCounters() {
    $("notesCount").textContent = `${$("mNotes").value.length} / 1200`;
  }

  function openEditor(prefill) {
    const s = prefill || null;
    $("mTitleBar").textContent = s ? "Edit Section" : "Add Section";
    $("sectionForm").action = s ? `/admin/sections/${encodeURIComponent(s.id)}` : "/admin/sections";

    $("mName").value = s ? s.name || "" : "";
    $("mCode").value = s ? s.code || "" : "";
    $("mStatus").value = s ? s.status || "active" : "active";
    $("mSchoolUnitId").value = s ? s.schoolUnitId || "" : "";
    fillCampusOptions($("mSchoolUnitId").value, s ? s.campusId : "");
    $("mLevelType").value = s ? s.levelType || "" : "";
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mLevelType").value, s ? s.classId : "");
    fillStreamOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mLevelType").value, $("mClassId").value, s ? s.streamId : "");
    $("mClassTeacher").value = s ? s.teacherId || "" : "";
    $("mCapacity").value = s ? String(s.capacity || 0) : "";
    $("mEnrolledCount").value = s ? String(s.enrolledCount || 0) : "";
    $("mRoom").value = s ? s.room || "" : "";
    $("mNotes").value = s ? s.notes || "" : "";

    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(s) {
    if (!s) return;
    state.currentViewId = s.id;
    $("vName").textContent = s.name || "—";
    $("vCode").textContent = s.code || "—";
    $("vStatus").innerHTML = statusPill(s.status || "active");
    $("vLevel").textContent = schoolLevelLabel(s.levelType);
    $("vClass").textContent = s.className || "—";
    $("vStream").textContent = s.streamName || "—";
    $("vTeacher").textContent = s.teacherName || "—";
    $("vCapacity").textContent = `Capacity ${Number(s.capacity || 0)} • Enrolled ${Number(s.enrolledCount || 0)}`;
    $("vRoom").textContent = s.room || "—";
    $("vNotes").textContent = s.notes || "—";
    openModal("mView");
  }

  function saveSection() {
    if (!$("mName").value.trim()) return alert("Section name is required.");
    if (!$("mClassId").value) return alert("Select a class.");
    $("sectionForm").submit();
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

  function exportSections() {
    const rows = [[
      "Name", "Code", "SchoolUnit", "Campus", "LevelType", "Class", "Stream", "Teacher", "Capacity", "EnrolledCount", "Room", "Status", "Notes"
    ]].concat(SECTIONS.map((s) => ([
      s.name || "",
      s.code || "",
      s.schoolUnitName || "",
      s.campusName || "",
      s.levelType || "",
      s.className || "",
      s.streamName || "",
      s.teacherName || "",
      s.capacity || 0,
      s.enrolledCount || 0,
      s.room || "",
      s.status || "",
      s.notes || "",
    ])));
    downloadCsv("sections-export.csv", rows);
  }

  function submitBulk(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one section.");
    if (action === "delete" && !window.confirm(`Delete ${ids.length} selected section(s) permanently?`)) return;
    if (action === "archive" && !window.confirm(`Archive ${ids.length} selected section(s)?`)) return;
    $("bulkActionField").value = action;
    $("bulkIdsField").value = ids.join(",");
    $("bulkForm").submit();
  }

  function updateStatusCurrent(nextStatus) {
    const s = SECTIONS.find((x) => x.id === state.currentViewId);
    if (!s) return;
    if (!window.confirm(`Set "${s.name}" to ${nextStatus}?`)) return;
    submitRowAction(`/admin/sections/${encodeURIComponent(s.id)}/status`, nextStatus);
  }

  $("mSchoolUnitId").addEventListener("change", function () {
    fillCampusOptions($("mSchoolUnitId").value, "");
    fillClassOptions($("mSchoolUnitId").value, "", "", "");
    fillStreamOptions($("mSchoolUnitId").value, "", "", "", "");
  });
  $("mCampusId").addEventListener("change", function () {
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mLevelType").value, "");
    fillStreamOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mLevelType").value, "", "");
  });
  $("mLevelType").addEventListener("change", function () {
    fillClassOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mLevelType").value, "");
    fillStreamOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mLevelType").value, "", "");
  });
  $("mClassId").addEventListener("change", function () {
    fillStreamOptions($("mSchoolUnitId").value, $("mCampusId").value, $("mLevelType").value, $("mClassId").value, "");
  });

  $("btnCreate").addEventListener("click", function () { openEditor(); });
  $("quickA").addEventListener("click", function () { openEditor(); $("mName").value = "A"; });
  $("quickB").addEventListener("click", function () { openEditor(); $("mName").value = "B"; });
  $("quickEast").addEventListener("click", function () { openEditor(); $("mName").value = "East"; });

  $("btnExport").addEventListener("click", exportSections);
  $("btnPrint").addEventListener("click", function () { window.print(); });
  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one section.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate").addEventListener("click", function () { submitBulk("activate"); });
  $("bulkDeactivate").addEventListener("click", function () { submitBulk("deactivate"); });
  $("bulkArchive").addEventListener("click", function () { submitBulk("archive"); });
  $("bulkDelete").addEventListener("click", function () { submitBulk("delete"); });
  $("bulkClear").addEventListener("click", function () { state.selected.clear(); renderTable(); });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) SECTIONS.forEach((s) => state.selected.add(s.id));
    else SECTIONS.forEach((s) => state.selected.delete(s.id));
    renderTable();
  });

  $("tbodySections").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodySections").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const s = SECTIONS.find((x) => x.id === tr.dataset.id);
    if (!s) return;

    if (e.target.closest(".rowCheck") || e.target.closest(".actions") || e.target.closest(".btn-xs")) {
      if (e.target.closest(".actView")) return openViewModal(s);
      if (e.target.closest(".actEdit")) return openEditor(s);
      if (e.target.closest(".actStatus")) {
        const next = s.status === "active" ? "inactive" : "active";
        if (!window.confirm(`Change "${s.name}" to ${next}?`)) return;
        return submitRowAction(`/admin/sections/${encodeURIComponent(s.id)}/status`, next);
      }
      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${s.name}" permanently?`)) return;
        return submitRowAction(`/admin/sections/${encodeURIComponent(s.id)}/delete`);
      }
      return;
    }
    openViewModal(s);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const s = SECTIONS.find((x) => x.id === state.currentViewId);
    if (!s) return;
    closeModal("mView");
    openEditor(s);
  });
  $("viewActivateBtn").addEventListener("click", function () { updateStatusCurrent("active"); });
  $("viewInactiveBtn").addEventListener("click", function () { updateStatusCurrent("inactive"); });
  $("viewArchiveBtn").addEventListener("click", function () { updateStatusCurrent("archived"); });

  $("saveBtn").addEventListener("click", saveSection);
  $("mNotes").addEventListener("input", updateCounters);

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () { closeModal(btn.dataset.closeModal); });
  });
  ["mEdit", "mView"].forEach(function (mid) {
    const el = $(mid);
    if (!el) return;
    el.addEventListener("click", function (e) { if (e.target.id === mid) closeModal(mid); });
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

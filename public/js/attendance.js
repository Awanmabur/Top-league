(function () {
  const $ = (id) => document.getElementById(id);

  function readAttendanceData() {
    const el = $("attendanceData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse attendance data:", err);
      return [];
    }
  }

  const RECORDS = readAttendanceData();
  if (!$("tbodyAttendance")) return;

  const state = {
    selected: new Set(),
    currentViewId: null,
    saveAndNew: false,
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

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function statusPill(status) {
    if (status === "present") {
      return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Present</span>';
    }
    if (status === "absent") {
      return '<span class="pill bad"><i class="fa-solid fa-circle-xmark"></i> Absent</span>';
    }
    if (status === "late") {
      return '<span class="pill warn"><i class="fa-solid fa-clock"></i> Late</span>';
    }
    return '<span class="pill info"><i class="fa-solid fa-notes-medical"></i> Excused</span>';
  }

  function nowLocalDateTimeValue() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return [
      d.getFullYear(),
      "-",
      pad(d.getMonth() + 1),
      "-",
      pad(d.getDate()),
      "T",
      pad(d.getHours()),
      ":",
      pad(d.getMinutes()),
    ].join("");
  }

  function renderTable() {
    $("tbodyAttendance").innerHTML =
      RECORDS.map((r) => {
        const checked = state.selected.has(r.id) ? "checked" : "";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(r.id)}">
            <td class="col-check">
              <input type="checkbox" class="rowCheck" data-id="${escapeHtml(r.id)}" ${checked}>
            </td>

            <td class="col-student">
              <div class="student-main">
                <div class="student-title" title="${escapeHtml(r.studentName || "—")}">${escapeHtml(r.studentName || "—")}</div>
                <div class="student-sub" title="${escapeHtml(r.email || "—")}">${escapeHtml(r.email || "—")}</div>
              </div>
            </td>

            <td class="col-reg">
              <span class="cell-ellipsis" title="${escapeHtml(r.regNo || "—")}">${escapeHtml(r.regNo || "—")}</span>
            </td>

            <td class="col-class">
              <span class="cell-ellipsis" title="${escapeHtml(r.className || "—")}">${escapeHtml(r.className || "—")}</span>
            </td>

            <td class="col-section">
              <span class="cell-ellipsis" title="${escapeHtml(r.sectionName || "Whole Class")}">${escapeHtml(r.sectionName || "Whole Class")}</span>
            </td>

            <td class="col-stream">
              <span class="cell-ellipsis" title="${escapeHtml(r.streamName || "All Streams")}">${escapeHtml(r.streamName || "All Streams")}</span>
            </td>

            <td class="col-subject">
              <span class="cell-ellipsis" title="${escapeHtml(r.subjectName || "—")}">${escapeHtml(r.subjectName || "—")}</span>
            </td>

            <td class="col-session">
              <span class="cell-ellipsis" title="${escapeHtml(r.sessionAtLabel || "—")}">${escapeHtml(r.sessionAtLabel || "—")}</span>
            </td>

            <td class="col-status">
              ${statusPill(r.status)}
            </td>

            <td class="col-notes">
              <span class="cell-ellipsis" title="${escapeHtml(r.notes || "—")}">${escapeHtml(r.notes || "—")}</span>
            </td>

            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actPresent" type="button" title="Present"><i class="fa-solid fa-circle-check"></i></button>
                <button class="btn-xs actAbsent" type="button" title="Absent"><i class="fa-solid fa-circle-xmark"></i></button>
                <button class="btn-xs actLate" type="button" title="Late"><i class="fa-solid fa-clock"></i></button>
                <button class="btn-xs actExcused" type="button" title="Excused"><i class="fa-solid fa-notes-medical"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
      <tr>
        <td colspan="11" style="padding:18px;">
          <div class="muted">No attendance records found.</div>
        </td>
      </tr>
      `;

    $("checkAll").checked = RECORDS.length > 0 && RECORDS.every((r) => state.selected.has(r.id));
    syncBulkbar();
  }

  function updateCounters() {
    $("notesCount").textContent = `${$("mNotes").value.length} / 500`;
  }

  function fillHiddenStatusForm(r, status) {
    $("hsClassGroup").value = r.classGroupId || "";
    $("hsSection").value = r.sectionId || "";
    $("hsStream").value = r.streamId || "";
    $("hsSubject").value = r.subjectId || "";
    $("hsTeacher").value = r.teacherId || "";
    $("hsStudent").value = r.studentId || "";
    $("hsRegNo").value = r.regNo || "";
    $("hsAcademicYear").value = r.academicYear || "";
    $("hsTerm").value = r.term || "1";
    $("hsSessionAt").value = r.sessionAt || "";
    $("hsStatus").value = status || r.status || "present";
    $("hsNotes").value = r.notes || "";
  }

  function submitQuickStatus(r, status) {
    if (!r) return;
    if (!window.confirm(`Set "${r.studentName}" to ${status}?`)) return;

    fillHiddenStatusForm(r, status);
    const form = $("rowActionForm");
    form.action = `/tenant/attendance/${encodeURIComponent(r.id)}`;
    form.submit();
  }

  function deleteRecord(r) {
    if (!r) return;
    if (!window.confirm(`Delete attendance for "${r.studentName}"?`)) return;
    const form = $("deleteForm");
    form.action = `/tenant/attendance/${encodeURIComponent(r.id)}/delete`;
    form.submit();
  }

  function openEditor(prefill) {
    const r = prefill || null;

    $("mTitle").textContent = r ? "Edit Attendance" : "Mark Attendance";
    $("attendanceForm").action = r ? `/tenant/attendance/${encodeURIComponent(r.id)}` : "/tenant/attendance";

    $("mStudent").value = r ? r.studentId || "" : "";
    $("mRegNo").value = r ? r.regNo || "" : "";
    $("mClassGroup").value = r ? r.classGroupId || "" : "";
    $("mSection").value = r ? r.sectionId || "" : "";
    $("mStream").value = r ? r.streamId || "" : "";
    $("mSubject").value = r ? r.subjectId || "" : "";
    $("mTeacher").value = r ? r.teacherId || "" : "";
    $("mAcademicYear").value = r ? r.academicYear || "" : "";
    $("mTerm").value = r ? String(r.term || 1) : "1";
    $("mSessionAt").value = r ? r.sessionAt || "" : nowLocalDateTimeValue();
    $("mStatus").value = r ? r.status || "present" : "present";
    $("mNotes").value = r ? r.notes || "" : "";

    window.AcademicSelector?.refresh(document);
    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(r) {
    if (!r) return;
    state.currentViewId = r.id;
    $("vSection").textContent = r.sectionName || "Whole Class";
    $("vStream").textContent = r.streamName || "All Streams";

    $("vStudent").textContent = r.studentName || "—";
    $("vRegNo").textContent = r.regNo || "—";
    $("vEmail").textContent = r.email || "—";
    $("vClassGroup").textContent = r.className || "—";
    $("vSubject").textContent = r.subjectName || "—";
    $("vTeacher").textContent = r.teacherName || "—";
    $("vAcademic").textContent = `${r.academicYear || "—"} • Term ${r.term || 1}`;
    $("vSession").textContent = r.sessionAtLabel || "—";
    $("vStatus").innerHTML = statusPill(r.status || "present");
    $("vNotes").textContent = r.notes || "—";

    openModal("mView");
  }

  function saveAttendance(saveAndNew) {
    const student = $("mStudent").value.trim();
    const regNo = $("mRegNo").value.trim();
    const subject = $("mSubject").value.trim();
    const sessionAt = $("mSessionAt").value.trim();

    if (!student && !regNo) return alert("Select student or enter Reg No.");
    if (!subject) return alert("Subject is required.");
    if (!sessionAt) return alert("Session date/time is required.");

    state.saveAndNew = !!saveAndNew;

    const old = $("saveAndNewMarker");
    if (old) old.remove();

    if (state.saveAndNew) {
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "_saveAndNew";
      hidden.value = "1";
      hidden.id = "saveAndNewMarker";
      $("attendanceForm").appendChild(hidden);
    }

    $("attendanceForm").submit();
  }

  function runBulk(action, status) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one record.");

    const msg = action === "delete"
      ? `Delete ${ids.length} selected record(s)?`
      : `Apply "${status}" to ${ids.length} selected record(s)?`;

    if (!window.confirm(msg)) return;

    $("bulkActionValue").value = action;
    $("bulkStatusValue").value = status || "";
    $("bulkIds").value = ids.join(",");
    $("bulkForm").submit();
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickPresent").addEventListener("click", function () {
    openEditor();
    $("mStatus").value = "present";
  });

  $("quickAbsent").addEventListener("click", function () {
    openEditor();
    $("mStatus").value = "absent";
  });

  $("btnImport").addEventListener("click", function () {
    openModal("mImport");
  });

  $("btnPrint").addEventListener("click", function () {
    window.print();
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one record.");
    $("bulkbar").classList.add("show");
  });

  $("bulkPresent").addEventListener("click", function () {
    runBulk("set_status", "present");
  });

  $("bulkAbsent").addEventListener("click", function () {
    runBulk("set_status", "absent");
  });

  $("bulkLate").addEventListener("click", function () {
    runBulk("set_status", "late");
  });

  $("bulkExcused").addEventListener("click", function () {
    runBulk("set_status", "excused");
  });

  $("bulkDelete").addEventListener("click", function () {
    runBulk("delete", "");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    renderTable();
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) RECORDS.forEach((r) => state.selected.add(r.id));
    else RECORDS.forEach((r) => state.selected.delete(r.id));
    renderTable();
  });

  $("tbodyAttendance").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyAttendance").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const r = RECORDS.find((x) => x.id === tr.dataset.id);
    if (!r) return;

    if (
      e.target.closest(".rowCheck") ||
      e.target.closest(".actions") ||
      e.target.closest(".btn-xs")
    ) {
      if (e.target.closest(".actPresent")) return submitQuickStatus(r, "present");
      if (e.target.closest(".actAbsent")) return submitQuickStatus(r, "absent");
      if (e.target.closest(".actLate")) return submitQuickStatus(r, "late");
      if (e.target.closest(".actExcused")) return submitQuickStatus(r, "excused");
      if (e.target.closest(".actEdit")) return openEditor(r);
      if (e.target.closest(".actDelete")) return deleteRecord(r);
      return;
    }

    openViewModal(r);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const r = RECORDS.find((x) => x.id === state.currentViewId);
    if (!r) return;
    closeModal("mView");
    openEditor(r);
  });

  $("viewPresentBtn").addEventListener("click", function () {
    const r = RECORDS.find((x) => x.id === state.currentViewId);
    submitQuickStatus(r, "present");
  });

  $("viewAbsentBtn").addEventListener("click", function () {
    const r = RECORDS.find((x) => x.id === state.currentViewId);
    submitQuickStatus(r, "absent");
  });

  $("viewLateBtn").addEventListener("click", function () {
    const r = RECORDS.find((x) => x.id === state.currentViewId);
    submitQuickStatus(r, "late");
  });

  $("viewExcusedBtn").addEventListener("click", function () {
    const r = RECORDS.find((x) => x.id === state.currentViewId);
    submitQuickStatus(r, "excused");
  });

  $("saveBtn").addEventListener("click", function () {
    saveAttendance(false);
  });

  $("btnSaveAndNew").addEventListener("click", function () {
    saveAttendance(true);
  });

  $("mNotes").addEventListener("input", updateCounters);

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

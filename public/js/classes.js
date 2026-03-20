(function () {
  const $ = (id) => document.getElementById(id);

  function readClassesData() {
    const el = $("classesData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse classes data:", err);
      return [];
    }
  }

  const CLASSES = readClassesData();
  if (!$("tbodyClasses")) return;

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
    return '<span class="pill warn"><i class="fa-solid fa-circle-pause"></i> Inactive</span>';
  }

  function modeLabel(mode) {
    const map = {
      day: "Day",
      evening: "Evening",
      weekend: "Weekend",
      online: "Online",
    };
    return map[mode] || mode || "—";
  }

  function renderTable() {
    $("tbodyClasses").innerHTML =
      CLASSES.map((c) => {
        const checked = state.selected.has(c.id) ? "checked" : "";
        const yss = `Y${Number(c.yearOfStudy || 1)} / S${Number(c.semester || 1)} / ${c.section || "A"}`;

        return `
          <tr class="row-clickable" data-id="${escapeHtml(c.id)}">
            <td class="col-check">
              <input type="checkbox" class="rowCheck" data-id="${escapeHtml(c.id)}" ${checked}>
            </td>

            <td class="col-class">
              <div class="class-main">
                <div class="class-title" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
                <div class="class-sub" title="${escapeHtml(c.code || "—")}">${escapeHtml(c.code || "—")}</div>
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

            <td class="col-academic">
              <span class="cell-ellipsis" title="${escapeHtml(c.academicYear || "—")}">
                ${escapeHtml(c.academicYear || "—")}
              </span>
            </td>

            <td class="col-yss">
              <span class="cell-ellipsis" title="${escapeHtml(yss)}">${escapeHtml(yss)}</span>
            </td>

            <td class="col-mode">
              <span class="cell-ellipsis">${escapeHtml(modeLabel(c.studyMode))}</span>
            </td>

            <td class="col-capacity">
              <span class="cell-ellipsis">${escapeHtml(String(c.capacity || 0))} / ${escapeHtml(String(c.enrolledCount || 0))}</span>
            </td>

            <td class="col-advisor">
              <span class="cell-ellipsis" title="${escapeHtml(c.advisorName || "—")}">
                ${escapeHtml(c.advisorName || "—")}
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
        <td colspan="11" style="padding:18px;">
          <div class="muted">No classes found.</div>
        </td>
      </tr>
      `;

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
    $("mProgram").value = c ? c.programId || "" : "";
    $("mDepartment").value = c ? c.departmentId || "" : "";
    $("mAdvisor").value = c ? c.advisorId || "" : "";
    $("mAcademicYear").value = c ? c.academicYear || "" : "";
    $("mIntake").value = c ? c.intake || "" : "";
    $("mStudyMode").value = c ? c.studyMode || "day" : "day";
    $("mYearOfStudy").value = c ? String(c.yearOfStudy ?? 1) : "1";
    $("mSemester").value = c ? String(c.semester ?? 1) : "1";
    $("mSection").value = c ? c.section || "A" : "A";
    $("mCapacity").value = c ? String(c.capacity || 0) : "";
    $("mEnrolledCount").value = c ? String(c.enrolledCount || 0) : "";
    $("mMeetingRoom").value = c ? c.meetingRoom || "" : "";
    $("mCampus").value = c ? c.campus || "" : "";
    $("mDescription").value = c ? c.description || "" : "";

    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(c) {
    if (!c) return;

    state.currentViewId = c.id;

    $("vName").textContent = c.name || "—";
    $("vCode").textContent = c.code || "—";
    $("vProgram").textContent = c.programName || "—";
    $("vDepartment").textContent = c.departmentName || "—";
    $("vAdvisor").textContent = c.advisorName || "—";
    $("vAcademicYear").textContent = c.academicYear || "—";
    $("vIntake").textContent = c.intake || "—";
    $("vStudyMode").textContent = modeLabel(c.studyMode);
    $("vYSS").textContent = `Year ${Number(c.yearOfStudy || 1)} • Semester ${Number(c.semester || 1)} • Section ${c.section || "A"}`;
    $("vCapacity").textContent = `Capacity ${Number(c.capacity || 0)} • Enrolled ${Number(c.enrolledCount || 0)}`;
    $("vRoomCampus").textContent = `${c.meetingRoom || "—"} • ${c.campus || "—"}`;
    $("vStatus").innerHTML = statusPill(c.status || "active");
    $("vDescription").textContent = c.description || "—";

    openModal("mView");
  }

  function saveClass() {
    const name = $("mName").value.trim();
    if (!name) return alert("Class name is required.");
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
    const rows = [
      [
        "Name",
        "Code",
        "Program",
        "Department",
        "Advisor",
        "AcademicYear",
        "Intake",
        "StudyMode",
        "YearOfStudy",
        "Semester",
        "Section",
        "Capacity",
        "EnrolledCount",
        "MeetingRoom",
        "Campus",
        "Status",
        "Description"
      ],
      ...CLASSES.map((c) => [
        c.name || "",
        c.code || "",
        c.programName || "",
        c.departmentName || "",
        c.advisorName || "",
        c.academicYear || "",
        c.intake || "",
        c.studyMode || "",
        c.yearOfStudy || 1,
        c.semester || 1,
        c.section || "",
        c.capacity || 0,
        c.enrolledCount || 0,
        c.meetingRoom || "",
        c.campus || "",
        c.status || "",
        c.description || "",
      ]),
    ];

    downloadCsv("classes-export.csv", rows);
  }

  function submitBulk(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one class.");

    if (action === "delete" && !window.confirm(`Delete ${ids.length} selected class(es) permanently?`)) {
      return;
    }

    if (action === "archive" && !window.confirm(`Archive ${ids.length} selected class(es)?`)) {
      return;
    }

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

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickDay").addEventListener("click", function () {
    openEditor();
    $("mStudyMode").value = "day";
  });

  $("quickEvening").addEventListener("click", function () {
    openEditor();
    $("mStudyMode").value = "evening";
  });

  $("quickWeekend").addEventListener("click", function () {
    openEditor();
    $("mStudyMode").value = "weekend";
  });

  $("btnExport").addEventListener("click", exportClasses);
  $("btnPrint").addEventListener("click", function () {
    window.print();
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one class.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate").addEventListener("click", function () {
    submitBulk("activate");
  });

  $("bulkDeactivate").addEventListener("click", function () {
    submitBulk("deactivate");
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

    if (
      e.target.closest(".rowCheck") ||
      e.target.closest(".actions") ||
      e.target.closest(".btn-xs")
    ) {
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

  $("viewActivateBtn").addEventListener("click", function () {
    updateStatusCurrent("active");
  });

  $("viewDeactivateBtn").addEventListener("click", function () {
    updateStatusCurrent("inactive");
  });

  $("viewArchiveBtn").addEventListener("click", function () {
    updateStatusCurrent("archived");
  });

  $("saveBtn").addEventListener("click", saveClass);
  $("mDescription").addEventListener("input", updateCounters);

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
(function () {
  const $ = (id) => document.getElementById(id);

  function readStudentsData() {
    const el = $("studentsData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse students data:", err);
      return [];
    }
  }

  const STUDENTS = readStudentsData();
  if (!$("tbodyStudents")) return;

  const state = {
    selected: new Set(),
    currentViewId: null,
    currentTab: "basic",
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
    if (!document.querySelector(".modal-backdrop.show")) {
      document.body.style.overflow = "";
    }
  }

  function statusPill(status) {
    if (status === "active") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>';
    if (status === "on_hold") return '<span class="pill warn"><i class="fa-solid fa-ban"></i> On Hold</span>';
    if (status === "suspended") return '<span class="pill bad"><i class="fa-solid fa-triangle-exclamation"></i> Suspended</span>';
    if (status === "graduated") return '<span class="pill info"><i class="fa-solid fa-user-graduate"></i> Graduated</span>';
    return '<span class="pill arch"><i class="fa-solid fa-box-archive"></i> Archived</span>';
  }

  function submitRowAction(actionUrl) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    form.submit();
  }

  function submitBulk(action, extra) {
    const ids = Array.from(state.selected);
    if (!ids.length) return window.alert("Select at least one student.");

    $("bulkActionVal").value = action;
    $("bulkStatusVal").value = extra?.status || "";
    $("bulkHoldTypeVal").value = extra?.holdType || "";
    $("bulkHoldReasonVal").value = extra?.holdReason || "";
    $("bulkIdsVal").value = ids.join(",");
    $("bulkForm").submit();
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function setTab(tabName) {
    state.currentTab = tabName;
    document.querySelectorAll(".tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabName));
    document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === `tab-${tabName}`));
  }

  function updateCounters() {
    const hold = $("mHoldReason");
    if (hold && $("holdReasonCount")) {
      $("holdReasonCount").textContent = `${hold.value.length} / 200`;
    }
  }

  function renderTable() {
    $("tbodyStudents").innerHTML = STUDENTS.map((s) => {
      const checked = state.selected.has(s.id) ? "checked" : "";
      const holdText = [s.holdType || "", s.holdReason || ""].filter(Boolean).join(" — ") || "—";
      return `
        <tr class="row-clickable" data-id="${escapeHtml(s.id)}">
          <td class="col-check"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(s.id)}" ${checked}></td>
          <td class="col-student">
            <div class="student-main">
              <div class="student-title" title="${escapeHtml(s.fullName || '—')}">${escapeHtml(s.fullName || "—")}</div>
              <div class="student-sub" title="${escapeHtml(s.regNo || '—')}">${escapeHtml(s.regNo || "—")}</div>
            </div>
          </td>
          <td class="col-program"><span class="cell-ellipsis" title="${escapeHtml(s.programName || '—')}">${escapeHtml(s.programName || "—")}</span></td>
          <td class="col-class"><span class="cell-ellipsis" title="${escapeHtml(s.className || '—')}">${escapeHtml(s.className || "—")}</span></td>
          <td class="col-year"><span class="cell-ellipsis">${escapeHtml(s.yearLevel || "—")}</span></td>
          <td class="col-academic"><span class="cell-ellipsis">${escapeHtml(s.academicYear || "—")} / Sem ${escapeHtml(String(s.semester || 1))}</span></td>
          <td class="col-contacts"><span class="cell-ellipsis" title="${escapeHtml([s.email || '', s.phone || ''].filter(Boolean).join(' • ') || '—')}">${escapeHtml([s.email || '', s.phone || ''].filter(Boolean).join(' • ') || '—')}</span></td>
          <td class="col-status">${statusPill(s.status)}</td>
          <td class="col-hold"><span class="cell-ellipsis" title="${escapeHtml(holdText)}">${escapeHtml(holdText)}</span></td>
          <td class="col-actions">
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-xs actArchive" type="button" title="Archive"><i class="fa-solid fa-box-archive"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || `
      <tr>
        <td colspan="10" style="padding:18px;"><div class="muted">No students found.</div></td>
      </tr>
    `;

    $("checkAll").checked = STUDENTS.length > 0 && STUDENTS.every((s) => state.selected.has(s.id));
    syncBulkbar();
  }

  function openEditor(prefill) {
    const s = prefill || null;
    $("mTitle").textContent = s ? "Edit Student" : "Add Student";
    $("studentForm").action = s ? `/admin/students/${encodeURIComponent(s.id)}` : "/admin/students";

    $("mRegNo").value = s ? s.regNo || "" : "";
    $("mFullName").value = s ? s.fullName || "" : "";
    $("mFirstName").value = s ? s.firstName || "" : "";
    $("mMiddleName").value = s ? s.middleName || "" : "";
    $("mLastName").value = s ? s.lastName || "" : "";
    $("mStatus").value = s ? s.status || "active" : "active";
    $("mGender").value = s ? s.gender || "" : "";
    $("mNationality").value = s ? s.nationality || "" : "";
    $("mAddress").value = s ? s.address || "" : "";
    $("mProgram").value = s ? s.programId || "" : "";
    $("mClassGroup").value = s ? s.classId || "" : "";
    $("mYearLevel").value = s ? s.yearLevel || "" : "";
    $("mAcademicYear").value = s ? s.academicYear || "" : "";
    $("mSemester").value = s ? String(s.semester || 1) : "1";
    $("mEmail").value = s ? s.email || "" : "";
    $("mPhone").value = s ? s.phone || "" : "";
    $("mGuardianName").value = s ? s.guardianName || "" : "";
    $("mGuardianPhone").value = s ? s.guardianPhone || "" : "";
    $("mGuardianEmail").value = s ? s.guardianEmail || "" : "";
    $("mHoldType").value = s ? s.holdType || "" : "";
    $("mHoldReason").value = s ? s.holdReason || "" : "";

    setTab("basic");
    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(s) {
    if (!s) return;
    state.currentViewId = s.id;
    $("vFullName").textContent = s.fullName || "—";
    $("vRegNo").textContent = s.regNo || "—";
    $("vProgram").textContent = s.programName || "—";
    $("vClass").textContent = s.className || "—";
    $("vYear").textContent = s.yearLevel || "—";
    $("vAcademicYear").textContent = s.academicYear || "—";
    $("vSemester").textContent = `Semester ${Number(s.semester || 1)}`;
    $("vEmail").textContent = s.email || "—";
    $("vPhone").textContent = s.phone || "—";
    $("vGuardian").textContent = [s.guardianName || "", s.guardianPhone || ""].filter(Boolean).join(" • ") || "—";
    $("vGuardianEmail").textContent = s.guardianEmail || "—";
    $("vStatus").innerHTML = statusPill(s.status || "active");
    $("vHold").textContent = [s.holdType || "", s.holdReason || ""].filter(Boolean).join(" — ") || "—";
    openModal("mView");
  }

  function saveStudent() {
    const regNo = $("mRegNo").value.trim();
    const program = $("mProgram").value.trim();
    const classGroup = $("mClassGroup").value.trim();

    if (!regNo) return window.alert("Registration number is required.");
    if (!program) return window.alert("Program is required.");
    if (!classGroup) return window.alert("Class is required.");

    $("studentForm").submit();
  }

  $("btnCreate").addEventListener("click", () => openEditor());
  $("quickActive").addEventListener("click", () => { openEditor(); $("mStatus").value = "active"; });
  $("quickHold").addEventListener("click", () => { openEditor(); $("mStatus").value = "on_hold"; setTab("holds"); });
  $("btnImport").addEventListener("click", () => openModal("mImport"));
  $("quickImport").addEventListener("click", () => openModal("mImport"));
  $("btnPrint").addEventListener("click", () => window.print());
  $("btnBulk").addEventListener("click", () => {
    if (!state.selected.size) return window.alert("Select at least one student.");
    $("bulkbar").classList.add("show");
  });

  $("bulkSetStatus").addEventListener("click", () => {
    const status = window.prompt("Enter status: active, on_hold, suspended, graduated, archived", "active");
    if (!status) return;
    submitBulk("set_status", { status: status.trim() });
  });

  $("bulkApplyHold").addEventListener("click", () => {
    const holdType = window.prompt("Hold type (e.g. Fees Hold, Exam Hold):", "");
    if (!holdType) return;
    const holdReason = window.prompt("Hold reason (optional):", "") || "";
    submitBulk("set_hold", { holdType: holdType.trim(), holdReason: holdReason.trim() });
  });

  $("bulkClearHold").addEventListener("click", () => submitBulk("clear_hold", {}));
  $("bulkArchive").addEventListener("click", () => {
    if (!window.confirm(`Archive ${state.selected.size} selected student(s)?`)) return;
    submitBulk("archive", {});
  });
  $("bulkDelete").addEventListener("click", () => {
    if (!window.confirm(`Delete ${state.selected.size} selected student(s)?`)) return;
    submitBulk("delete", {});
  });
  $("bulkClear").addEventListener("click", () => { state.selected.clear(); renderTable(); });

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
      if (e.target.closest(".actArchive")) {
        if (!window.confirm(`Archive "${s.fullName || s.regNo}"?`)) return;
        return submitRowAction(`/admin/students/${encodeURIComponent(s.id)}/archive`);
      }
      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${s.fullName || s.regNo}" permanently from active records?`)) return;
        return submitRowAction(`/admin/students/${encodeURIComponent(s.id)}/delete`);
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

  $("saveBtn").addEventListener("click", saveStudent);
  $("mHoldReason").addEventListener("input", updateCounters);

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
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
(function () {
  const $ = (id) => document.getElementById(id);

  function readExamsData() {
    const el = $("examsData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse exams data:", err);
      return [];
    }
  }

  const EXAMS = readExamsData();
  if (!$("tbodyExams")) return;

  const state = {
    selected: new Set(),
    currentViewId: null,
  };

  function makeEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
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
    const normalized = String(status || "draft").toLowerCase();
    const classes = normalized === "scheduled" ? "pill ok"
      : normalized === "completed" ? "pill info"
      : normalized === "archived" ? "pill bad"
      : "pill warn";
    const label = normalized === "scheduled" ? "Scheduled"
      : normalized === "completed" ? "Completed"
      : normalized === "archived" ? "Archived"
      : "Draft";
    return makeEl("span", classes, label);
  }

  function formatDateTime(v) {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString();
  }

  function textCell(className, text) {
    const td = makeEl("td", className);
    td.appendChild(makeEl("span", "cell-ellipsis", text));
    return td;
  }

  function renderTable() {
    const tbody = $("tbodyExams");
    tbody.replaceChildren();

    if (!EXAMS.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 11;
      td.style.padding = "18px";
      td.appendChild(makeEl("div", "muted", "No exams found."));
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      EXAMS.forEach((e) => {
        const tr = makeEl("tr", "row-clickable");
        tr.dataset.id = String(e.id || "");

        const checkTd = makeEl("td", "col-check");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "rowCheck";
        checkbox.dataset.id = String(e.id || "");
        checkbox.checked = state.selected.has(e.id);
        checkTd.appendChild(checkbox);
        tr.appendChild(checkTd);

        const titleTd = makeEl("td", "col-title");
        const main = makeEl("div", "exam-main");
        main.appendChild(makeEl("div", "exam-title", e.title || "-"));
        main.appendChild(makeEl("div", "exam-sub", e.code || "-"));
        titleTd.appendChild(main);
        tr.appendChild(titleTd);

        tr.appendChild(textCell("col-class", e.className || "-"));
        tr.appendChild(textCell("col-section", e.sectionName || "Whole Class"));
        tr.appendChild(textCell("col-stream", e.streamName || "All Streams"));
        tr.appendChild(textCell("col-subject", e.subjectName || "-"));
        tr.appendChild(textCell("col-type", e.examType || "-"));
        tr.appendChild(textCell("col-date", e.examDateLabel || "-"));
        tr.appendChild(textCell("col-marks", `${Number(e.maxMarks || 0)} / ${Number(e.passMark || 0)}`));

        const statusTd = makeEl("td", "col-status");
        statusTd.appendChild(statusPill(e.status));
        tr.appendChild(statusTd);

        const actionsTd = makeEl("td", "col-actions");
        const actions = makeEl("div", "actions");
        [["actView", "View"], ["actEdit", "Edit"], ["actDelete", "Delete"]].forEach(([cls, label]) => {
          const button = makeEl("button", `btn-xs ${cls}`, label);
          button.type = "button";
          actions.appendChild(button);
        });
        actionsTd.appendChild(actions);
        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
      });
    }

    $("checkAll").checked = EXAMS.length > 0 && EXAMS.every((e) => state.selected.has(e.id));
    syncBulkbar();
  }

  function updateCounters() {
    $("instructionsCount").textContent = `${$("mInstructions").value.length} / 3000`;
  }

  function openEditor(prefill) {
    const e = prefill || null;

    $("mTitleBar").textContent = e ? "Edit Exam" : "Add Exam";
    $("examForm").action = e ? `/admin/exams/${encodeURIComponent(e.id)}` : "/admin/exams";

    $("mTitle").value = e ? e.title || "" : "";
    $("mCode").value = e ? e.code || "" : "";
    $("mClassGroup").value = e ? e.classGroupId || "" : "";
    window.AcademicSelector?.refresh(document);
    $("mSection").value = e ? e.sectionId || "" : "";
    window.AcademicSelector?.refresh(document);
    $("mStream").value = e ? e.streamId || "" : "";
    window.AcademicSelector?.refresh(document);
    $("mSubject").value = e ? e.subjectId || "" : "";
    $("mTeacher").value = e ? e.teacherId || "" : "";
    $("mAcademicYear").value = e ? e.academicYear || "" : "";
    $("mTerm").value = e ? String(e.term || 1) : "1";
    $("mExamType").value = e ? e.examType || "test" : "test";
    $("mExamDate").value = e ? e.examDateInput || "" : "";
    $("mStartTime").value = e ? e.startTime || "" : "";
    $("mEndTime").value = e ? e.endTime || "" : "";
    $("mDurationMinutes").value = e ? String(e.durationMinutes || 0) : "";
    $("mMaxMarks").value = e ? String(e.maxMarks || 100) : "100";
    $("mPassMark").value = e ? String(e.passMark || 50) : "50";
    $("mRoom").value = e ? e.room || "" : "";
    $("mCampus").value = e ? e.campus || "" : "";
    $("mStatus").value = e ? e.status || "draft" : "draft";
    $("mInstructions").value = e ? e.instructions || "" : "";

    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(e) {
    if (!e) return;
    state.currentViewId = e.id;

    $("vTitle").textContent = e.title || "-";
    $("vCode").textContent = e.code || "-";
    $("vClassGroup").textContent = e.className || "-";
    $("vSection").textContent = e.sectionName || "Whole Class";
    $("vStream").textContent = e.streamName || "All Streams";
    $("vSubject").textContent = e.subjectName || "-";
    $("vTeacher").textContent = e.teacherName || "-";
    $("vAcademic").textContent = `${e.academicYear || "-"}  -  Term ${e.term || 1}`;
    $("vType").textContent = e.examType || "-";
    $("vExamDate").textContent = e.examDateLabel || "-";
    $("vTime").textContent = [e.startTime || "", e.endTime || ""].filter(Boolean).join(" - ") || "-";
    $("vDuration").textContent = e.durationMinutes ? `${e.durationMinutes} minutes` : "-";
    $("vMarks").textContent = `${e.maxMarks || 0} max / ${e.passMark || 0} pass`;
    $("vRoom").textContent = e.room || "-";
    $("vCampus").textContent = e.campus || "-";
    $("vStatus").replaceChildren(statusPill(e.status || "draft"));
    $("vInstructions").textContent = e.instructions || "-";

    openModal("mView");
  }

  function deleteExam(e) {
    if (!e) return;
    if (!window.confirm(`Delete "${e.title}"?`)) return;
    const form = $("deleteForm");
    form.action = `/admin/exams/${encodeURIComponent(e.id)}/delete`;
    form.submit();
  }

  function saveExam() {
    if (!$("mTitle").value.trim()) return alert("Exam title is required.");
    if (!$("mClassGroup").value.trim()) return alert("Class is required.");
    if (!$("mSubject").value.trim()) return alert("Subject is required.");
    if (!$("mExamDate").value.trim()) return alert("Exam date is required.");
    $("examForm").submit();
  }

  function runBulk(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one exam.");
    if (action === "delete" && !window.confirm(`Delete ${ids.length} exam(s)?`)) return;

    $("bulkAction").value = action;
    $("bulkIds").value = ids.join(",");
    $("bulkForm").submit();
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickTest").addEventListener("click", function () {
    openEditor();
    $("mExamType").value = "test";
  });

  $("quickEndterm").addEventListener("click", function () {
    openEditor();
    $("mExamType").value = "endterm";
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one exam.");
    $("bulkbar").classList.add("show");
  });

  $("bulkDraft").addEventListener("click", function () { runBulk("draft"); });
  $("bulkScheduled").addEventListener("click", function () { runBulk("scheduled"); });
  $("bulkCompleted").addEventListener("click", function () { runBulk("completed"); });
  $("bulkArchived").addEventListener("click", function () { runBulk("archived"); });
  $("bulkDelete").addEventListener("click", function () { runBulk("delete"); });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    renderTable();
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) EXAMS.forEach((x) => state.selected.add(x.id));
    else EXAMS.forEach((x) => state.selected.delete(x.id));
    renderTable();
  });

  $("tbodyExams").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyExams").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const item = EXAMS.find((x) => x.id === tr.dataset.id);
    if (!item) return;

    if (
      e.target.closest(".rowCheck") ||
      e.target.closest(".actions") ||
      e.target.closest(".btn-xs")
    ) {
      if (e.target.closest(".actView")) return openViewModal(item);
      if (e.target.closest(".actEdit")) return openEditor(item);
      if (e.target.closest(".actDelete")) return deleteExam(item);
      return;
    }

    openViewModal(item);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const item = EXAMS.find((x) => x.id === state.currentViewId);
    if (!item) return;
    closeModal("mView");
    openEditor(item);
  });

  $("saveBtn").addEventListener("click", saveExam);
  $("mInstructions").addEventListener("input", updateCounters);

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

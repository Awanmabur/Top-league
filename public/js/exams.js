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
    if (status === "scheduled") return '<span class="pill ok">Scheduled</span>';
    if (status === "completed") return '<span class="pill info">Completed</span>';
    if (status === "archived") return '<span class="pill bad">Archived</span>';
    return '<span class="pill warn">Draft</span>';
  }

  function formatDateTime(v) {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString();
  }

  function renderTable() {
    $("tbodyExams").innerHTML =
      EXAMS.map((e) => {
        const checked = state.selected.has(e.id) ? "checked" : "";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(e.id)}">
            <td class="col-check"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(e.id)}" ${checked}></td>
            <td class="col-title">
              <div class="exam-main">
                <div class="exam-title">${escapeHtml(e.title || "-")}</div>
                <div class="exam-sub">${escapeHtml(e.code || "-")}</div>
              </div>
            </td>
            <td class="col-class"><span class="cell-ellipsis">${escapeHtml(e.className || "-")}</span></td>
            <td class="col-section"><span class="cell-ellipsis">${escapeHtml(e.sectionName || "Whole Class")}</span></td>
            <td class="col-stream"><span class="cell-ellipsis">${escapeHtml(e.streamName || "All Streams")}</span></td>
            <td class="col-subject"><span class="cell-ellipsis">${escapeHtml(e.subjectName || "-")}</span></td>
            <td class="col-type"><span class="cell-ellipsis">${escapeHtml(e.examType || "-")}</span></td>
            <td class="col-date"><span class="cell-ellipsis">${escapeHtml(e.examDateLabel || "-")}</span></td>
            <td class="col-marks"><span class="cell-ellipsis">${escapeHtml(String(e.maxMarks || 0))} / ${escapeHtml(String(e.passMark || 0))}</span></td>
            <td class="col-status">${statusPill(e.status)}</td>
            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button">View</button>
                <button class="btn-xs actEdit" type="button">Edit</button>
                <button class="btn-xs actDelete" type="button">Delete</button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
      <tr>
        <td colspan="11" style="padding:18px;">
          <div class="muted">No exams found.</div>
        </td>
      </tr>
      `;

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
    $("vStatus").innerHTML = statusPill(e.status || "draft");
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

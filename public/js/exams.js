(function () {
  const $ = (id) => document.getElementById(id);

  function readJsonScript(id) {
    const el = $(id);
    if (!el) return [];
    try {
      return JSON.parse(el.textContent || "[]");
    } catch (err) {
      console.error("Failed to parse JSON data:", err);
      return [];
    }
  }

  const EXAMS = readJsonScript("examsData");
  if (!$("tbodyExams")) return;

  const state = {
    selected: new Set(),
    currentViewId: null,
    calendarDate: new Date(),
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
    if (!document.querySelector(".modal-backdrop.show")) document.body.style.overflow = "";
  }

  function submitRowAction(actionUrl, statusValue) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    const statusEl = $("rowStatusValue");
    if (statusEl) statusEl.value = statusValue || "";
    form.submit();
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString();
  }

  function statusPill(status) {
    if (status === "completed") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Completed</span>';
    if (status === "ongoing") return '<span class="pill warn"><i class="fa-solid fa-clock"></i> Ongoing</span>';
    if (status === "archived") return '<span class="pill bad"><i class="fa-solid fa-box-archive"></i> Archived</span>';
    return '<span class="pill info"><i class="fa-solid fa-calendar-check"></i> Scheduled</span>';
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function renderTable() {
    $("tbodyExams").innerHTML =
      EXAMS.map((x) => {
        const checked = state.selected.has(x.id) ? "checked" : "";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(x.id)}">
            <td class="col-check no-print"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(x.id)}" ${checked}></td>
            <td class="col-exam">
              <div class="exam-main">
                <div class="exam-title" title="${escapeHtml(x.title)}">${escapeHtml(x.title)}</div>
                <div class="exam-sub" title="${escapeHtml(x.examType)}">${escapeHtml(x.examType)} • ${escapeHtml(x.academicYear || "—")}</div>
              </div>
            </td>
            <td class="col-course"><span class="cell-ellipsis" title="${escapeHtml((x.courseCode || "") + " — " + (x.courseTitle || ""))}">${escapeHtml(x.courseCode || "—")} ${x.courseTitle ? "— " + escapeHtml(x.courseTitle) : ""}</span></td>
            <td class="col-class"><span class="cell-ellipsis">${escapeHtml(x.className || "—")}</span></td>
            <td class="col-program"><span class="cell-ellipsis">${escapeHtml(x.programName || "—")}</span></td>
            <td class="col-date"><span class="cell-ellipsis">${escapeHtml(x.date || "—")}</span></td>
            <td class="col-time"><span class="cell-ellipsis">${escapeHtml((x.startTime || "—") + " - " + (x.endTime || "—"))}</span></td>
            <td class="col-room"><span class="cell-ellipsis">${escapeHtml(x.room || "—")}${x.campus ? " / " + escapeHtml(x.campus) : ""}</span></td>
            <td class="col-invigilator"><span class="cell-ellipsis">${escapeHtml(x.invigilatorName || "—")}</span></td>
            <td class="col-status">${statusPill(x.status)}</td>
            <td class="col-actions no-print">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actStatus" type="button" title="Status"><i class="fa-solid fa-arrows-rotate"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") || `
        <tr><td colspan="11" style="padding:18px;"><div class="muted">No exams found.</div></td></tr>
      `;

    $("checkAll").checked = EXAMS.length > 0 && EXAMS.every((x) => state.selected.has(x.id));
    syncBulkbar();
  }

  function addPaperRow(paper) {
    const wrap = $("papersWrap");
    if (!wrap) return;
    const row = document.createElement("div");
    row.className = "paperrow";
    row.setAttribute("data-paper-row", "1");
    row.innerHTML = `
      <div class="field"><input class="input" name="papers_name[]" maxlength="60" value="${escapeHtml(paper?.name || "")}" placeholder="Paper name"></div>
      <div class="field"><input class="input" name="papers_marks[]" type="number" min="0" max="100000" value="${Number(paper?.marks || 0)}"></div>
      <div class="field"><input class="input" name="papers_duration[]" type="number" min="0" max="1440" value="${Number(paper?.durationMinutes || 0)}"></div>
      <div><button class="btn-xs removePaperBtn" type="button"><i class="fa-solid fa-xmark"></i></button></div>
    `;
    wrap.appendChild(row);
  }

  function clearPaperRows() {
    document.querySelectorAll("[data-paper-row='1']").forEach((el) => el.remove());
  }

  function guessDuration(startTime, endTime) {
    const m1 = toMinutes(startTime);
    const m2 = toMinutes(endTime);
    if (m1 === null || m2 === null || m2 <= m1) return 120;
    return m2 - m1;
  }

  function toMinutes(hhmm) {
    const m = String(hhmm || "").trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function openEditor(prefill) {
    const x = prefill || null;
    $("mTitleLabel").textContent = x ? "Edit Exam" : "Schedule Exam";
    $("examForm").action = x ? `/admin/exams/${encodeURIComponent(x.id)}` : "/admin/exams";
    $("mExamTitle").value = x ? x.title || "" : "";
    $("mExamType").value = x ? x.examType || "final" : "final";
    $("mStatus").value = x ? x.status || "scheduled" : "scheduled";
    $("mClass").value = x ? x.classId || "" : "";
    $("mCourse").value = x ? x.courseId || "" : "";
    $("mProgram").value = x ? x.programId || "" : "";
    $("mDate").value = x ? x.date || "" : "";
    $("mStart").value = x ? x.startTime || "09:00" : "09:00";
    $("mEnd").value = x ? x.endTime || "12:00" : "12:00";
    $("mRoom").value = x ? x.room || "" : "";
    $("mCampus").value = x ? x.campus || "" : "";
    $("mInvigilator").value = x ? x.invigilatorId || "" : "";
    $("mAcademicYear").value = x ? x.academicYear || "" : "";
    $("mSemester").value = x ? String(x.semester || 1) : "1";
    $("mDurationMinutes").value = x ? String(x.durationMinutes || guessDuration(x.startTime, x.endTime)) : "120";
    $("mTotalMarks").value = x ? String(x.totalMarks || 100) : "100";
    $("mPassMark").value = x ? String(x.passMark || 50) : "50";
    $("mInstructions").value = x ? x.instructions || "" : "";

    clearPaperRows();
    (Array.isArray(x?.papers) ? x.papers : []).forEach(addPaperRow);

    openModal("mEdit");
  }

  function openViewModal(x) {
    if (!x) return;
    state.currentViewId = x.id;
    $("vTitle").textContent = x.title || "—";
    $("vType").textContent = x.examType || "—";
    $("vStatus").innerHTML = statusPill(x.status || "scheduled");
    $("vCourse").textContent = `${x.courseCode || "—"}${x.courseTitle ? " — " + x.courseTitle : ""}`;
    $("vClass").textContent = x.className || "—";
    $("vProgram").textContent = x.programName || "—";
    $("vDate").textContent = x.date || "—";
    $("vTime").textContent = `${x.startTime || "—"} - ${x.endTime || "—"}`;
    $("vRoom").textContent = `${x.room || "—"}${x.campus ? " / " + x.campus : ""}`;
    $("vInvigilator").textContent = x.invigilatorName || "—";
    $("vAcademicYear").textContent = x.academicYear || "—";
    $("vSemester").textContent = String(x.semester || "—");
    $("vMarks").textContent = `Total ${formatMoney(x.totalMarks || 0)} / Pass ${formatMoney(x.passMark || 0)}`;
    $("vDuration").textContent = `${Number(x.durationMinutes || 0)} minute(s)`;
    $("vInstructions").textContent = x.instructions || "—";

    const host = $("vPapers");
    host.innerHTML = "";
    const papers = Array.isArray(x.papers) ? x.papers : [];
    if (!papers.length) {
      host.innerHTML = '<span class="muted">No papers</span>';
    } else {
      papers.forEach((p) => {
        const span = document.createElement("span");
        span.className = "tag";
        span.innerHTML = `<i class="fa-solid fa-file-lines"></i> ${escapeHtml(p.name || "Paper")} • ${escapeHtml(String(p.marks || 0))} marks • ${escapeHtml(String(p.durationMinutes || 0))} min`;
        host.appendChild(span);
      });
    }

    openModal("mView");
  }

  function saveExam() {
    const title = $("mExamTitle").value.trim();
    const classId = $("mClass").value.trim();
    const courseId = $("mCourse").value.trim();
    const date = $("mDate").value.trim();
    const startTime = $("mStart").value.trim();
    const endTime = $("mEnd").value.trim();

    if (!title || title.length < 2) return alert("Exam title is required.");
    if (!classId) return alert("Class is required.");
    if (!courseId) return alert("Course is required.");
    if (!date) return alert("Date is required.");
    if (toMinutes(startTime) === null || toMinutes(endTime) === null) return alert("Valid start and end times are required.");
    if (toMinutes(endTime) <= toMinutes(startTime)) return alert("End time must be later than start time.");

    $("examForm").submit();
  }

  function exportCsv() {
    window.location.href = "/admin/exams/export";
  }

  function renderCalendar() {
    const grid = $("calendarGrid");
    if (!grid) return;

    const monthDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), 1);
    const month = monthDate.getMonth();
    $("calTitle").textContent = monthDate.toLocaleString(undefined, { month: "long", year: "numeric" });

    const start = new Date(monthDate);
    const weekday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - weekday);

    const grouped = new Map();
    EXAMS.forEach((x) => {
      if (!x.date) return;
      if (!grouped.has(x.date)) grouped.set(x.date, []);
      grouped.get(x.date).push(x);
    });

    const heads = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => `<div class="calhead">${d}</div>`).join("");
    const cells = [];

    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const exams = grouped.get(iso) || [];
      const pills = exams.slice(0, 3).map((x) => `<button type="button" class="cal-pill" data-pick-id="${escapeHtml(x.id)}">${escapeHtml(x.courseCode || x.title)}</button>`).join("");
      const more = exams.length > 3 ? `<div class="muted">+${exams.length - 3} more</div>` : "";

      cells.push(`
        <div class="daycell ${d.getMonth() !== month ? "muted" : ""}">
          <div class="daytop"><span>${d.getDate()}</span><span>${exams.length || ""}</span></div>
          ${pills}${more}
        </div>
      `);
    }

    grid.innerHTML = heads + cells.join("");
  }

  $("btnCreate")?.addEventListener("click", () => openEditor());
  $("quickFinal")?.addEventListener("click", () => { openEditor(); $("mExamType").value = "final"; });
  $("quickMidterm")?.addEventListener("click", () => { openEditor(); $("mExamType").value = "midterm"; });
  $("quickPractical")?.addEventListener("click", () => { openEditor(); $("mExamType").value = "practical"; });
  $("btnExport")?.addEventListener("click", exportCsv);
  $("btnImport")?.addEventListener("click", () => openModal("mImport"));
  $("btnPrint")?.addEventListener("click", () => window.print());
  $("btnCalendar")?.addEventListener("click", () => document.getElementById("calendarGrid")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  $("calPrev")?.addEventListener("click", () => { state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1); renderCalendar(); });
  $("calToday")?.addEventListener("click", () => { state.calendarDate = new Date(); renderCalendar(); });
  $("calNext")?.addEventListener("click", () => { state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1); renderCalendar(); });

  $("btnBulk")?.addEventListener("click", () => {
    if (!state.selected.size) return alert("Select at least one exam.");
    $("bulkbar").classList.add("show");
  });

  $("bulkArchive")?.addEventListener("click", () => {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one exam.");
    if (!window.confirm(`Archive ${ids.length} selected exam(s)?`)) return;
    $("bulkActionValue").value = "archive";
    $("bulkIds").value = ids.join(",");
    $("bulkForm").submit();
  });

  $("bulkDelete")?.addEventListener("click", () => {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one exam.");
    if (!window.confirm(`Delete ${ids.length} selected exam(s)? This cannot be undone.`)) return;
    $("bulkActionValue").value = "delete";
    $("bulkIds").value = ids.join(",");
    $("bulkForm").submit();
  });

  $("bulkClear")?.addEventListener("click", () => {
    state.selected.clear();
    renderTable();
  });

  $("checkAll")?.addEventListener("change", (e) => {
    if (e.target.checked) EXAMS.forEach((x) => state.selected.add(x.id));
    else EXAMS.forEach((x) => state.selected.delete(x.id));
    renderTable();
  });

  $("tbodyExams")?.addEventListener("change", (e) => {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyExams")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const x = EXAMS.find((item) => item.id === tr.dataset.id);
    if (!x) return;

    if (e.target.closest(".rowCheck") || e.target.closest(".actions") || e.target.closest(".btn-xs")) {
      if (e.target.closest(".actView")) return openViewModal(x);
      if (e.target.closest(".actEdit")) return openEditor(x);
      if (e.target.closest(".actStatus")) {
        const next = window.prompt("Set status: scheduled, ongoing, completed, archived", x.status || "scheduled");
        if (!next) return;
        return submitRowAction(`/admin/exams/${encodeURIComponent(x.id)}/status`, next);
      }
      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${x.title}" permanently?`)) return;
        return submitRowAction(`/admin/exams/${encodeURIComponent(x.id)}/delete`);
      }
      return;
    }

    openViewModal(x);
  });

  $("viewEditBtn")?.addEventListener("click", () => {
    const x = EXAMS.find((item) => item.id === state.currentViewId);
    if (!x) return;
    closeModal("mView");
    openEditor(x);
  });

  $("addPaperRow")?.addEventListener("click", () => addPaperRow());
  $("papersWrap")?.addEventListener("click", (e) => {
    if (!e.target.closest(".removePaperBtn")) return;
    e.target.closest("[data-paper-row='1']")?.remove();
  });

  $("saveBtn")?.addEventListener("click", saveExam);

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  ["mEdit", "mView", "mImport"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("click", (e) => {
      if (e.target.id === id) closeModal(id);
    });
  });

  $("calendarGrid")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pick-id]");
    if (!btn) return;
    const x = EXAMS.find((item) => item.id === btn.dataset.pickId);
    if (!x) return;
    openViewModal(x);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show"));
      document.body.style.overflow = "";
    }
  });

  renderTable();
  renderCalendar();
})();
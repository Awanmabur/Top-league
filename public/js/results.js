(() => {
  const $ = (id) => document.getElementById(id);

  function readJson(id, fallback = []) {
    const el = $(id);
    if (!el) return fallback;
    try { return JSON.parse(el.value || JSON.stringify(fallback)); }
    catch (err) { console.error(`Failed to parse ${id}:`, err); return fallback; }
  }

  const RESULTS = readJson("resultsData", []);
  if (!$("tbodyResults")) return;

  const state = { selected: new Set(), currentId: RESULTS[0]?.id || null, currentExamMeta: null };

  function findResult(id) { return RESULTS.find((x) => String(x.id) === String(id)) || null; }
  function text(tag, value, className = "") {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = String(value ?? "");
    return el;
  }
  function icon(classes) {
    const el = document.createElement("i");
    el.className = classes;
    return el;
  }
  function actionButton(kind, iconClass, title, disabled = false) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn-xs ${kind}`;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.disabled = !!disabled;
    btn.appendChild(icon(iconClass));
    return btn;
  }
  function statusPill(status) {
    const span = document.createElement("span");
    const published = status === "published";
    span.className = `pill ${published ? "ok" : "warn"}`;
    span.appendChild(icon(published ? "fa-solid fa-eye" : "fa-solid fa-pen-to-square"));
    span.appendChild(document.createTextNode(published ? " Published" : " Draft"));
    return span;
  }
  function setStatusPill(id, status) {
    const el = $(id);
    if (!el) return;
    el.replaceChildren(statusPill(status));
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
  function defaultGrading(percentage) {
    const p = Math.max(0, Math.min(Number(percentage || 0), 100));
    if (p >= 80) return { grade: "A", remark: "Excellent" };
    if (p >= 75) return { grade: "A-", remark: "Very Good" };
    if (p >= 70) return { grade: "B+", remark: "Very Good" };
    if (p >= 65) return { grade: "B", remark: "Good" };
    if (p >= 60) return { grade: "B-", remark: "Good" };
    if (p >= 55) return { grade: "C+", remark: "Satisfactory" };
    if (p >= 50) return { grade: "C", remark: "Satisfactory" };
    if (p >= 45) return { grade: "C-", remark: "Pass" };
    if (p >= 40) return { grade: "D", remark: "Pass" };
    return { grade: "F", remark: "Fail" };
  }
  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }
  function renderPreview(item) {
    $("pvStudent").textContent = item?.studentName || "—";
    $("pvRegNo").textContent = item?.regNo ? `Reg No: ${item.regNo}` : "—";
    $("pvExam").textContent = item?.examTitle || "—";
    $("pvMeta").textContent = item ? `${item.academicYear || "—"} • Term ${item.term || 1}` : "—";
    $("pvClass").textContent = item?.className || "—";
    if ($("pvSection")) $("pvSection").textContent = item?.sectionName || "—";
    if ($("pvStream")) $("pvStream").textContent = item?.streamName || "—";
    $("pvSubject").textContent = item?.subjectInfo || "—";
    $("pvScore").textContent = item ? `${item.score ?? 0}/${item.totalMarks ?? 100} (${item.percentage ?? 0}%)` : "—";
    $("pvGrade").textContent = item ? `Grade: ${item.grade || "—"}` : "—";
    $("pvRemark").textContent = item?.remark || "—";
    if (item) setStatusPill("pvStatus", item.status); else $("pvStatus").textContent = "—";
    $("pvPub").textContent = item?.publishedAt ? `Published: ${item.publishedAt}` : "Not published";
    $("pvUpdated").textContent = item?.updatedAt ? `Updated: ${item.updatedAt}` : "—";
    $("previewEditBtn").disabled = !item || item.status === "published";
    $("previewDeleteBtn").disabled = !item || item.status === "published" || item.everPublished;
  }

  function appendCell(row, value, className = "", innerClass = "cell-ellipsis") {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.appendChild(text("span", value, innerClass));
    row.appendChild(td);
    return td;
  }

  function renderTable() {
    const tbody = $("tbodyResults");
    tbody.replaceChildren();
    if (!RESULTS.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 12;
      td.style.padding = "18px";
      td.appendChild(text("div", "No results found.", "muted"));
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      for (const r of RESULTS) {
        const tr = document.createElement("tr");
        tr.className = "row-clickable";
        tr.dataset.id = String(r.id || "");

        const checkTd = document.createElement("td");
        checkTd.className = "col-check";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.className = "rowCheck";
        check.dataset.id = String(r.id || "");
        check.checked = state.selected.has(String(r.id));
        checkTd.appendChild(check);
        tr.appendChild(checkTd);

        const studentTd = document.createElement("td");
        studentTd.className = "col-student";
        const main = document.createElement("div"); main.className = "student-main";
        main.appendChild(text("div", r.studentName || "Student", "student-title"));
        main.appendChild(text("div", `${r.academicYear || "—"} • Term ${r.term || 1}`, "student-sub"));
        studentTd.appendChild(main); tr.appendChild(studentTd);

        appendCell(tr, r.regNo || "—", "col-reg");
        appendCell(tr, r.examTitle || "—", "col-exam");
        appendCell(tr, r.className || "—", "col-class");
        appendCell(tr, r.sectionName || "Whole Class", "col-section");
        appendCell(tr, r.streamName || "All Streams", "col-stream");
        appendCell(tr, r.subjectInfo || "—", "col-subject");
        appendCell(tr, `${r.score ?? 0}/${r.totalMarks ?? 100}`, "col-score");
        appendCell(tr, r.grade || "—", "col-grade");

        const statusTd = document.createElement("td"); statusTd.className = "col-status";
        statusTd.appendChild(statusPill(r.status)); tr.appendChild(statusTd);

        const actionTd = document.createElement("td"); actionTd.className = "col-actions";
        const actions = document.createElement("div"); actions.className = "actions";
        actions.appendChild(actionButton("actView", "fa-solid fa-eye", "View result"));
        actions.appendChild(actionButton("actEdit", "fa-solid fa-pen", "Edit draft result", r.status === "published"));
        actions.appendChild(actionButton("actStatus", "fa-solid fa-arrows-rotate", "Change result status"));
        actions.appendChild(actionButton("actDelete", "fa-solid fa-trash", "Delete never-published draft", r.status === "published" || r.everPublished));
        actionTd.appendChild(actions); tr.appendChild(actionTd);
        tbody.appendChild(tr);
      }
    }

    $("checkAll").checked = RESULTS.length > 0 && RESULTS.every((r) => state.selected.has(String(r.id)));
    syncBulkbar();
    const active = findResult(state.currentId) || RESULTS[0] || null;
    renderPreview(active);
    if (active) state.currentId = String(active.id);
  }

  function resetStudentOptions() {
    const select = $("mStudent");
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "— Select student —";
    select.replaceChildren(option);
  }

  async function loadExamOptions(examId, preselectStudentId = "") {
    if (!examId) {
      resetStudentOptions();
      $("mTotal").value = "";
      if ($("mClassScope")) $("mClassScope").textContent = "—";
      if ($("mSectionScope")) $("mSectionScope").textContent = "—";
      if ($("mStreamScope")) $("mStreamScope").textContent = "—";
      $("mExamMeta").textContent = "Select an exam to load class, subject, year and term.";
      state.currentExamMeta = null;
      return;
    }
    $("mExamMeta").textContent = "Loading exam details...";
    try {
      const res = await fetch(`/admin/results/options?exam=${encodeURIComponent(examId)}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data = await res.json();
      if (!data?.ok) {
        state.currentExamMeta = null;
        resetStudentOptions();
        $("mExamMeta").textContent = data?.message || "Failed to load exam details.";
        return;
      }
      state.currentExamMeta = data;
      resetStudentOptions();
      for (const s of Array.isArray(data.students) ? data.students : []) {
        const opt = document.createElement("option");
        opt.value = String(s._id || "");
        opt.textContent = `${s.regNo ? `${s.regNo} — ` : ""}${s.fullName || "Student"}`;
        opt.selected = !!preselectStudentId && String(preselectStudentId) === String(s._id);
        $("mStudent").appendChild(opt);
      }
      $("mTotal").value = String(data.exam?.totalMarks ?? 100);
      if ($("mClassScope")) $("mClassScope").textContent = data.labels?.classGroup || "—";
      if ($("mSectionScope")) $("mSectionScope").textContent = data.labels?.section || "—";
      if ($("mStreamScope")) $("mStreamScope").textContent = data.labels?.stream || "—";
      $("mExamMeta").textContent = [
        data.exam?.title || "Exam",
        data.labels?.classGroup ? `Class: ${data.labels.classGroup}` : "",
        data.labels?.section ? `Section: ${data.labels.section}` : "",
        data.labels?.stream ? `Stream: ${data.labels.stream}` : "",
        data.labels?.subject ? `Subject: ${data.labels.subject}` : "",
        `Academic Year: ${data.exam?.academicYear || "—"}`,
        `Term: ${data.exam?.term || "—"}`,
        `Total Marks: ${data.exam?.totalMarks ?? 100}`,
      ].filter(Boolean).join("\n");
      const publishOption = $("mStatus").querySelector('option[value="published"]');
      if (publishOption) publishOption.disabled = data.exam?.status !== "completed";
      if (data.exam?.status !== "completed" && $("mStatus").value === "published") $("mStatus").value = "draft";
      updateAutoComputed();
    } catch (err) {
      console.error(err);
      state.currentExamMeta = null;
      resetStudentOptions();
      $("mExamMeta").textContent = "Failed to load exam details.";
    }
  }

  function updateAutoComputed() {
    const total = Number($("mTotal").value || state.currentExamMeta?.exam?.totalMarks || 100);
    const score = Number($("mScore").value || 0);
    const percentage = total > 0 ? Math.round((score / total) * 10000) / 100 : 0;
    const auto = defaultGrading(percentage);
    $("mPercentage").value = `${percentage}%`;
    if (!$("mGrade").value.trim() || $("mGrade").dataset.auto === "1") { $("mGrade").value = auto.grade; $("mGrade").dataset.auto = "1"; }
    if (!$("mRemark").value.trim() || $("mRemark").dataset.auto === "1") { $("mRemark").value = auto.remark; $("mRemark").dataset.auto = "1"; }
  }

  function openEditor(item) {
    const p = item || null;
    if (p?.status === "published") return alert("Published results are locked. Reopen this result as Draft before correcting it.");
    $("mTitle").textContent = p ? "Edit Result" : "Enter Result";
    $("resultForm").action = p ? `/admin/results/${encodeURIComponent(p.id)}` : "/admin/results";
    $("mExam").value = p?.examId || "";
    resetStudentOptions();
    $("mScore").value = p ? String(p.score ?? "") : "";
    $("mTotal").value = p ? String(p.totalMarks ?? 100) : "";
    $("mPercentage").value = p ? `${p.percentage ?? 0}%` : "";
    $("mGrade").value = p?.grade || "";
    $("mGrade").dataset.auto = p?.grade ? "0" : "1";
    $("mRemark").value = p?.remark || "";
    $("mRemark").dataset.auto = p?.remark ? "0" : "1";
    $("mStatus").value = p?.status || "draft";
    if ($("mClassScope")) $("mClassScope").textContent = p?.className || "—";
    if ($("mSectionScope")) $("mSectionScope").textContent = p?.sectionName || "—";
    if ($("mStreamScope")) $("mStreamScope").textContent = p?.streamName || "—";
    $("mExamMeta").textContent = "Select an exam to load class, subject, year and term.";
    openModal("mEdit");
    if ($("mExam").value) loadExamOptions($("mExam").value, p?.studentId || "");
  }

  function openView(item) {
    if (!item) return;
    state.currentId = String(item.id);
    $("vStudent").textContent = item.studentName || "—";
    $("vRegNo").textContent = item.regNo || "—";
    setStatusPill("vStatus", item.status || "draft");
    $("vExam").textContent = item.examTitle || "—";
    $("vClass").textContent = item.className || "—";
    if ($("vSection")) $("vSection").textContent = item.sectionName || "—";
    if ($("vStream")) $("vStream").textContent = item.streamName || "—";
    $("vSubject").textContent = item.subjectInfo || "—";
    $("vYear").textContent = item.academicYear || "—";
    $("vTerm").textContent = String(item.term || 1);
    $("vScore").textContent = `${item.score ?? 0}/${item.totalMarks ?? 100}`;
    $("vPercentage").textContent = `${item.percentage ?? 0}%`;
    $("vGrade").textContent = item.grade || "—";
    $("vRemark").textContent = item.remark || "—";
    $("vAudit").textContent = [
      item.firstPublishedAt ? `First published: ${item.firstPublishedAt}` : "Never published",
      item.publishedAt ? `Currently published: ${item.publishedAt}` : item.reopenedAt ? `Reopened: ${item.reopenedAt}` : "",
      item.revision ? `Revision: ${item.revision}` : "",
      item.updatedAt ? `Updated: ${item.updatedAt}` : "",
      item.publishedBy ? `Published by: ${item.publishedBy}` : item.enteredBy ? `Entered by: ${item.enteredBy}` : "",
    ].filter(Boolean).join("\n");
    $("viewEditBtn").disabled = item.status === "published";
    openModal("mView");
  }

  function submitStatus(next) {
    if (!state.currentId) return alert("Select a result first.");
    $("statusForm").action = `/admin/results/${encodeURIComponent(state.currentId)}/status`;
    $("statusVal").value = next;
    $("statusForm").submit();
  }
  function submitDelete() {
    const item = findResult(state.currentId);
    if (!item) return alert("Select a result first.");
    if (item.status === "published") return alert("Published results cannot be deleted. Reopen the result only when a correction is required.");
    if (item.everPublished) return alert("Previously published results are retained for audit and cannot be permanently deleted.");
    if (!window.confirm("Delete this never-published draft result permanently?")) return;
    $("deleteForm").action = `/admin/results/${encodeURIComponent(state.currentId)}/delete`;
    $("deleteForm").submit();
  }
  function saveResult() {
    if (!$("mExam").value) return alert("Exam is required.");
    if (!$("mStudent").value) return alert("Student is required.");
    const total = Number($("mTotal").value || 0);
    const score = Number($("mScore").value);
    if (!Number.isFinite(score) || score < 0) return alert("Enter a valid non-negative score.");
    if (!(total > 0)) return alert("The selected exam has invalid total marks.");
    if (score > total) return alert(`Score cannot exceed the exam total marks (${total}).`);
    if ($("mStatus").value === "published" && state.currentExamMeta?.exam?.status !== "completed") return alert("Results can only be published after the exam is Completed.");
    $("resultForm").submit();
  }
  function applyBulk() {
    const action = String($("bulkAction").value || "").trim();
    const ids = Array.from(state.selected);
    if (!action || !ids.length) return alert("Choose a bulk action and select at least one result.");
    if (action === "delete" && !window.confirm(`Delete ${ids.length} selected never-published draft result(s)?`)) return;
    $("bulkActionVal").value = action;
    $("bulkIdsVal").value = ids.join(",");
    $("bulkForm").submit();
  }

  $("btnCreate").addEventListener("click", () => openEditor());
  $("btnImport").addEventListener("click", () => openModal("mImport"));
  $("btnPrint").addEventListener("click", () => window.print());
  $("btnBulk").addEventListener("click", () => { if (!state.selected.size) return alert("Select at least one result."); $("bulkbar").classList.add("show"); });
  $("bulkApply").addEventListener("click", applyBulk);
  $("bulkClear").addEventListener("click", () => { state.selected.clear(); renderTable(); });
  $("previewEditBtn").addEventListener("click", () => openEditor(findResult(state.currentId)));
  $("previewViewBtn").addEventListener("click", () => openView(findResult(state.currentId)));
  $("previewStatusBtn").addEventListener("click", () => { if (!state.currentId) return alert("Select a result first."); openModal("mStatus"); });
  $("previewDeleteBtn").addEventListener("click", submitDelete);
  $("statusDraftBtn").addEventListener("click", () => submitStatus("draft"));
  $("statusPublishBtn").addEventListener("click", () => submitStatus("published"));
  $("viewEditBtn").addEventListener("click", () => { closeModal("mView"); openEditor(findResult(state.currentId)); });
  $("saveBtn").addEventListener("click", saveResult);

  $("checkAll").addEventListener("change", (e) => {
    if (e.target.checked) RESULTS.forEach((r) => state.selected.add(String(r.id)));
    else RESULTS.forEach((r) => state.selected.delete(String(r.id)));
    renderTable();
  });
  $("tbodyResults").addEventListener("change", (e) => {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = String(e.target.dataset.id || "");
    if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
    renderTable();
  });
  $("tbodyResults").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const item = findResult(tr.dataset.id);
    if (!item) return;
    state.currentId = String(item.id);
    renderPreview(item);
    if (e.target.closest(".rowCheck")) return;
    if (e.target.closest(".actView")) return openView(item);
    if (e.target.closest(".actEdit")) return openEditor(item);
    if (e.target.closest(".actStatus")) return openModal("mStatus");
    if (e.target.closest(".actDelete")) return submitDelete();
    openView(item);
  });

  $("mExam").addEventListener("change", () => loadExamOptions($("mExam").value));
  $("mScore").addEventListener("input", updateAutoComputed);
  $("mGrade").addEventListener("input", () => { $("mGrade").dataset.auto = "0"; });
  $("mRemark").addEventListener("input", () => { $("mRemark").dataset.auto = "0"; });

  const importFile = $("importFile");
  const importFileName = $("importFileName");
  const importDropzone = $("importDropzone");
  importFile.addEventListener("change", () => { importFileName.textContent = importFile.files?.[0]?.name || "No file selected"; });
  ["dragenter", "dragover"].forEach((evt) => importDropzone.addEventListener(evt, (e) => { e.preventDefault(); importDropzone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((evt) => importDropzone.addEventListener(evt, (e) => { e.preventDefault(); importDropzone.classList.remove("drag"); }));
  importDropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    importFile.files = dt.files;
    importFileName.textContent = file.name;
  });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
  ["mEdit", "mView", "mStatus", "mImport"].forEach((mid) => {
    const el = $(mid);
    if (el) el.addEventListener("click", (e) => { if (e.target.id === mid) closeModal(mid); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show"));
      document.body.style.overflow = "";
    }
  });

  renderTable();
})();

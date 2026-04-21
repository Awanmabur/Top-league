(() => {
  const $ = (id) => document.getElementById(id);

  function readResultsData() {
    const el = $("resultsData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse results data:", err);
      return [];
    }
  }

  const RESULTS = readResultsData();
  if (!$("tbodyResults")) return;

  const state = {
    selected: new Set(),
    currentId: RESULTS[0]?.id || null,
    currentExamMeta: null,
  };

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function findResult(id) {
    return RESULTS.find((x) => x.id === id) || null;
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

  function statusPill(status) {
    return status === "published"
      ? '<span class="pill ok"><i class="fa-solid fa-eye"></i> Published</span>'
      : '<span class="pill warn"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
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
    $("pvScore").textContent = item ? `${item.score || 0}/${item.totalMarks || 100} (${item.percentage || 0}%)` : "—";
    $("pvGrade").textContent = item ? `Grade: ${item.grade || "—"}` : "—";
    $("pvRemark").textContent = item?.remark || "—";
    $("pvStatus").innerHTML = item ? statusPill(item.status) : "—";
    $("pvPub").textContent = item?.publishedAt ? `Published: ${item.publishedAt}` : "Not published";
    $("pvUpdated").textContent = item?.updatedAt ? `Updated: ${item.updatedAt}` : "—";
  }

  function renderTable() {
    $("tbodyResults").innerHTML =
      RESULTS.map((r) => {
        const checked = state.selected.has(r.id) ? "checked" : "";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(r.id)}">
            <td class="col-check">
              <input type="checkbox" class="rowCheck" data-id="${escapeHtml(r.id)}" ${checked}>
            </td>
            <td class="col-student">
              <div class="student-main">
                <div class="student-title">${escapeHtml(r.studentName)}</div>
                <div class="student-sub">${escapeHtml(r.academicYear || "—")} • Term ${escapeHtml(String(r.term || 1))}</div>
              </div>
            </td>
            <td class="col-reg"><span class="cell-ellipsis">${escapeHtml(r.regNo || "—")}</span></td>
            <td class="col-exam"><span class="cell-ellipsis">${escapeHtml(r.examTitle || "—")}</span></td>
            <td class="col-class"><span class="cell-ellipsis">${escapeHtml(r.className || "—")}</span></td>
            <td class="col-section"><span class="cell-ellipsis">${escapeHtml(r.sectionName || "Whole Class")}</span></td>
            <td class="col-stream"><span class="cell-ellipsis">${escapeHtml(r.streamName || "All Streams")}</span></td>
            <td class="col-subject"><span class="cell-ellipsis">${escapeHtml(r.subjectInfo || "—")}</span></td>
            <td class="col-score"><span class="cell-ellipsis">${escapeHtml(String(r.score || 0))}/${escapeHtml(String(r.totalMarks || 100))}</span></td>
            <td class="col-grade"><span class="cell-ellipsis">${escapeHtml(r.grade || "—")}</span></td>
            <td class="col-status">${statusPill(r.status)}</td>
            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actStatus" type="button"><i class="fa-solid fa-arrows-rotate"></i></button>
                <button class="btn-xs actDelete" type="button"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `<tr><td colspan="12" style="padding:18px;"><div class="muted">No results found.</div></td></tr>`;

    $("checkAll").checked = RESULTS.length > 0 && RESULTS.every((r) => state.selected.has(r.id));
    syncBulkbar();

    const active = findResult(state.currentId) || RESULTS[0] || null;
    renderPreview(active);
    if (active) state.currentId = active.id;
  }

  async function loadExamOptions(examId, preselectStudentId = "") {
    if (!examId) {
      $("mStudent").innerHTML = '<option value="">— Select student —</option>';
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
      const res = await fetch(`/admin/results/options?exam=${encodeURIComponent(examId)}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });

      const data = await res.json();
      if (!data || !data.ok) {
        $("mExamMeta").textContent = data?.message || "Failed to load exam details.";
        return;
      }

      state.currentExamMeta = data;
      const students = Array.isArray(data.students) ? data.students : [];

      $("mStudent").innerHTML = '<option value="">— Select student —</option>';
      students.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s._id;
        opt.textContent = `${s.regNo ? `${s.regNo} — ` : ""}${s.fullName}`;
        if (preselectStudentId && String(preselectStudentId) === String(s._id)) {
          opt.selected = true;
        }
        $("mStudent").appendChild(opt);
      });

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
      ]
        .filter(Boolean)
        .join("\n");

      updateAutoComputed();
    } catch (err) {
      console.error(err);
      $("mExamMeta").textContent = "Failed to load exam details.";
    }
  }

  function updateAutoComputed() {
    const total = Number($("mTotal").value || state.currentExamMeta?.exam?.totalMarks || 100);
    const score = Number($("mScore").value || 0);
    const percentage = total > 0 ? Math.round(((score / total) * 100) * 100) / 100 : 0;
    const auto = defaultGrading(percentage);

    $("mPercentage").value = `${percentage}%`;

    if (!$("mGrade").value.trim() || $("mGrade").dataset.auto === "1") {
      $("mGrade").value = auto.grade;
      $("mGrade").dataset.auto = "1";
    }

    if (!$("mRemark").value.trim() || $("mRemark").dataset.auto === "1") {
      $("mRemark").value = auto.remark;
      $("mRemark").dataset.auto = "1";
    }
  }

  function openEditor(item) {
    const p = item || null;

    $("mTitle").textContent = p ? "Edit Result" : "Enter Result";
    $("resultForm").action = p ? `/admin/results/${encodeURIComponent(p.id)}` : "/admin/results";

    $("mExam").value = p?.examId || "";
    $("mStudent").innerHTML = '<option value="">— Select student —</option>';
    $("mScore").value = p ? String(p.score || "") : "";
    $("mTotal").value = p ? String(p.totalMarks || 100) : "";
    $("mPercentage").value = p ? `${p.percentage || 0}%` : "";
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

    if ($("mExam").value) {
      loadExamOptions($("mExam").value, p?.studentId || "");
    }
  }

  function openView(item) {
    if (!item) return;

    state.currentId = item.id;

    $("vStudent").textContent = item.studentName || "—";
    $("vRegNo").textContent = item.regNo || "—";
    $("vStatus").innerHTML = statusPill(item.status || "draft");
    $("vExam").textContent = item.examTitle || "—";
    $("vClass").textContent = item.className || "—";
    if ($("vSection")) $("vSection").textContent = item.sectionName || "—";
    if ($("vStream")) $("vStream").textContent = item.streamName || "—";
    $("vSubject").textContent = item.subjectInfo || "—";
    $("vYear").textContent = item.academicYear || "—";
    $("vTerm").textContent = String(item.term || 1);
    $("vScore").textContent = `${item.score || 0}/${item.totalMarks || 100}`;
    $("vPercentage").textContent = `${item.percentage || 0}%`;
    $("vGrade").textContent = item.grade || "—";
    $("vRemark").textContent = item.remark || "—";
    $("vAudit").textContent = [
      item.publishedAt ? `Published: ${item.publishedAt}` : "Not published",
      item.updatedAt ? `Updated: ${item.updatedAt}` : "",
      item.enteredBy ? `By: ${item.enteredBy}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    openModal("mView");
  }

  function submitStatus(next) {
    if (!state.currentId) return alert("Select a result first.");
    $("statusForm").action = `/admin/results/${encodeURIComponent(state.currentId)}/status`;
    $("statusVal").value = next;
    $("statusForm").submit();
  }

  function submitDelete() {
    if (!state.currentId) return alert("Select a result first.");
    if (!window.confirm("Delete this result permanently?")) return;
    $("deleteForm").action = `/admin/results/${encodeURIComponent(state.currentId)}/delete`;
    $("deleteForm").submit();
  }

  function saveResult() {
    if (!$("mExam").value) return alert("Exam is required.");
    if (!$("mStudent").value) return alert("Student is required.");

    const total = Number($("mTotal").value || 100);
    const score = Number($("mScore").value || 0);
    if (total > 0 && score > total) {
      if (!window.confirm(`Score (${score}) is greater than total marks (${total}). Save anyway?`)) {
        return;
      }
    }

    $("resultForm").submit();
  }

  function applyBulk() {
    const action = String($("bulkAction").value || "").trim();
    const ids = Array.from(state.selected);

    if (!action || !ids.length) return alert("Choose a bulk action and select at least one result.");
    if (action === "delete" && !window.confirm(`Delete ${ids.length} result(s)? This cannot be undone.`)) return;

    $("bulkActionVal").value = action;
    $("bulkIdsVal").value = ids.join(",");
    $("bulkForm").submit();
  }

  $("btnCreate").addEventListener("click", () => openEditor());
  $("btnImport").addEventListener("click", () => openModal("mImport"));
  $("btnPrint").addEventListener("click", () => window.print());
  $("btnBulk").addEventListener("click", () => {
    if (!state.selected.size) return alert("Select at least one result.");
    $("bulkbar").classList.add("show");
  });
  $("bulkApply").addEventListener("click", applyBulk);
  $("bulkClear").addEventListener("click", () => {
    state.selected.clear();
    renderTable();
  });

  $("previewEditBtn").addEventListener("click", () => openEditor(findResult(state.currentId)));
  $("previewViewBtn").addEventListener("click", () => openView(findResult(state.currentId)));
  $("previewStatusBtn").addEventListener("click", () => {
    if (!state.currentId) return alert("Select a result first.");
    openModal("mStatus");
  });
  $("previewDeleteBtn").addEventListener("click", submitDelete);
  $("statusDraftBtn").addEventListener("click", () => submitStatus("draft"));
  $("statusPublishBtn").addEventListener("click", () => submitStatus("published"));
  $("viewEditBtn").addEventListener("click", () => {
    closeModal("mView");
    openEditor(findResult(state.currentId));
  });
  $("saveBtn").addEventListener("click", saveResult);

  $("checkAll").addEventListener("change", (e) => {
    if (e.target.checked) RESULTS.forEach((r) => state.selected.add(r.id));
    else RESULTS.forEach((r) => state.selected.delete(r.id));
    renderTable();
  });

  $("tbodyResults").addEventListener("change", (e) => {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyResults").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const item = findResult(tr.dataset.id);
    if (!item) return;

    state.currentId = item.id;
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
  $("mGrade").addEventListener("input", () => {
    $("mGrade").dataset.auto = "0";
  });
  $("mRemark").addEventListener("input", () => {
    $("mRemark").dataset.auto = "0";
  });

  const importFile = $("importFile");
  const importFileName = $("importFileName");
  const importDropzone = $("importDropzone");

  importFile.addEventListener("change", () => {
    importFileName.textContent = importFile.files?.[0]?.name || "No file selected";
  });

  ["dragenter", "dragover"].forEach((evt) => {
    importDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      importDropzone.classList.add("drag");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    importDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      importDropzone.classList.remove("drag");
    });
  });

  importDropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    importFile.files = dt.files;
    importFileName.textContent = file.name;
  });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  ["mEdit", "mView", "mStatus", "mImport"].forEach((mid) => {
    const el = $(mid);
    if (!el) return;
    el.addEventListener("click", (e) => {
      if (e.target.id === mid) closeModal(mid);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show"));
      document.body.style.overflow = "";
    }
  });

  renderTable();
})();

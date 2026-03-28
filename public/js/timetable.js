(function () {
  const $ = (id) => document.getElementById(id);

  function readEntriesData() {
    const el = $("entriesData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse timetable data:", err);
      return [];
    }
  }

  const ENTRIES = readEntriesData();
  if (!$("tbodyEntries")) return;

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
    document.body.style.overflow = document.querySelector(".modal-backdrop.show") ? "hidden" : "";
  }

  function submitRowAction(actionUrl, statusValue) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    if ($("rowStatusValue")) $("rowStatusValue").value = statusValue || "";
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

  function formatDuration(startMins, endMins) {
    const diff = Math.max(0, Number(endMins || 0) - Number(startMins || 0));
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    if (!diff) return "—";
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }

  function parseTimeToMinutes(v) {
    const m = String(v || "").trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!m) return 0;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function renderTable() {
    $("tbodyEntries").innerHTML =
      ENTRIES.map((e) => {
        const checked = state.selected.has(e.id) ? "checked" : "";
        const subjectLabel = [e.subjectCode, e.subjectTitle].filter(Boolean).join(" — ") || "—";

        return `
          <tr class="row-clickable" data-id="${escapeHtml(e.id)}">
            <td class="col-check">
              <input type="checkbox" class="rowCheck" data-id="${escapeHtml(e.id)}" ${checked}>
            </td>

            <td class="col-subject">
              <div class="entry-main">
                <div class="entry-title" title="${escapeHtml(subjectLabel)}">${escapeHtml(subjectLabel)}</div>
                <div class="entry-sub" title="${escapeHtml(e.note || "—")}">${escapeHtml(e.note || "—")}</div>
              </div>
            </td>

            <td class="col-class">
              <span class="cell-ellipsis" title="${escapeHtml(e.className || "—")}">${escapeHtml(e.className || "—")}</span>
            </td>

            <td class="col-teacher">
              <span class="cell-ellipsis" title="${escapeHtml(e.teacherName || "—")}">${escapeHtml(e.teacherName || "—")}</span>
            </td>

            <td class="col-day">
              <span class="cell-ellipsis">${escapeHtml(e.dayOfWeek || "—")}</span>
            </td>

            <td class="col-time">
              <span class="cell-ellipsis">${escapeHtml((e.startTime || "—") + "–" + (e.endTime || "—"))}</span>
            </td>

            <td class="col-room">
              <span class="cell-ellipsis" title="${escapeHtml(e.room || "—")}">${escapeHtml(e.room || "—")}</span>
            </td>

            <td class="col-campus">
              <span class="cell-ellipsis" title="${escapeHtml(e.campus || "—")}">${escapeHtml(e.campus || "—")}</span>
            </td>

            <td class="col-academic">
              <span class="cell-ellipsis" title="${escapeHtml((e.academicYear || "—") + " • Term " + (e.term || 1))}">
                ${escapeHtml(e.academicYear || "—")} • Term ${escapeHtml(String(e.term || 1))}
              </span>
            </td>

            <td class="col-week">
              <span class="cell-ellipsis">${escapeHtml(e.weekPattern || "all")}</span>
            </td>

            <td class="col-status">
              ${statusPill(e.status)}
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
        <td colspan="12" style="padding:18px;">
          <div class="muted">No timetable entries found.</div>
        </td>
      </tr>
      `;

    $("checkAll").checked = ENTRIES.length > 0 && ENTRIES.every((e) => state.selected.has(e.id));
    syncBulkbar();
  }

  function updateCounters() {
    $("noteCount").textContent = `${$("mNote").value.length} / 500`;
    $("mDurationPreview").textContent = formatDuration(
      parseTimeToMinutes($("mStart").value),
      parseTimeToMinutes($("mEnd").value)
    );
  }

  function openEditor(prefill) {
    const e = prefill || null;

    $("mTitle").textContent = e ? "Edit Timetable Slot" : "Add Timetable Slot";
    $("entryForm").action = e ? `/tenant/timetable/${encodeURIComponent(e.id)}` : "/tenant/timetable";

    $("mClass").value = e ? e.classId || "" : "";
    $("mSubject").value = e ? e.subjectId || "" : "";
    $("mTeacher").value = e ? e.teacherId || "" : "";
    $("mDay").value = e ? e.dayOfWeek || "Mon" : "Mon";
    $("mStart").value = e ? e.startTime || "08:00" : "08:00";
    $("mEnd").value = e ? e.endTime || "10:00" : "10:00";
    $("mAY").value = e ? e.academicYear || "" : "";
    $("mTerm").value = e ? String(e.term || 1) : "1";
    $("mRoom").value = e ? e.room || "" : "";
    $("mCampus").value = e ? e.campus || "" : "";
    $("mWeek").value = e ? e.weekPattern || "all" : "all";
    $("mStatus").value = e ? e.status || "active" : "active";
    $("mNote").value = e ? e.note || "" : "";

    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(e) {
    if (!e) return;

    state.currentViewId = e.id;

    $("vSubject").textContent = [e.subjectCode, e.subjectTitle].filter(Boolean).join(" — ") || "—";
    $("vClass").textContent = e.className || "—";
    $("vTeacher").textContent = e.teacherName || "—";
    $("vDay").textContent = e.dayOfWeek || "—";
    $("vTime").textContent = `${e.startTime || "—"} – ${e.endTime || "—"} (${formatDuration(e.startMinutes, e.endMinutes)})`;
    $("vStatus").innerHTML = statusPill(e.status || "active");
    $("vRoom").textContent = e.room || "—";
    $("vCampus").textContent = e.campus || "—";
    $("vAcademic").textContent = `${e.academicYear || "—"} • Term ${e.term || 1} • ${e.weekPattern || "all"}`;
    $("vNote").textContent = e.note || "—";

    openModal("mView");
  }

  function saveEntry() {
    const classGroup = $("mClass").value.trim();
    const subject = $("mSubject").value.trim();
    const start = $("mStart").value.trim();
    const end = $("mEnd").value.trim();

    if (!classGroup) return alert("Class is required.");
    if (!subject) return alert("Subject is required.");
    if (!/^\d{2}:\d{2}$/.test(start)) return alert("Start time must be HH:MM.");
    if (!/^\d{2}:\d{2}$/.test(end)) return alert("End time must be HH:MM.");
    if (parseTimeToMinutes(end) <= parseTimeToMinutes(start)) return alert("End time must be later than start time.");

    $("entryForm").submit();
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

  function exportEntries() {
    const rows = [
      ["SubjectCode", "SubjectTitle", "Class", "Teacher", "Day", "StartTime", "EndTime", "Room", "Campus", "AcademicYear", "Term", "WeekPattern", "Status", "Note"],
      ...ENTRIES.map((e) => [
        e.subjectCode || "",
        e.subjectTitle || "",
        e.className || "",
        e.teacherName || "",
        e.dayOfWeek || "",
        e.startTime || "",
        e.endTime || "",
        e.room || "",
        e.campus || "",
        e.academicYear || "",
        e.term || 1,
        e.weekPattern || "",
        e.status || "",
        e.note || "",
      ]),
    ];

    downloadCsv("timetable-export.csv", rows);
  }

  function submitBulk(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one slot.");
    if (action === "delete" && !window.confirm(`Delete ${ids.length} selected slot(s)?`)) return;

    $("bulkActionValue").value = action;
    $("bulkIdsValue").value = ids.join(",");
    $("bulkForm").submit();
  }

  function buildGrid() {
    const ttGrid = $("ttGrid");
    const ttMeta = $("ttMeta");
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const hours = [];
    for (let h = 7; h <= 19; h += 1) hours.push(h);

    const header = ['<div class="tthead"></div>']
      .concat(days.map((d) => `<div class="tthead">${escapeHtml(d)}</div>`))
      .join("");

    const cells = [];
    hours.forEach((h) => {
      const label = `${String(h).padStart(2, "0")}:00`;
      cells.push(`<div class="tthour">${label}</div>`);
      days.forEach((d) => {
        cells.push(`<div class="ttcell" data-day="${d}" data-hour="${h}"></div>`);
      });
    });

    ttGrid.innerHTML = header + cells.join("");

    ENTRIES.forEach((e) => {
      if (!days.includes(e.dayOfWeek)) return;
      const hour = Math.floor(Number(e.startMinutes || 0) / 60);
      const cell = ttGrid.querySelector(`.ttcell[data-day="${e.dayOfWeek}"][data-hour="${hour}"]`);
      if (!cell) return;

      const div = document.createElement("div");
      div.className = "block";
      div.innerHTML = `
        <div class="b1">${escapeHtml(e.subjectCode || "SUBJECT")}</div>
        <div class="b2">${escapeHtml((e.startTime || "") + "–" + (e.endTime || ""))} • ${escapeHtml(e.room || "—")}</div>
        <div class="b2">${escapeHtml(e.className || "—")}</div>
      `;
      cell.appendChild(div);
    });

    ttMeta.textContent = ENTRIES.length
      ? `Rendering ${ENTRIES.length} slot(s) from the current page`
      : "No timetable slots to render";
  }

  function setView(which) {
    $("tabList").classList.toggle("active", which === "list");
    $("tabGrid").classList.toggle("active", which === "grid");
    $("listWrap").classList.toggle("active", which === "list");
    $("gridWrap").classList.toggle("active", which === "grid");

    if (which === "grid") buildGrid();
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickMorning").addEventListener("click", function () {
    openEditor();
    $("mStart").value = "08:00";
    $("mEnd").value = "10:00";
    updateCounters();
  });

  $("quickAfternoon").addEventListener("click", function () {
    openEditor();
    $("mStart").value = "14:00";
    $("mEnd").value = "16:00";
    updateCounters();
  });

  $("btnImport").addEventListener("click", function () {
    openModal("mImport");
  });

  $("quickImport").addEventListener("click", function () {
    openModal("mImport");
  });

  $("btnExport").addEventListener("click", exportEntries);
  $("btnPrint").addEventListener("click", function () {
    window.print();
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one slot.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate").addEventListener("click", function () { submitBulk("activate"); });
  $("bulkDeactivate").addEventListener("click", function () { submitBulk("deactivate"); });
  $("bulkArchive").addEventListener("click", function () { submitBulk("archive"); });
  $("bulkDelete").addEventListener("click", function () { submitBulk("delete"); });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    renderTable();
  });

  $("tabList").addEventListener("click", function () { setView("list"); });
  $("tabGrid").addEventListener("click", function () { setView("grid"); });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) ENTRIES.forEach((x) => state.selected.add(x.id));
    else ENTRIES.forEach((x) => state.selected.delete(x.id));
    renderTable();
  });

  $("tbodyEntries").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyEntries").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const item = ENTRIES.find((x) => x.id === tr.dataset.id);
    if (!item) return;

    if (
      e.target.closest(".rowCheck") ||
      e.target.closest(".actions") ||
      e.target.closest(".btn-xs")
    ) {
      if (e.target.closest(".actView")) return openViewModal(item);
      if (e.target.closest(".actEdit")) return openEditor(item);

      if (e.target.closest(".actStatus")) {
        const next = item.status === "active" ? "inactive" : item.status === "inactive" ? "archived" : "active";
        if (!window.confirm(`Set "${item.subjectCode || "slot"}" to ${next}?`)) return;
        return submitRowAction(`/tenant/timetable/${encodeURIComponent(item.id)}/status`, next);
      }

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${item.subjectCode || "slot"}" permanently?`)) return;
        return submitRowAction(`/tenant/timetable/${encodeURIComponent(item.id)}/delete`);
      }

      return;
    }

    openViewModal(item);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const item = ENTRIES.find((x) => x.id === state.currentViewId);
    if (!item) return;
    closeModal("mView");
    openEditor(item);
  });

  $("saveBtn").addEventListener("click", saveEntry);

  ["mStart", "mEnd", "mNote"].forEach(function (id) {
    $(id).addEventListener("input", updateCounters);
  });

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
(() => {
  const $ = (id) => document.getElementById(id);
  const BASE_PATH = "/admin/academic-calendar";

  function readJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.value || el.textContent || JSON.stringify(fallback));
    } catch (err) {
      console.error("Failed to parse JSON:", id, err);
      return fallback;
    }
  }

  const EVENTS = readJson("eventsData", []);
  if (!$("tbodyEvents")) return;

  const state = { selected: new Set(), currentViewId: EVENTS[0]?.id || null };

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

  function findEvent(id) {
    return EVENTS.find((x) => x.id === id) || null;
  }

  function statusPill(status) {
    if (status === "active") return '<span class="pill ok"><i class="fa-solid fa-calendar-check"></i> Active</span>';
    if (status === "archived") return '<span class="pill bad"><i class="fa-solid fa-box-archive"></i> Archived</span>';
    return '<span class="pill warn"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
  }

  function dateLabel(event) {
    if (!event?.startDate) return "-";
    if (event.endDate) return `${event.startDisplay || event.startDate} to ${event.endDisplay || event.endDate}`;
    return event.startDisplay || event.startDate;
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function renderTable() {
    $("tbodyEvents").innerHTML =
      EVENTS.map((ev) => {
        const checked = state.selected.has(ev.id) ? "checked" : "";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(ev.id)}">
            <td class="col-check"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(ev.id)}" ${checked}></td>
            <td class="col-event">
              <div class="item-main">
                <div class="item-title" title="${escapeHtml(ev.title || "-")}">${escapeHtml(ev.title || "-")}</div>
                <div class="item-sub">${escapeHtml(ev.location || ev.notes || "No location")}</div>
              </div>
            </td>
            <td class="col-type"><span class="cell-ellipsis">${escapeHtml(ev.type || "-")}</span></td>
            <td class="col-year"><span class="cell-ellipsis">${escapeHtml(ev.academicYear || "-")}</span></td>
            <td class="col-term"><span class="cell-ellipsis">${escapeHtml(ev.term || "-")}</span></td>
            <td class="col-class"><span class="cell-ellipsis">${escapeHtml(ev.className || "Whole School")}</span></td>
            <td class="col-section"><span class="cell-ellipsis">${escapeHtml(ev.sectionName || "All Sections")}</span></td>
            <td class="col-stream"><span class="cell-ellipsis">${escapeHtml(ev.streamName || "All Streams")}</span></td>
            <td class="col-dates"><span class="cell-ellipsis">${escapeHtml(dateLabel(ev))}</span></td>
            <td class="col-status">${statusPill(ev.status)}</td>
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
      }).join("") || `<tr><td colspan="11" style="padding:18px;"><div class="muted">No calendar events found.</div></td></tr>`;

    $("checkAll").checked = EVENTS.length > 0 && EVENTS.every((ev) => state.selected.has(ev.id));
    syncBulkbar();
  }

  function refreshAcademicSelector() {
    window.AcademicSelector?.refresh(document);
  }

  function applyAcademicSelection(eventItem) {
    refreshAcademicSelector();
    $("mClassGroup").value = eventItem?.classId || "";
    refreshAcademicSelector();
    $("mSection").value = eventItem?.sectionId || "";
    $("mStream").value = eventItem?.streamId || "";
    refreshAcademicSelector();
  }

  function openEditor(item, statusOverride) {
    const ev = item || null;
    $("mTitleBar").textContent = ev ? "Edit Event" : "Add Event";
    $("eventForm").action = ev ? `${BASE_PATH}/${encodeURIComponent(ev.id)}` : BASE_PATH;

    $("mTitle").value = ev?.title || "";
    $("mType").value = ev?.type || "";
    $("mStatus").value = statusOverride || ev?.status || "draft";
    $("mYear").value = ev?.academicYear || "";
    $("mTerm").value = ev?.term || "";
    $("mStart").value = ev?.startDate || "";
    $("mEnd").value = ev?.endDate || "";
    $("mLocation").value = ev?.location || "";
    $("mNotes").value = ev?.notes || "";

    applyAcademicSelection(ev);
    openModal("mEdit");
  }

  function openView(eventItem) {
    if (!eventItem) return;
    state.currentViewId = eventItem.id;

    $("vTitle").textContent = eventItem.title || "-";
    $("vType").textContent = eventItem.type || "-";
    $("vStatus").innerHTML = statusPill(eventItem.status);
    $("vYear").textContent = eventItem.academicYear || "-";
    $("vTerm").textContent = eventItem.term || "-";
    $("vClass").textContent = eventItem.className || "Whole School";
    $("vSection").textContent = eventItem.sectionName || "All Sections";
    $("vStream").textContent = eventItem.streamName || "All Streams";
    $("vDates").textContent = dateLabel(eventItem);
    $("vLocation").textContent = eventItem.location || "-";
    $("vNotes").textContent = eventItem.notes || "-";

    openModal("mView");
  }

  function submitAction(url, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const form = $("rowActionForm");
    form.action = url;
    form.submit();
  }

  function saveEvent() {
    if (!$("mTitle").value.trim()) return alert("Title is required.");
    if (!$("mType").value.trim()) return alert("Type is required.");
    if (!$("mStart").value.trim()) return alert("Start date is required.");

    const start = $("mStart").value;
    const end = $("mEnd").value;
    if (start && end && end < start) return alert("End date cannot be before start date.");

    $("eventForm").submit();
  }

  function submitBulkArchive() {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one event.");
    if (!window.confirm(`Archive ${ids.length} event(s)?`)) return;
    $("bulkIdsField").value = ids.join(",");
    $("bulkForm").submit();
  }

  $("btnCreate").addEventListener("click", () => openEditor());
  $("quickDraft").addEventListener("click", () => openEditor(null, "draft"));
  $("quickActive").addEventListener("click", () => openEditor(null, "active"));
  $("btnImport").addEventListener("click", () => openModal("mImport"));
  $("btnPrint").addEventListener("click", () => window.print());
  $("saveBtn").addEventListener("click", saveEvent);
  $("btnBulk").addEventListener("click", () => {
    if (!state.selected.size) return alert("Select at least one event.");
    $("bulkbar").classList.add("show");
  });
  $("bulkArchive").addEventListener("click", submitBulkArchive);
  $("bulkClear").addEventListener("click", () => {
    state.selected.clear();
    renderTable();
  });

  $("checkAll").addEventListener("change", (event) => {
    if (event.target.checked) EVENTS.forEach((ev) => state.selected.add(ev.id));
    else EVENTS.forEach((ev) => state.selected.delete(ev.id));
    renderTable();
  });

  $("tbodyEvents").addEventListener("change", (event) => {
    if (!event.target.classList.contains("rowCheck")) return;
    const id = event.target.dataset.id;
    if (event.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyEvents").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;
    const item = findEvent(row.dataset.id);
    if (!item) return;

    if (event.target.closest(".rowCheck")) return;
    if (event.target.closest(".actView")) return openView(item);
    if (event.target.closest(".actEdit")) return openEditor(item);
    if (event.target.closest(".actArchive")) return submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/archive`, "Archive this event?");
    if (event.target.closest(".actDelete")) return submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/delete`, "Delete this event?");

    openView(item);
  });

  $("viewEditBtn").addEventListener("click", () => {
    const item = findEvent(state.currentViewId);
    if (!item) return;
    closeModal("mView");
    openEditor(item);
  });
  $("viewArchiveBtn").addEventListener("click", () => {
    const item = findEvent(state.currentViewId);
    if (!item) return;
    submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/archive`, "Archive this event?");
  });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  ["mEdit", "mView", "mImport"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("click", (event) => {
      if (event.target.id === id) closeModal(id);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show"));
      document.body.style.overflow = "";
    }
  });

  renderTable();
})();

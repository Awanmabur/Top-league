(() => {
  const $ = (id) => document.getElementById(id);
  const BASE_PATH = "/admin/academic-calendar";

  function readJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try { return JSON.parse(el.value || el.textContent || JSON.stringify(fallback)); }
    catch (err) { console.error("Failed to parse JSON:", id, err); return fallback; }
  }

  const EVENTS = readJson("eventsData", []);
  if (!$("tbodyEvents")) return;
  const state = { selected: new Set(), currentViewId: EVENTS[0]?.id || null };

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }
  function icon(name) { const i = node("i", `fa-solid ${name}`); return i; }
  function button(className, actionClass, title, iconName) {
    const btn = node("button", `${className} ${actionClass}`.trim()); btn.type = "button"; btn.title = title; btn.append(icon(iconName)); return btn;
  }
  function statusPill(status) {
    const map = status === "active" ? ["pill ok", "fa-calendar-check", "Active"] : status === "archived" ? ["pill bad", "fa-box-archive", "Archived"] : ["pill warn", "fa-pen-to-square", "Draft"];
    const span = node("span", map[0]); span.append(icon(map[1]), document.createTextNode(` ${map[2]}`)); return span;
  }
  function openModal(id) { const el = $(id); if (!el) return; el.classList.add("show"); document.body.style.overflow = "hidden"; }
  function closeModal(id) { const el = $(id); if (!el) return; el.classList.remove("show"); if (!document.querySelector(".modal-backdrop.show")) document.body.style.overflow = ""; }
  function findEvent(id) { return EVENTS.find((x) => x.id === id) || null; }
  function dateLabel(event) { if (!event?.startDate) return "-"; if (event.endDate && event.endDate !== event.startDate) return `${event.startDisplay || event.startDate} to ${event.endDisplay || event.endDate}`; return event.startDisplay || event.startDate; }
  function syncBulkbar() { $("selCount").textContent = String(state.selected.size); $("bulkbar").classList.toggle("show", state.selected.size > 0); }
  function textCell(className, value, title) { const td = node("td", className); const span = node("span", "cell-ellipsis", value); if (title) span.title = title; td.append(span); return td; }

  function renderTable() {
    const body = $("tbodyEvents"); body.replaceChildren();
    if (!EVENTS.length) {
      const tr = node("tr"); const td = node("td"); td.colSpan = 11; td.style.padding = "18px"; td.append(node("div", "muted", "No calendar events found.")); tr.append(td); body.append(tr);
    } else {
      for (const ev of EVENTS) {
        const tr = node("tr", "row-clickable"); tr.dataset.id = ev.id;
        const checkTd = node("td", "col-check"); const check = node("input", "rowCheck"); check.type = "checkbox"; check.dataset.id = ev.id; check.checked = state.selected.has(ev.id); checkTd.append(check);
        const eventTd = node("td", "col-event"); const main = node("div", "item-main"); const title = node("div", "item-title", ev.title || "-"); title.title = ev.title || "-"; main.append(title, node("div", "item-sub", ev.location || ev.notes || "No location")); eventTd.append(main);
        const statusTd = node("td", "col-status"); statusTd.append(statusPill(ev.status));
        const actionsTd = node("td", "col-actions"); const actions = node("div", "actions"); actions.append(button("btn-xs", "actView", "View", "fa-eye"));
        if (ev.status !== "archived") {
          actions.append(button("btn-xs", "actEdit", "Edit", "fa-pen"));
          actions.append(button("btn-xs", "actArchive", "Archive", "fa-box-archive"));
          if (ev.canDelete) actions.append(button("btn-xs", "actDelete", "Delete", "fa-trash"));
        }
        actionsTd.append(actions);
        tr.append(checkTd, eventTd, textCell("col-type", ev.type || "-"), textCell("col-year", ev.academicYear || "-"), textCell("col-term", ev.term || "-"), textCell("col-class", ev.className || "Whole School"), textCell("col-section", ev.sectionName || "All Sections"), textCell("col-stream", ev.streamName || "All Streams"), textCell("col-dates", dateLabel(ev)), statusTd, actionsTd);
        body.append(tr);
      }
    }
    $("checkAll").checked = EVENTS.length > 0 && EVENTS.every((ev) => state.selected.has(ev.id));
    syncBulkbar();
  }

  function refreshAcademicSelector() { window.AcademicSelector?.refresh(document); }
  function applyAcademicSelection(eventItem) { refreshAcademicSelector(); $("mClassGroup").value = eventItem?.classId || ""; refreshAcademicSelector(); $("mSection").value = eventItem?.sectionId || ""; $("mStream").value = eventItem?.streamId || ""; refreshAcademicSelector(); }
  function openEditor(item, statusOverride) {
    const ev = item || null; if (ev?.status === "archived") return;
    $("mTitleBar").textContent = ev ? "Edit Event" : "Add Event";
    $("eventForm").action = ev ? `${BASE_PATH}/${encodeURIComponent(ev.id)}` : BASE_PATH;
    $("mRevision").value = String(ev?.revision || 0); $("mTitle").value = ev?.title || ""; $("mType").value = ev?.type || ""; $("mStatus").value = statusOverride || ev?.status || "draft"; $("mYear").value = ev?.academicYear || ""; $("mTerm").value = ev?.term || ""; $("mStart").value = ev?.startDate || ""; $("mEnd").value = ev?.endDate || ""; $("mLocation").value = ev?.location || ""; $("mNotes").value = ev?.notes || "";
    applyAcademicSelection(ev); openModal("mEdit");
  }
  function openView(eventItem) {
    if (!eventItem) return; state.currentViewId = eventItem.id;
    $("vTitle").textContent = eventItem.title || "-"; $("vType").textContent = eventItem.type || "-"; $("vStatus").replaceChildren(statusPill(eventItem.status)); $("vYear").textContent = eventItem.academicYear || "-"; $("vTerm").textContent = eventItem.term || "-"; $("vClass").textContent = eventItem.className || "Whole School"; $("vSection").textContent = eventItem.sectionName || "All Sections"; $("vStream").textContent = eventItem.streamName || "All Streams"; $("vDates").textContent = dateLabel(eventItem); $("vLocation").textContent = eventItem.location || "-"; $("vNotes").textContent = eventItem.notes || "-";
    $("viewEditBtn").style.display = eventItem.status === "archived" ? "none" : ""; $("viewArchiveBtn").style.display = eventItem.status === "archived" ? "none" : ""; openModal("mView");
  }
  function submitAction(url, confirmMsg) { if (confirmMsg && !window.confirm(confirmMsg)) return; const form = $("rowActionForm"); form.action = url; form.submit(); }
  function saveEvent() { if (!$("mTitle").value.trim()) return alert("Title is required."); if (!$("mType").value.trim()) return alert("Type is required."); if (!$("mStart").value.trim()) return alert("Start date is required."); const start = $("mStart").value, end = $("mEnd").value; if (start && end && end < start) return alert("End date cannot be before start date."); $("eventForm").submit(); }
  function submitBulkArchive() { const ids = Array.from(state.selected); if (!ids.length) return alert("Select at least one event."); if (!window.confirm(`Archive ${ids.length} event(s)?`)) return; $("bulkIdsField").value = ids.join(","); $("bulkForm").submit(); }

  $("btnCreate").addEventListener("click", () => openEditor()); $("quickDraft").addEventListener("click", () => openEditor(null, "draft")); $("quickActive").addEventListener("click", () => openEditor(null, "active")); $("btnImport").addEventListener("click", () => openModal("mImport")); $("btnPrint").addEventListener("click", () => window.print()); $("saveBtn").addEventListener("click", saveEvent);
  $("btnBulk").addEventListener("click", () => { if (!state.selected.size) return alert("Select at least one event."); $("bulkbar").classList.add("show"); }); $("bulkArchive").addEventListener("click", submitBulkArchive); $("bulkClear").addEventListener("click", () => { state.selected.clear(); renderTable(); });
  $("checkAll").addEventListener("change", (event) => { if (event.target.checked) EVENTS.forEach((ev) => state.selected.add(ev.id)); else EVENTS.forEach((ev) => state.selected.delete(ev.id)); renderTable(); });
  $("tbodyEvents").addEventListener("change", (event) => { if (!event.target.classList.contains("rowCheck")) return; const id = event.target.dataset.id; if (event.target.checked) state.selected.add(id); else state.selected.delete(id); renderTable(); });
  $("tbodyEvents").addEventListener("click", (event) => { const row = event.target.closest("tr[data-id]"); if (!row) return; const item = findEvent(row.dataset.id); if (!item) return; if (event.target.closest(".rowCheck")) return; if (event.target.closest(".actView")) return openView(item); if (event.target.closest(".actEdit")) return openEditor(item); if (event.target.closest(".actArchive")) return submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/archive`, "Archive this event?"); if (event.target.closest(".actDelete")) return submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/delete`, "Delete this never-published draft event?"); openView(item); });
  $("viewEditBtn").addEventListener("click", () => { const item = findEvent(state.currentViewId); if (!item) return; closeModal("mView"); openEditor(item); });
  $("viewArchiveBtn").addEventListener("click", () => { const item = findEvent(state.currentViewId); if (!item || item.status === "archived") return; submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/archive`, "Archive this event?"); });
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
  ["mEdit", "mView", "mImport"].forEach((id) => { const el = $(id); if (el) el.addEventListener("click", (event) => { if (event.target.id === id) closeModal(id); }); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show")); document.body.style.overflow = ""; } });
  renderTable();
})();

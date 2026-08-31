(function () {
  const $ = (id) => document.getElementById(id);

  function readJsonData(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.value || JSON.stringify(fallback));
    } catch (err) {
      console.error(`Failed to parse ${id}:`, err);
      return fallback;
    }
  }

  const EVENTS = readJsonData("eventsData", []);
  const TEMPLATES = readJsonData("eventTemplatesData", []);
  if (!$('tbody')) return;

  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view");
  const requestedEventId = params.get("event");
  const initialAttendanceId = EVENTS.some((event) => event.id === requestedEventId)
    ? requestedEventId
    : (EVENTS[0]?.id || null);

  const state = {
    view: ["list", "engagement", "attendance"].includes(requestedView) ? requestedView : "list",
    selected: new Set(),
    attendanceSourceEventId: initialAttendanceId,
  };

  function openModal(id) {
    const modal = $(id);
    if (modal) modal.classList.add("show");
  }

  function closeModal(id) {
    const modal = $(id);
    if (modal) modal.classList.remove("show");
  }

  function textElement(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null || value === "" ? "—" : String(value);
    return node;
  }

  function makePill(kind, iconClass, label) {
    const pill = document.createElement("span");
    pill.className = `pill ${kind}`;
    const icon = document.createElement("i");
    icon.className = iconClass;
    pill.append(icon, document.createTextNode(` ${label}`));
    return pill;
  }

  function makeActionButton(className, title, iconClass, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn-xs ${className}`;
    button.title = title;
    const icon = document.createElement("i");
    icon.className = iconClass;
    button.append(icon);
    if (label) button.append(document.createTextNode(` ${label}`));
    return button;
  }

  function appendEmptyRow(tbody, colSpan, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = colSpan;
    cell.style.padding = "18px";
    cell.append(textElement("div", "muted", message));
    row.append(cell);
    tbody.append(row);
  }

  function submitRowAction(actionUrl) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    form.submit();
  }

  function bulkSubmit(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return;
    $("bulkIds").value = ids.join(",");
    $("bulkActionInput").value = action;
    $("bulkForm").submit();
  }

  function statusPill(event) {
    if (event.status === "Published") return makePill("ok", "fa-solid fa-globe", "Published");
    if (event.status === "Scheduled") return makePill("info", "fa-solid fa-clock", "Scheduled");
    if (event.status === "Draft") return makePill("warn", "fa-solid fa-pen-to-square", "Draft");
    return makePill("bad", "fa-solid fa-ban", "Cancelled");
  }

  function priorityPill(event) {
    return event.featured
      ? makePill("pin", "fa-solid fa-star", "Featured")
      : makePill("info", "fa-regular fa-star", "Normal");
  }

  function syncBulkbar() {
    $("selCount").textContent = state.selected.size;
    $("bulkbar").classList.toggle("show", state.selected.size > 0 && state.view === "list");
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll("#viewChips .chip").forEach((button) => button.classList.remove("active"));
    document.querySelector(`#viewChips .chip[data-view="${view}"]`)?.classList.add("active");

    $("view-list").style.display = view === "list" ? "" : "none";
    $("view-engagement").style.display = view === "engagement" ? "" : "none";
    $("view-attendance").style.display = view === "attendance" ? "" : "none";

    const titles = {
      list: ["Events", "Manage events, schedules, registrations and attendance."],
      engagement: ["Engagement", "Views, registrations, check-ins and attendance rates."],
      attendance: ["Attendance", "Track who registered and checked in."],
    };
    $("panelTitle").textContent = titles[view][0];
    $("panelSub").textContent = titles[view][1];
    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${EVENTS.length} event(s)`;
    $("checkAll").checked = EVENTS.length > 0 && EVENTS.every((event) => state.selected.has(event.id));

    const tbody = $("tbody");
    tbody.replaceChildren();
    if (!EVENTS.length) return appendEmptyRow(tbody, 8, "No events found.");

    EVENTS.forEach((event) => {
      const row = document.createElement("tr");
      row.dataset.id = event.id;

      const selectCell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "rowCheck";
      checkbox.dataset.id = event.id;
      checkbox.checked = state.selected.has(event.id);
      selectCell.append(checkbox);

      const eventCell = document.createElement("td");
      eventCell.append(textElement("div", "strong", event.title || "—"));
      const priorityWrap = document.createElement("div");
      priorityWrap.className = "muted";
      priorityWrap.append(priorityPill(event));
      eventCell.append(priorityWrap);

      const typeCell = document.createElement("td");
      typeCell.append(makePill("info", "fa-solid fa-tag", event.type || "General"));

      const audienceCell = document.createElement("td");
      audienceCell.append(
        textElement("div", "strong", event.audType || "Open Event"),
        textElement("div", "muted", event.audVal || "—")
      );

      const dateCell = document.createElement("td");
      dateCell.append(
        textElement("div", "strong", event.startAt || "—"),
        textElement("div", "muted", event.endAt || "—")
      );

      const venueCell = textElement("td", "", event.venue || "—");
      const statusCell = document.createElement("td");
      statusCell.append(statusPill(event));

      const actionCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.append(
        makeActionButton("actView", "View", "fa-solid fa-eye"),
        makeActionButton("actEdit", "Edit", "fa-solid fa-pen"),
        makeActionButton("actAttendance", "Attendance", "fa-solid fa-user-check"),
        makeActionButton("actPublish", "Publish", "fa-solid fa-globe"),
        makeActionButton("actCancel", "Cancel", "fa-solid fa-ban"),
        makeActionButton("actDelete", "Delete", "fa-solid fa-trash")
      );
      actionCell.append(actions);

      row.append(selectCell, eventCell, typeCell, audienceCell, dateCell, venueCell, statusCell, actionCell);
      tbody.append(row);
    });
  }

  function renderEngagement() {
    $("resultMeta").textContent = `${EVENTS.length} event(s)`;
    const tbody = $("tbodyEng");
    tbody.replaceChildren();
    if (!EVENTS.length) return appendEmptyRow(tbody, 6, "No engagement data found.");

    EVENTS.forEach((event) => {
      const capacity = Number(event.stats?.capacity || 0);
      const checkIns = Number(event.stats?.checkIns || 0);
      const attendancePercent = capacity > 0 ? Math.round((checkIns / capacity) * 100) : 0;
      const row = document.createElement("tr");

      const eventCell = document.createElement("td");
      eventCell.append(
        textElement("div", "strong", event.title || "—"),
        textElement("div", "muted", event.type || "General")
      );

      const viewsCell = document.createElement("td");
      viewsCell.append(makePill("info", "fa-solid fa-eye", String(Number(event.stats?.views || 0))));
      const registrationsCell = document.createElement("td");
      registrationsCell.append(makePill("info", "fa-solid fa-user-plus", String(Number(event.stats?.registrations || 0))));
      const checkInsCell = document.createElement("td");
      checkInsCell.append(makePill("info", "fa-solid fa-user-check", String(checkIns)));
      const capacityCell = document.createElement("td");
      capacityCell.append(makePill("info", "fa-solid fa-users", String(capacity)));
      const rateCell = document.createElement("td");
      rateCell.append(makePill(attendancePercent >= 50 ? "ok" : "warn", "fa-solid fa-chart-pie", `${attendancePercent}%`));

      row.append(eventCell, viewsCell, registrationsCell, checkInsCell, capacityCell, rateCell);
      tbody.append(row);
    });
  }

  function getCurrentAttendanceSource() {
    return EVENTS.find((event) => event.id === state.attendanceSourceEventId) || EVENTS[0] || null;
  }

  function renderAttendance() {
    const source = getCurrentAttendanceSource();
    const query = ($("rSearch").value || "").trim().toLowerCase();
    const filter = $("rFilter").value;
    const list = ((source && source.attendance) || []).filter((registration) => {
      const haystack = `${registration.user || ""} ${registration.email || ""} ${registration.role || ""} ${registration.status || ""}`.toLowerCase();
      return (!query || haystack.includes(query)) && (filter === "all" || registration.status === filter);
    });

    $("resultMeta").textContent = source ? `${list.length} attendee(s) • ${source.title || "Event"}` : "0 attendee(s)";
    const tbody = $("tbodyRec");
    tbody.replaceChildren();
    if (!source || !list.length) return appendEmptyRow(tbody, 6, "No attendance records for this event.");

    list.forEach((registration) => {
      const row = document.createElement("tr");
      row.dataset.registrationId = registration.id;

      const personCell = document.createElement("td");
      personCell.append(
        textElement("div", "strong", registration.user || "—"),
        textElement("div", "muted", registration.email || "—")
      );
      const roleCell = document.createElement("td");
      roleCell.append(makePill("info", "fa-solid fa-id-badge", registration.role || "—"));
      const statusKind = registration.status === "Checked In" ? "ok" : (registration.status === "Registered" ? "info" : "warn");
      const statusCell = document.createElement("td");
      statusCell.append(makePill(statusKind, "fa-solid fa-circle", registration.status || "Absent"));
      const registeredAtCell = textElement("td", "muted", registration.registeredAt || "—");
      const checkedAtCell = textElement("td", "muted", registration.checkedInAt || "—");
      const actionCell = document.createElement("td");
      if (registration.status === "Registered") {
        const button = makeActionButton("actCheckIn", "Check in attendee", "fa-solid fa-user-check", "Check In");
        button.dataset.registrationId = registration.id;
        actionCell.append(button);
      } else {
        actionCell.append(textElement("span", "muted", "—"));
      }
      row.append(personCell, roleCell, statusCell, registeredAtCell, checkedAtCell, actionCell);
      tbody.append(row);
    });
  }

  function renderTemplates() {
    const tbody = $("eventTemplatesBody");
    if (!tbody) return;
    tbody.replaceChildren();
    if (!TEMPLATES.length) return appendEmptyRow(tbody, 4, "No saved event templates yet.");

    TEMPLATES.forEach((template) => {
      const row = document.createElement("tr");
      row.dataset.templateId = template.id;
      const nameCell = document.createElement("td");
      nameCell.append(
        textElement("div", "strong", template.name || "—"),
        textElement("div", "muted", template.title || "—")
      );
      const typeCell = document.createElement("td");
      typeCell.append(makePill("info", "fa-solid fa-tag", template.type || "General"));
      const audienceCell = document.createElement("td");
      audienceCell.append(
        textElement("div", "strong", template.audienceType || "Open Event"),
        textElement("div", "muted", template.audienceValue || "—")
      );
      const actionCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.append(
        makeActionButton("useTemplate", "Use template", "fa-solid fa-wand-magic-sparkles", "Use"),
        makeActionButton("deleteTemplate", "Delete template", "fa-solid fa-trash")
      );
      actionCell.append(actions);
      row.append(nameCell, typeCell, audienceCell, actionCell);
      tbody.append(row);
    });
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "engagement") renderEngagement();
    if (state.view === "attendance") renderAttendance();
  }

  function openEditor(pref, options = {}) {
    const fromTemplate = options.fromTemplate === true;
    const editingEvent = Boolean(pref?.id && !fromTemplate);
    $("mTitle").textContent = editingEvent ? "Edit Event" : "Create Event";
    const form = $("eventForm");
    form.action = editingEvent ? `/admin/events/${encodeURIComponent(pref.id)}/update` : "/admin/events";

    $("eTitle").value = pref ? (pref.title || "") : "";
    $("eType").value = pref ? (pref.type || "General") : "General";
    $("ePriority").value = pref ? (pref.featured || pref.priority === "Featured" ? "Featured" : "Normal") : "Normal";
    $("eAudienceType").value = pref ? (pref.audType || pref.audienceType || "Open Event") : "Open Event";
    const audienceValue = pref ? (pref.audVal ?? pref.audienceValue ?? "") : "";
    $("eAudienceValue").value = audienceValue === "—" ? "" : audienceValue;
    $("eVenue").value = pref ? (pref.venue || "") : "";
    $("eStartAt").value = editingEvent && pref.startAtRaw ? pref.startAtRaw : "";
    $("eEndAt").value = editingEvent && pref.endAtRaw ? pref.endAtRaw : "";
    $("eCapacity").value = pref ? (pref.capacity || "") : "";
    $("eBody").value = pref ? (pref.description || "") : "";
    $("ePublishMode").value = editingEvent
      ? (pref.status === "Draft" ? "Save as Draft" : (pref.status === "Scheduled" ? "Schedule" : "Publish Now"))
      : "Publish Now";
    $("eScheduleAt").value = editingEvent && pref.scheduleAtRaw ? pref.scheduleAtRaw : "";
    $("eRegistrationDeadline").value = editingEvent && pref.registrationDeadlineRaw ? pref.registrationDeadlineRaw : "";
    $("charCount").textContent = `${$("eBody").value.length} / 5000`;
    openModal("mEdit");
  }

  function openViewModal(event) {
    if (!event) return;
    $("vTitle").textContent = event.title || "—";
    $("vType").textContent = event.type || "General";
    $("vAudience").textContent = event.audType || "Open Event";
    $("vAudienceValue").textContent = event.audVal || "—";
    $("vStatus").textContent = event.status || "—";
    $("vPriority").textContent = event.featured ? "Featured" : "Normal";
    $("vVenue").textContent = event.venue || "—";
    $("vStart").textContent = event.startAt || "—";
    $("vEnd").textContent = event.endAt || "—";
    $("vCapacity").textContent = event.capacity || "—";
    $("vBody").textContent = event.description || "—";
    openModal("mView");
  }

  $("btnCreate").addEventListener("click", () => openEditor());
  $("quickSeminar").addEventListener("click", () => { openEditor(); $("eType").value = "Seminar"; $("eTitle").value = "Seminar Event"; });
  $("quickSports").addEventListener("click", () => { openEditor(); $("eType").value = "Sports"; $("eTitle").value = "Sports Event"; });
  $("quickConference").addEventListener("click", () => { openEditor(); $("eType").value = "Conference"; $("eTitle").value = "Conference Event"; $("ePriority").value = "Featured"; });

  $("viewChips").addEventListener("click", (event) => {
    const button = event.target.closest(".chip");
    if (button) setView(button.dataset.view);
  });

  $("checkAll").addEventListener("change", (event) => {
    if (event.target.checked) EVENTS.forEach((item) => state.selected.add(item.id));
    else state.selected.clear();
    render();
  });

  $("tbody").addEventListener("change", (event) => {
    if (!event.target.classList.contains("rowCheck")) return;
    const id = event.target.dataset.id;
    if (event.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    render();
  });

  $("tbody").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;
    const item = EVENTS.find((entry) => entry.id === row.dataset.id);
    if (!item) return;
    if (event.target.closest(".actView")) return openViewModal(item);
    if (event.target.closest(".actEdit")) return openEditor(item);
    if (event.target.closest(".actAttendance")) { state.attendanceSourceEventId = item.id; return setView("attendance"); }
    if (event.target.closest(".actPublish")) return submitRowAction(`/admin/events/${encodeURIComponent(item.id)}/publish`);
    if (event.target.closest(".actCancel")) return submitRowAction(`/admin/events/${encodeURIComponent(item.id)}/cancel`);
    if (event.target.closest(".actDelete") && window.confirm(`Delete "${item.title}"?`)) {
      return submitRowAction(`/admin/events/${encodeURIComponent(item.id)}/delete`);
    }
  });

  $("tbodyRec").addEventListener("click", (event) => {
    const button = event.target.closest(".actCheckIn[data-registration-id]");
    if (!button) return;
    const source = getCurrentAttendanceSource();
    if (!source) return;
    submitRowAction(`/admin/events/${encodeURIComponent(source.id)}/registrations/${encodeURIComponent(button.dataset.registrationId)}/check-in`);
  });

  $("eventTemplatesBody")?.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-template-id]");
    if (!row) return;
    const template = TEMPLATES.find((item) => item.id === row.dataset.templateId);
    if (!template) return;
    if (event.target.closest(".useTemplate")) {
      closeModal("mTemplates");
      return openEditor(template, { fromTemplate: true });
    }
    if (event.target.closest(".deleteTemplate") && window.confirm(`Delete template "${template.name}"?`)) {
      return submitRowAction(`/admin/events/templates/${encodeURIComponent(template.id)}/delete`);
    }
  });

  $("btnBulk").addEventListener("click", () => {
    if (!state.selected.size) return alert("Select at least one event.");
    $("bulkbar").classList.add("show");
  });
  $("bulkClear").addEventListener("click", () => { state.selected.clear(); render(); });
  $("bulkPublish").addEventListener("click", () => bulkSubmit("publish"));
  $("bulkCancel").addEventListener("click", () => bulkSubmit("cancel"));
  $("bulkFeature").addEventListener("click", () => bulkSubmit("feature"));
  $("bulkUnfeature").addEventListener("click", () => bulkSubmit("unfeature"));

  $("eBody").addEventListener("input", () => {
    const length = $("eBody").value.length;
    $("charCount").textContent = `${length} / 5000`;
    $("charCount").style.color = length > 5000 ? "#b91c1c" : "";
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });
  ["mEdit", "mView", "mTemplates"].forEach((id) => {
    const modal = $(id);
    if (modal) modal.addEventListener("click", (event) => { if (event.target.id === id) closeModal(id); });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((modal) => modal.classList.remove("show"));
  });

  $("rSearch").addEventListener("input", render);
  $("rFilter").addEventListener("change", render);

  $("btnExport").addEventListener("click", () => {
    const query = new URLSearchParams(window.location.search);
    query.delete("view");
    query.delete("event");
    window.location.assign(`/admin/events/export.csv${query.toString() ? `?${query}` : ""}`);
  });
  $("btnTemplates").addEventListener("click", () => { renderTemplates(); openModal("mTemplates"); });
  $("btnSettings").addEventListener("click", () => window.location.assign("/admin/settings?tab=communication"));
  $("btnRemind").addEventListener("click", () => {
    const source = getCurrentAttendanceSource();
    if (!source) return alert("Choose an event first.");
    const form = $("reminderForm");
    form.action = `/admin/events/${encodeURIComponent(source.id)}/remind`;
    form.submit();
  });

  setView(state.view);
})();

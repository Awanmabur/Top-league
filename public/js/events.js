(function () {
  const $ = (id) => document.getElementById(id);

  function readEventsData() {
    const el = $("eventsData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse events data:", err);
      return [];
    }
  }

  const EVENTS = readEventsData();
  if (!$("tbody")) return;

  const state = {
    view: "list",
    selected: new Set(),
    attendanceSourceEventId: EVENTS[0]?.id || null
  };

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("show");
  }

  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("show");
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

  function pillStatus(e) {
    if (e.status === "Published") return '<span class="pill ok"><i class="fa-solid fa-globe"></i> Published</span>';
    if (e.status === "Scheduled") return '<span class="pill info"><i class="fa-solid fa-clock"></i> Scheduled</span>';
    if (e.status === "Draft") return '<span class="pill warn"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
    return '<span class="pill bad"><i class="fa-solid fa-ban"></i> Cancelled</span>';
  }

  function pillPriority(e) {
    return e.featured
      ? '<span class="pill pin"><i class="fa-solid fa-star"></i> Featured</span>'
      : '<span class="pill info"><i class="fa-regular fa-star"></i> Normal</span>';
  }

  function syncBulkbar() {
    $("selCount").textContent = state.selected.size;
    $("bulkbar").classList.toggle("show", state.selected.size > 0 && state.view === "list");
  }

  function setView(v) {
    state.view = v;
    document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.remove("active"));
    const activeBtn = document.querySelector(`#viewChips .chip[data-view="${v}"]`);
    if (activeBtn) activeBtn.classList.add("active");

    $("view-list").style.display = v === "list" ? "" : "none";
    $("view-engagement").style.display = v === "engagement" ? "" : "none";
    $("view-attendance").style.display = v === "attendance" ? "" : "none";

    const titles = {
      list: ["Events", "Manage events, schedules, registrations and attendance."],
      engagement: ["Engagement", "Views, registrations, check-ins and attendance rates."],
      attendance: ["Attendance", "Track who registered and checked in."]
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${EVENTS.length} event(s)`;
    $("checkAll").checked = EVENTS.length > 0 && EVENTS.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = EVENTS.map((e) => {
      const checked = state.selected.has(e.id) ? "checked" : "";
      return `
        <tr data-id="${e.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${e.id}" ${checked}></td>
          <td>
            <div class="strong">${e.title || ""}</div>
            <div class="muted">${pillPriority(e)}</div>
          </td>
          <td><span class="pill info"><i class="fa-solid fa-tag"></i> ${e.type || "General"}</span></td>
          <td>
            <div class="strong">${e.audType || "Open Event"}</div>
            <div class="muted">${e.audVal || "—"}</div>
          </td>
          <td>
            <div class="strong">${e.startAt || "—"}</div>
            <div class="muted">${e.endAt || "—"}</div>
          </td>
          <td>${e.venue || "—"}</td>
          <td>${pillStatus(e)}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-xs actAttendance" type="button" title="Attendance"><i class="fa-solid fa-user-check"></i></button>
              <button class="btn-xs actPublish" type="button" title="Publish"><i class="fa-solid fa-globe"></i></button>
              <button class="btn-xs actCancel" type="button" title="Cancel"><i class="fa-solid fa-ban"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="8" style="padding:18px;"><div class="muted">No events found.</div></td></tr>';
  }

  function renderEng() {
    $("resultMeta").textContent = `${EVENTS.length} event(s)`;
    $("tbodyEng").innerHTML = EVENTS.map((e) => {
      const cap = Number(e.stats?.capacity || 0);
      const checkIns = Number(e.stats?.checkIns || 0);
      const pct = cap > 0 ? Math.round((checkIns / cap) * 100) : 0;
      return `
        <tr>
          <td><div class="strong">${e.title || ""}</div><div class="muted">${e.type || "General"}</div></td>
          <td><span class="pill info"><i class="fa-solid fa-eye"></i> ${Number(e.stats?.views || 0)}</span></td>
          <td><span class="pill info"><i class="fa-solid fa-user-plus"></i> ${Number(e.stats?.registrations || 0)}</span></td>
          <td><span class="pill info"><i class="fa-solid fa-user-check"></i> ${checkIns}</span></td>
          <td><span class="pill info"><i class="fa-solid fa-users"></i> ${cap}</span></td>
          <td><span class="pill ${pct >= 50 ? "ok" : "warn"}"><i class="fa-solid fa-chart-pie"></i> ${pct}%</span></td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="6" style="padding:18px;"><div class="muted">No engagement data found.</div></td></tr>';
  }

  function getCurrentAttendanceSource() {
    return EVENTS.find((x) => x.id === state.attendanceSourceEventId) || EVENTS[0] || null;
  }

  function renderAttendance() {
    const source = getCurrentAttendanceSource();
    const q = ($("rSearch").value || "").trim().toLowerCase();
    const f = $("rFilter").value;

    const list = ((source && source.attendance) || []).filter((r) => {
      const text = `${r.user || ""} ${r.email || ""} ${r.role || ""} ${r.status || ""}`.toLowerCase();
      const mq = !q || text.includes(q);
      const mf = f === "all" || r.status === f;
      return mq && mf;
    });

    $("resultMeta").textContent = `${list.length} attendee(s)`;
    $("tbodyRec").innerHTML = list.map((r) => {
      const st = r.status === "Checked In" ? "ok" : (r.status === "Registered" ? "info" : "warn");
      return `
        <tr>
          <td><div class="strong">${r.user || "—"}</div><div class="muted">${r.email || "—"}</div></td>
          <td><span class="pill info"><i class="fa-solid fa-id-badge"></i> ${r.role || "—"}</span></td>
          <td><span class="pill ${st}"><i class="fa-solid fa-circle"></i> ${r.status || "Absent"}</span></td>
          <td class="muted">${r.registeredAt || "—"}</td>
          <td class="muted">${r.checkedInAt || "—"}</td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="5" style="padding:18px;"><div class="muted">No attendance records for this event.</div></td></tr>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "engagement") renderEng();
    if (state.view === "attendance") renderAttendance();
  }

  function openEditor(pref) {
    pref = pref || null;

    $("mTitle").textContent = pref ? "Edit Event" : "Create Event";
    const form = $("eventForm");
    form.action = pref ? `/admin/events/${pref.id}/update` : "/admin/events";

    $("eTitle").value = pref ? (pref.title || "") : "";
    $("eType").value = pref ? (pref.type || "General") : "General";
    $("ePriority").value = pref && pref.featured ? "Featured" : "Normal";
    $("eAudienceType").value = pref ? (pref.audType || "Open Event") : "Open Event";
    $("eAudienceValue").value = pref ? (pref.audVal || "") : "";
    $("eVenue").value = pref ? (pref.venue || "") : "";
    $("eStartAt").value = pref && pref.startAtRaw ? pref.startAtRaw : "";
    $("eEndAt").value = pref && pref.endAtRaw ? pref.endAtRaw : "";
    $("eCapacity").value = pref ? (pref.capacity || "") : "";
    $("eBody").value = pref ? (pref.description || "") : "";
    $("ePublishMode").value = pref
      ? (pref.status === "Draft" ? "Save as Draft" : (pref.status === "Scheduled" ? "Schedule" : "Publish Now"))
      : "Publish Now";
    $("eScheduleAt").value = pref && pref.scheduleAtRaw ? pref.scheduleAtRaw : "";
    $("eRegistrationDeadline").value = pref && pref.registrationDeadlineRaw ? pref.registrationDeadlineRaw : "";
    $("charCount").textContent = `${$("eBody").value.length} / 5000`;

    openModal("mEdit");
  }

  function openViewModal(e) {
    if (!e) return;
    $("vTitle").textContent = e.title || "—";
    $("vType").textContent = e.type || "General";
    $("vAudience").textContent = e.audType || "Open Event";
    $("vAudienceValue").textContent = e.audVal || "—";
    $("vStatus").textContent = e.status || "—";
    $("vPriority").textContent = e.featured ? "Featured" : "Normal";
    $("vVenue").textContent = e.venue || "—";
    $("vStart").textContent = e.startAt || "—";
    $("vEnd").textContent = e.endAt || "—";
    $("vCapacity").textContent = e.capacity || "—";
    $("vBody").textContent = e.description || "—";
    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () { openEditor(); });

  $("quickSeminar").addEventListener("click", function () {
    openEditor();
    $("eType").value = "Seminar";
    $("eTitle").value = "Seminar Event";
  });

  $("quickSports").addEventListener("click", function () {
    openEditor();
    $("eType").value = "Sports";
    $("eTitle").value = "Sports Event";
  });

  $("quickConference").addEventListener("click", function () {
    openEditor();
    $("eType").value = "Conference";
    $("eTitle").value = "Conference Event";
    $("ePriority").value = "Featured";
  });

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) EVENTS.forEach((x) => state.selected.add(x.id));
    else EVENTS.forEach((x) => state.selected.delete(x.id));
    render();
  });

  $("tbody").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
    render();
  });

  $("tbody").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const item = EVENTS.find((x) => x.id === tr.dataset.id);
    if (!item) return;

    if (e.target.closest(".actView")) return openViewModal(item);
    if (e.target.closest(".actEdit")) return openEditor(item);
    if (e.target.closest(".actAttendance")) {
      state.attendanceSourceEventId = item.id;
      return setView("attendance");
    }
    if (e.target.closest(".actPublish")) return submitRowAction(`/admin/events/${item.id}/publish`);
    if (e.target.closest(".actCancel")) return submitRowAction(`/admin/events/${item.id}/cancel`);
    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete "${item.title}"?`)) {
        return submitRowAction(`/admin/events/${item.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one event.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkPublish").addEventListener("click", function () { bulkSubmit("publish"); });
  $("bulkCancel").addEventListener("click", function () { bulkSubmit("cancel"); });
  $("bulkFeature").addEventListener("click", function () { bulkSubmit("feature"); });
  $("bulkUnfeature").addEventListener("click", function () { bulkSubmit("unfeature"); });

  $("eBody").addEventListener("input", function () {
    const n = $("eBody").value.length;
    $("charCount").textContent = `${n} / 5000`;
    $("charCount").style.color = n > 5000 ? "#b91c1c" : "";
  });

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () { closeModal(btn.dataset.closeModal); });
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
    }
  });

  $("rSearch").addEventListener("input", render);
  $("rFilter").addEventListener("change", render);

  $("btnExport").addEventListener("click", function () { alert("Hook export route later."); });
  $("btnTemplates").addEventListener("click", function () { alert("Hook templates route later."); });
  $("btnSettings").addEventListener("click", function () { alert("Hook settings route later."); });
  $("btnRemind").addEventListener("click", function () { alert("Hook reminder/send-notification logic later."); });

  setView("list");
  render();
})();
// ../assets/scheduler.js
(() => {
  const root = document.getElementById("schedulerApp");
  if (!root) return;

  const $ = (id) => root.querySelector("#" + id);

  // Controls
  const productEl = $("product");
  const purposeEl = $("purpose");
  const durationEl = $("duration");

  // Calendar
  const monthTitle = $("monthTitle");
  const daysEl = $("days");
  const colPill = $("colPill");
  const prevMonthBtn = $("prevMonth");
  const nextMonthBtn = $("nextMonth");
  const tzPill = $("tzPill");

  // Middle
  const slotsEl = $("slots");
  const slotSub = $("slotSub");
  const slotHint = $("slotHint");
  const refreshBtn = $("refresh");

  // Tabs / panes
  const tabOverview = $("tabOverview");
  const tabSchedule = $("tabSchedule");
  const tabAgenda = $("tabAgenda");
  const paneOverview = $("paneOverview");
  const paneSchedule = $("paneSchedule");
  const paneAgenda = $("paneAgenda");

  const ovMeta = $("ovMeta");
  const ovWhen = $("ovWhen");
  const ovTz = $("ovTz");
  const agendaNotes = $("agendaNotes");

  // Right
  const form = $("form");
  const fieldsWrap = $("fieldsWrap");
  const bookBtn = $("bookBtn");
  const statusEl = $("status");
  const successBox = $("success");
  const successText = $("successText");
  const zoomJoin = $("zoomJoin");
  const gcalLink = $("gcalLink");
  const bookAnother = $("bookAnother");

  const sumDate = $("sumDate");
  const sumTime = $("sumTime");
  const sumTz = $("sumTz");
  const sumDur = $("sumDur");
  const sumMeta = $("sumMeta");

  // View month
  let view = (() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  })();

  // State
  let state = {
    timezone: "Africa/Kampala",
    selectedDate: null,
    selectedTime: null,
    durationMin: Number(durationEl.value),
    booked: false,
    joinUrl: null,
    calendarUrl: null
  };

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("error", !!isError);
  }

  function fmtMonthTitle(year, month) {
    const dt = new Date(year, month - 1, 1);
    return dt.toLocaleString(undefined, { month: "long", year: "numeric" });
  }

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function fmtPrettyDate(iso) {
    try {
      const [y, m, d] = iso.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    } catch { return iso; }
  }

  function tzOffsetLabel(timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
        .formatToParts(new Date());
      const tz = parts.find(p => p.type === "timeZoneName")?.value || "";
      return tz.replace("UTC", "GMT");
    } catch { return "GMT+3"; }
  }

  function switchTab(which) {
    [tabOverview, tabSchedule, tabAgenda].forEach(t => t.classList.remove("active"));
    [paneOverview, paneSchedule, paneAgenda].forEach(p => p.classList.remove("active"));

    if (which === "overview") {
      tabOverview.classList.add("active");
      paneOverview.classList.add("active");
    } else if (which === "agenda") {
      tabAgenda.classList.add("active");
      paneAgenda.classList.add("active");
    } else {
      tabSchedule.classList.add("active");
      paneSchedule.classList.add("active");
    }
  }

  tabOverview.addEventListener("click", () => switchTab("overview"));
  tabSchedule.addEventListener("click", () => switchTab("schedule"));
  tabAgenda.addEventListener("click", () => switchTab("agenda"));

  function renderSummary() {
    tzPill.textContent = state.timezone;
    sumTz.textContent = tzOffsetLabel(state.timezone);

    sumMeta.textContent = `${productEl.value} • ${purposeEl.value}`;
    sumDur.textContent = `${state.durationMin} min`;

    sumDate.textContent = state.selectedDate ? fmtPrettyDate(state.selectedDate) : "—";
    sumTime.textContent = state.selectedTime ? state.selectedTime : "—";

    ovMeta.textContent = `${productEl.value} • ${purposeEl.value} • ${state.durationMin} min`;
    ovWhen.textContent = (state.selectedDate && state.selectedTime)
      ? `${fmtPrettyDate(state.selectedDate)} • ${state.selectedTime}`
      : "—";
    ovTz.textContent = `${state.timezone} (${tzOffsetLabel(state.timezone)})`;

    bookBtn.disabled = !(state.selectedDate && state.selectedTime) || state.booked;
  }

  function clearSlots(message) {
    slotsEl.innerHTML = "";
    slotHint.textContent = message || "";
    state.selectedTime = null;
    renderSummary();
  }

  async function apiGet(path, params = {}) {
    const url = new URL(path, window.location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString());
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function apiPost(path, body) {
    const url = new URL(path, window.location.origin);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function shiftMonth(delta) {
    const m = view.month + delta;
    if (m < 1) { view.month = 12; view.year -= 1; }
    else if (m > 12) { view.month = 1; view.year += 1; }
    else view.month = m;
  }

  function setColumnPillForDate(iso) {
    if (!iso) { colPill.style.opacity = 0; return; }

    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const colIndex = dt.getDay();

    const gapStr = getComputedStyle(daysEl).gap || "12px";
    const gap = parseFloat(gapStr.split(" ")[0]) || 12;

    const wrap = daysEl.parentElement;
    const innerWidth = wrap.clientWidth - 36;
    const colW = (innerWidth - gap * 6) / 7;

    colPill.style.width = colW + "px";
    colPill.style.opacity = 1;
    colPill.style.transform = `translateX(${colIndex * (colW + gap)}px)`;
  }
  window.addEventListener("resize", () => setColumnPillForDate(state.selectedDate));

  async function fetchMonthAvailability() {
    state.durationMin = Number(durationEl.value);
    monthTitle.textContent = fmtMonthTitle(view.year, view.month);
    daysEl.innerHTML = "";

    if (!state.booked) {
      clearSlots("Select an available day to see times.");
      slotSub.textContent = "Pick a time";
    }
    setStatus("");

    const { data } = await apiGet("/api/month-availability", {
      year: view.year,
      month: view.month,
      duration: state.durationMin
    });

    if (!data.ok) {
      setStatus(data.message || "Failed to load calendar", true);
      return;
    }

    state.timezone = data.timezone || "Africa/Kampala";
    renderSummary();

    const dayMap = new Map((data.days || []).map(d => [d.date, d]));
    const first = new Date(view.year, view.month - 1, 1);
    const daysInMonth = new Date(view.year, view.month, 0).getDate();
    const startOffset = first.getDay();
    const tIso = todayIso();

    for (let i = 0; i < startOffset; i++) {
      const blank = document.createElement("div");
      blank.className = "blank";
      daysEl.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${view.year}-${String(view.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const info = dayMap.get(iso) || { availableSlots: 0, status: "booked" };
      const status = info.status || (Number(info.availableSlots || 0) > 0 ? "available" : "booked");

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day";
      cell.textContent = String(d);

      if (status === "past") cell.classList.add("disabled", "past");
      else if (status === "available") cell.classList.add("avail");
      else cell.classList.add("booked");

      if (iso === tIso) cell.classList.add("today");

      const dot = document.createElement("span");
      dot.className = "mini";
      cell.appendChild(dot);

      if (state.selectedDate === iso) {
        cell.classList.add("selected");
        setColumnPillForDate(iso);
      }

      cell.addEventListener("click", async () => {
        if (status === "past") return;

        if (state.booked) {
          state.selectedDate = iso;
          setColumnPillForDate(iso);
          root.querySelectorAll(".day").forEach(x => x.classList.remove("selected"));
          cell.classList.add("selected");
          renderSummary();
          return;
        }

        root.querySelectorAll(".day").forEach(x => x.classList.remove("selected"));
        cell.classList.add("selected");

        state.selectedDate = iso;
        state.selectedTime = null;
        setColumnPillForDate(iso);
        renderSummary();

        switchTab("schedule");

        if (status !== "available") {
          clearSlots("This day is fully booked.");
          slotHint.textContent = `No times available for ${fmtPrettyDate(iso)}.`;
          return;
        }

        slotHint.textContent = `Available times for ${fmtPrettyDate(iso)}:`;
        await loadDaySlots();
      });

      daysEl.appendChild(cell);
    }

    if (!state.selectedDate) setColumnPillForDate(null);
  }

  async function loadDaySlots() {
    if (!state.selectedDate) return;

    clearSlots("Loading times…");
    setStatus("");

    const { data } = await apiGet("/api/availability", {
      date: state.selectedDate,
      duration: state.durationMin
    });

    if (!data.ok) {
      setStatus(data.message || "Failed to load times", true);
      clearSlots("Could not load times.");
      return;
    }

    state.timezone = data.timezone || state.timezone;
    renderSummary();

    const slots = data.slots || [];
    slotsEl.innerHTML = "";

    if (!slots.length) {
      clearSlots("No times available for this day.");
      slotHint.textContent = `No times available for ${fmtPrettyDate(state.selectedDate)}.`;
      return;
    }

    slotHint.textContent = `Choose a time for ${fmtPrettyDate(state.selectedDate)}:`;

    slots.forEach(s => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      btn.textContent = s.time;

      btn.addEventListener("click", () => {
        root.querySelectorAll(".slot").forEach(x => x.classList.remove("active"));
        btn.classList.add("active");
        state.selectedTime = s.time;
        setStatus("");
        renderSummary();
      });

      slotsEl.appendChild(btn);
    });
  }

  function setBookedUI(data) {
    state.booked = true;
    state.joinUrl = data.zoom?.join_url || null;
    state.calendarUrl = data.calendar?.htmlLink || null;

    fieldsWrap.style.display = "none";
    successBox.style.display = "block";
    successText.textContent = "You’re booked. Use Join Zoom when it’s time, or open the Calendar invite.";

    zoomJoin.href = state.joinUrl || "#";
    gcalLink.href = state.calendarUrl || "#";

    bookBtn.disabled = !state.joinUrl;
    bookBtn.type = "button";
    bookBtn.innerHTML = `Join Meeting <span aria-hidden="true">›</span>`;
    bookBtn.onclick = () => {
      if (state.joinUrl) window.open(state.joinUrl, "_blank", "noopener,noreferrer");
    };

    setStatus("Booked ✅");
    renderSummary();
  }

  function resetBookingUI() {
    state.booked = false;
    state.joinUrl = null;
    state.calendarUrl = null;

    fieldsWrap.style.display = "";
    successBox.style.display = "none";

    bookBtn.type = "submit";
    bookBtn.onclick = null;
    bookBtn.innerHTML = `Book Appointment <span aria-hidden="true">›</span>`;

    setStatus("");
    renderSummary();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.booked) return;
    if (!state.selectedDate || !state.selectedTime) return;

    setStatus("Booking…");
    bookBtn.disabled = true;

    const payload = {
      date: state.selectedDate,
      time: state.selectedTime,
      durationMin: state.durationMin,
      product: productEl.value,
      purpose: purposeEl.value,
      company: $("company").value.trim(),
      name: $("name").value.trim(),
      email: $("email").value.trim(),
      phone: $("phone").value.trim(),
      notes: ($("notes").value.trim() || agendaNotes.value.trim()),
      hp: $("hp").value
    };

    const { res, data } = await apiPost("/api/book", payload);

    if (!data.ok) {
      setStatus(data.message || "Booking failed", true);
      bookBtn.disabled = false;
      if (res.status === 409) await fetchMonthAvailability();
      return;
    }

    setBookedUI(data);
  });

  bookAnother.addEventListener("click", () => {
    resetBookingUI();
    clearSlots("Select an available day to see times.");
    slotHint.textContent = "Select an available day to see times.";
  });

  refreshBtn.addEventListener("click", async () => {
    if (state.booked) return;
    if (state.selectedDate) await loadDaySlots();
    else await fetchMonthAvailability();
  });

  prevMonthBtn.addEventListener("click", async () => {
    shiftMonth(-1);
    if (!state.booked) {
      state.selectedDate = null;
      state.selectedTime = null;
    }
    await fetchMonthAvailability();
  });

  nextMonthBtn.addEventListener("click", async () => {
    shiftMonth(1);
    if (!state.booked) {
      state.selectedDate = null;
      state.selectedTime = null;
    }
    await fetchMonthAvailability();
  });

  durationEl.addEventListener("change", async () => {
    state.durationMin = Number(durationEl.value);
    if (!state.booked) {
      state.selectedDate = null;
      state.selectedTime = null;
      setColumnPillForDate(null);
    }
    await fetchMonthAvailability();
  });

  productEl.addEventListener("change", renderSummary);
  purposeEl.addEventListener("change", renderSummary);

  // Init
  fetchMonthAvailability();
  renderSummary();
  switchTab("schedule");
})();
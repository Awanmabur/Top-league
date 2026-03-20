/* public/js/intakes-form.js */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function readJson(id) {
    const el = $(id);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || "{}");
    } catch (e) {
      console.error("Failed to parse JSON:", e);
      return null;
    }
  }

  const data = readJson("intakeData");
  if (!data) return;

  const value = data.value || {};
  const programs = Array.isArray(data.programs) ? data.programs : [];

  const form = $("intakeForm");
  const rowsWrap = $("programRows");
  const programsJson = $("programsJson");
  const capTotalEl = $("capTotal");
  const allowAll = $("allowAllPrograms");
  const statusSel = $("status");
  const statusPill = $("statusPill");

  function pill(status) {
    const s = String(status || "draft");
    const cls =
      s === "open" ? "open" :
      s === "closed" ? "closed" :
      s === "archived" ? "archived" : "draft";
    const ico =
      s === "open" ? "fa-door-open" :
      s === "closed" ? "fa-lock" :
      s === "archived" ? "fa-box-archive" : "fa-pen";
    return `<span class="pill ${cls}"><i class="fa-solid ${ico}"></i> ${s}</span>`;
  }

  function programLabel(p) {
    const code = p.code ? (p.code + " — ") : "";
    return code + (p.name || "Program");
  }

  function currentRows() {
    const rows = [];
    const nodes = rowsWrap ? rowsWrap.querySelectorAll("[data-prog-row]") : [];
    nodes.forEach((row) => {
      const sel = row.querySelector("select[data-program]");
      const cap = row.querySelector("input[data-capacity]");
      const pid = sel ? sel.value : "";
      const capacity = cap ? cap.value : "";
      if (pid) rows.push({ program: pid, capacity: capacity });
    });
    return rows;
  }

  function updateTotalsAndHidden() {
    const rows = allowAll && allowAll.checked ? [] : currentRows();
    let total = 0;
    rows.forEach((r) => {
      const n = parseInt(String(r.capacity || "0"), 10);
      if (!Number.isNaN(n)) total += n;
    });
    if (capTotalEl) capTotalEl.textContent = String(total);
    if (programsJson) programsJson.value = JSON.stringify(rows);
  }

  function addRow(init = {}) {
    if (!rowsWrap) return;

    const row = document.createElement("div");
    row.className = "prog-row";
    row.setAttribute("data-prog-row", "1");

    const opt = programs.map((p) => {
      const selected = String(init.program || "") === String(p._id) ? "selected" : "";
      return `<option value="${p._id}" ${selected}>${escapeHtml(programLabel(p))}</option>`;
    }).join("");

    row.innerHTML = `
      <div class="field">
        <label>Program</label>
        <select class="select" data-program>
          <option value="">Select program…</option>
          ${opt}
        </select>
      </div>
      <div class="field">
        <label>Capacity</label>
        <input class="input" data-capacity type="number" min="0" placeholder="e.g., 120" value="${escapeAttr(init.capacity || "")}">
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="btn light" type="button" data-remove-row>
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;

    rowsWrap.appendChild(row);
    updateTotalsAndHidden();
  }

  function renderRowsFromValue() {
    if (!rowsWrap) return;
    rowsWrap.innerHTML = "";
    const arr = Array.isArray(value.programs) ? value.programs : [];
    arr.forEach((r) => addRow(r));
    if (!arr.length) addRow({});
  }

  function setAllowAllState() {
    if (!allowAll || !rowsWrap) return;

    const restricted = Array.isArray(value.programs) && value.programs.length > 0;
    // If restricted list exists -> allowAll = false
    allowAll.checked = !restricted;

    rowsWrap.style.display = allowAll.checked ? "none" : "block";
    updateTotalsAndHidden();
  }

  function syncStatusPill() {
    if (!statusSel || !statusPill) return;
    statusPill.innerHTML = pill(statusSel.value);
  }

  function openModal(id) {
    const m = $(id);
    if (m) m.classList.add("show");
  }
  function closeModal(id) {
    const m = $(id);
    if (m) m.classList.remove("show");
  }

  function fillPreview() {
    const name = ($("name") && $("name").value) || "—";
    const code = ($("code") && $("code").value) || "—";
    const status = (statusSel && statusSel.value) || "draft";
    const active = ($("isActive") && $("isActive").checked) ? "Yes" : "No";
    const a1 = ($("applicationOpenDate") && $("applicationOpenDate").value) || "—";
    const a2 = ($("applicationCloseDate") && $("applicationCloseDate").value) || "—";
    const s1 = ($("startDate") && $("startDate").value) || "—";
    const s2 = ($("endDate") && $("endDate").value) || "—";

    const rows = allowAll && allowAll.checked ? [] : currentRows();
    const names = rows.map((r) => {
      const p = programs.find((x) => String(x._id) === String(r.program));
      return p ? programLabel(p) : r.program;
    });
    const listText = allowAll && allowAll.checked
      ? "All programs"
      : (names.length ? names.join(", ") : "—");

    let total = 0;
    rows.forEach((r) => {
      const n = parseInt(String(r.capacity || "0"), 10);
      if (!Number.isNaN(n)) total += n;
    });

    setText("pvTitle", name);
    setText("pvCode", code);
    setText("pvStatus", status);
    setText("pvActive", active);
    setText("pvApply", `${a1} → ${a2}`);
    setText("pvStudy", `${s1} → ${s2}`);
    setText("pvPrograms", listText);
    setText("pvCap", String(total));
  }

  function setText(id, v) {
    const el = $(id);
    if (el) el.textContent = v;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function escapeAttr(str) {
    return escapeHtml(str).replaceAll("`", "&#096;");
  }

  // ---- INIT FIELDS ----
  const mapSet = [
    ["name", value.name],
    ["code", value.code],
    ["applicationOpenDate", value.applicationOpenDate],
    ["applicationCloseDate", value.applicationCloseDate],
    ["startDate", value.startDate],
    ["endDate", value.endDate],
  ];
  mapSet.forEach(([id, val]) => {
    const el = $(id);
    if (el && val !== undefined && val !== null) el.value = String(val);
  });

  if (statusSel && value.status) statusSel.value = String(value.status);
  const activeCb = $("isActive");
  if (activeCb) activeCb.checked = !!value.isActive;

  setAllowAllState();
  renderRowsFromValue();
  setAllowAllState(); // apply hide/show after rows render
  syncStatusPill();
  updateTotalsAndHidden();

  // ---- EVENTS ----
  // Tabs
  const tabs = $("tabs");
  if (tabs) {
    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
      const pane = document.getElementById(btn.dataset.pane);
      if (pane) pane.classList.add("active");
    });
  }

  // Status pill
  if (statusSel) {
    statusSel.addEventListener("change", () => {
      syncStatusPill();
    });
  }

  // Allow all toggle
  if (allowAll) {
    allowAll.addEventListener("change", () => {
      if (!rowsWrap) return;
      rowsWrap.style.display = allowAll.checked ? "none" : "block";
      updateTotalsAndHidden();
    });
  }

  // Add program
  const addBtn = $("btnAddProgram");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      if (allowAll && allowAll.checked) {
        allowAll.checked = false;
        if (rowsWrap) rowsWrap.style.display = "block";
      }
      addRow({});
    });
  }

  // Remove row / change program / capacity
  document.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove-row]");
    if (!rm) return;
    const row = rm.closest("[data-prog-row]");
    if (row && row.parentElement) row.parentElement.removeChild(row);
    if (rowsWrap && rowsWrap.querySelectorAll("[data-prog-row]").length === 0) addRow({});
    updateTotalsAndHidden();
  });

  document.addEventListener("input", (e) => {
    if (e.target.matches("input[data-capacity]")) updateTotalsAndHidden();
  });

  document.addEventListener("change", (e) => {
    if (e.target.matches("select[data-program]")) updateTotalsAndHidden();
  });

  // Preview modal open
  document.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-modal-open="mPreview"]');
    if (!btn) return;
    fillPreview();
    openModal("mPreview");
  });

  // Close preview (via global close handler from other script, but safe here too)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-close]");
    if (!btn) return;
    closeModal(btn.getAttribute("data-close"));
  });

  // Submit buttons
  const btnSubmitTop = $("btnSubmitTop");
  const btnSubmitFromPreview = $("btnSubmitFromPreview");
  function submitForm() {
    updateTotalsAndHidden();
    if (form) form.requestSubmit();
  }
  if (btnSubmitTop) btnSubmitTop.addEventListener("click", submitForm);
  if (btnSubmitFromPreview) btnSubmitFromPreview.addEventListener("click", submitForm);
})();

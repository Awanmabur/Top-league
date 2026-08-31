(function () {
  const $ = (id) => document.getElementById(id);

  function readJson(id) {
    const el = $(id);
    if (!el) return {};
    try { return JSON.parse(el.value || "{}"); }
    catch (err) { console.error(`Failed to parse ${id}:`, err); return {}; }
  }

  const REPORTS = readJson("reportsData");
  const state = { view: "overview" };

  function money(v) {
    return Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function openModal(id) { const el = $(id); if (el) el.classList.add("show"); }
  function closeModal(id) { const el = $(id); if (el) el.classList.remove("show"); }
  function clear(el) { if (el) el.replaceChildren(); }
  function text(tag, value, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = String(value ?? "");
    return el;
  }
  function cell(value, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = String(value ?? "");
    return td;
  }
  function emptyRow(tbody, colspan, message) {
    clear(tbody);
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = colspan;
    td.style.padding = "18px";
    td.appendChild(text("div", message, "muted"));
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  function statusClass(status) {
    const s = String(status || "");
    if (["Paid", "Completed", "Active", "Recorded", "Settled"].includes(s)) return "pill ok";
    if (["Pending", "Partially Paid", "Inactive", "Outstanding", "Overdue"].includes(s)) return "pill warn";
    if (["Unpaid", "Cancelled", "Voided", "Revoked", "Rejected", "Refunded"].includes(s)) return "pill bad";
    return "pill info";
  }
  function statusPill(status) {
    const span = document.createElement("span");
    span.className = statusClass(status);
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-circle";
    span.append(icon, document.createTextNode(` ${String(status || "—")}`));
    return span;
  }

  function setView(v) {
    state.view = v;
    document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.remove("active"));
    document.querySelector(`#viewChips .chip[data-view="${v}"]`)?.classList.add("active");
    ["overview", "collections", "balances", "expenses"].forEach((name) => {
      const el = $(`view-${name}`);
      if (el) el.style.display = name === v ? "" : "none";
    });
    const titles = {
      overview: ["Overview Report", "Recent finance activity and high-level results for the selected filter range."],
      collections: ["Collections Report", "Collections grouped by payment method."],
      balances: ["Balances Report", "Outstanding balances by student."],
      expenses: ["Expenses Report", "Expense totals by category."],
    };
    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];
    render();
  }

  function openDetail(row) {
    $("vType").textContent = row.type || "—";
    $("vRef").textContent = row.ref || "—";
    $("vDate").textContent = row.rawDate || "—";
    $("vAmount").textContent = money(row.amount || 0);
    $("vDescription").textContent = row.description || "—";
    $("vStatus").textContent = row.status || "—";
    openModal("mView");
  }

  function renderOverview() {
    const rows = REPORTS.recentActivity || [];
    const tbody = $("tbodyOverview");
    $("resultMeta").textContent = `${rows.length} recent record(s)`;
    clear(tbody);
    if (!rows.length) return emptyRow(tbody, 7, "No activity found.");
    rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      tr.dataset.index = String(index);
      tr.appendChild(cell(row.rawDate || "—", "muted"));
      const typeTd = document.createElement("td"); typeTd.appendChild(statusPill(row.type || "—")); tr.appendChild(typeTd);
      const refTd = document.createElement("td"); refTd.appendChild(text("div", row.ref || "—", "strong")); tr.appendChild(refTd);
      tr.appendChild(cell(row.description || "—"));
      tr.appendChild(cell(money(row.amount || 0)));
      const statusTd = document.createElement("td"); statusTd.appendChild(statusPill(row.status)); tr.appendChild(statusTd);
      const actionTd = document.createElement("td"); actionTd.style.textAlign = "right";
      const button = document.createElement("button"); button.className = "btn-xs actView"; button.type = "button"; button.setAttribute("aria-label", "View finance record");
      const icon = document.createElement("i"); icon.className = "fa-solid fa-eye"; button.appendChild(icon); actionTd.appendChild(button); tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });
  }

  function renderCollections() {
    const rows = REPORTS.collectionByMethod || [];
    const tbody = $("tbodyCollections");
    const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    $("resultMeta").textContent = `${rows.length} method(s)`;
    clear(tbody);
    if (!rows.length) return emptyRow(tbody, 3, "No collections found.");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const nameTd = document.createElement("td"); nameTd.appendChild(text("div", row.label || "—", "strong")); tr.appendChild(nameTd);
      tr.appendChild(cell(money(row.amount || 0)));
      const share = total > 0 ? ((Number(row.amount || 0) / total) * 100).toFixed(1) : "0.0";
      const shareTd = document.createElement("td"); shareTd.appendChild(statusPill(`${share}%`)); tr.appendChild(shareTd);
      tbody.appendChild(tr);
    });
  }

  function renderBalances() {
    const rows = REPORTS.balancesByStudent || [];
    const tbody = $("tbodyBalances");
    $("resultMeta").textContent = `${rows.length} student balance row(s)`;
    clear(tbody);
    if (!rows.length) return emptyRow(tbody, 9, "No balance data found.");
    rows.forEach((row, index) => {
      const tr = document.createElement("tr"); tr.dataset.index = String(index);
      const studentTd = document.createElement("td"); studentTd.appendChild(text("div", row.studentName || "—", "strong")); tr.appendChild(studentTd);
      tr.appendChild(cell(row.admissionNumber || "—"));
      tr.appendChild(cell(row.programName || "—"));
      tr.appendChild(cell(money(row.totalInvoiced || 0)));
      tr.appendChild(cell(money(row.totalPaid || 0)));
      tr.appendChild(cell(money(row.invoiceOutstanding || 0)));
      tr.appendChild(cell(money(row.credit || 0)));
      const balanceTd = document.createElement("td"); balanceTd.appendChild(text("div", money(row.balance || 0), "strong")); tr.appendChild(balanceTd);
      const actionTd = document.createElement("td"); actionTd.style.textAlign = "right";
      const button = document.createElement("button"); button.className = "btn-xs actViewBalance"; button.type = "button"; button.setAttribute("aria-label", "View student balance");
      const icon = document.createElement("i"); icon.className = "fa-solid fa-eye"; button.appendChild(icon); actionTd.appendChild(button); tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });
  }

  function renderExpenses() {
    const rows = (REPORTS.expenseSummary && REPORTS.expenseSummary.categories) || [];
    const tbody = $("tbodyExpenses");
    $("resultMeta").textContent = `${rows.length} expense categor${rows.length === 1 ? "y" : "ies"}`;
    clear(tbody);
    if (!rows.length) return emptyRow(tbody, 2, "No expense data found.");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const labelTd = document.createElement("td"); labelTd.appendChild(text("div", row.label || "—", "strong")); tr.appendChild(labelTd);
      tr.appendChild(cell(money(row.amount || 0)));
      tbody.appendChild(tr);
    });
  }

  function render() {
    if (state.view === "overview") renderOverview();
    if (state.view === "collections") renderCollections();
    if (state.view === "balances") renderBalances();
    if (state.view === "expenses") renderExpenses();
  }

  $("viewChips")?.addEventListener("click", (e) => { const btn = e.target.closest(".chip"); if (btn) setView(btn.dataset.view); });
  $("tbodyOverview")?.addEventListener("click", (e) => {
    if (!e.target.closest(".actView")) return;
    const tr = e.target.closest("tr[data-index]"); const row = tr ? (REPORTS.recentActivity || [])[Number(tr.dataset.index)] : null;
    if (row) openDetail(row);
  });
  $("tbodyBalances")?.addEventListener("click", (e) => {
    if (!e.target.closest(".actViewBalance")) return;
    const tr = e.target.closest("tr[data-index]"); const row = tr ? (REPORTS.balancesByStudent || [])[Number(tr.dataset.index)] : null;
    if (!row) return;
    openDetail({ type: "Student Balance", ref: row.admissionNumber || row.studentName, rawDate: "—", amount: row.balance || 0,
      description: `${row.studentName || "—"} - ${row.programName || "—"} - Invoiced ${money(row.totalInvoiced || 0)} - Completed payments ${money(row.totalPaid || 0)} - Account credit ${money(row.credit || 0)}`,
      status: row.balance > 0 ? "Outstanding" : "Settled" });
  });
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
  $("mView")?.addEventListener("click", (e) => { if (e.target.id === "mView") closeModal("mView"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show")); });

  $("btnExport")?.addEventListener("click", () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("view");
    const suffix = params.toString() ? `?${params.toString()}` : "";
    window.location.assign(`/admin/finance-reports/export${suffix}`);
  });

  setView("overview");
})();

(function () {
  const $ = (id) => document.getElementById(id);
  function readJson(id) { const el = $(id); if (!el) return []; try { return JSON.parse(el.value || "[]"); } catch (error) { console.error(`Failed to parse ${id}:`, error); return []; } }
  const statements = readJson("statementsData");
  if (!$("tbody")) return;
  const state = { view: "list", selectedStatementId: statements[0]?.id || null };
  function money(value) { return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function openModal(id) { $(id)?.classList.add("show"); }
  function closeModal(id) { $(id)?.classList.remove("show"); }
  function clear(el) { if (el) el.replaceChildren(); }
  function divText(value, className) { const el = document.createElement("div"); if (className) el.className = className; el.textContent = String(value ?? ""); return el; }
  function tdText(value, className) { const td = document.createElement("td"); if (className) td.className = className; td.textContent = String(value ?? ""); return td; }
  function pill(label, className = "pill info", iconName = "fa-solid fa-circle") { const el = document.createElement("span"); el.className = className; const icon = document.createElement("i"); icon.className = iconName; el.append(icon, document.createTextNode(` ${String(label ?? "—")}`)); return el; }
  function balancePill(value) { const amount = Number(value || 0); if (amount <= 0) return pill("Settled", "pill ok", "fa-solid fa-circle-check"); if (amount < 100000) return pill("Small Balance", "pill warn", "fa-solid fa-clock"); return pill("Outstanding", "pill bad", "fa-solid fa-triangle-exclamation"); }
  function movementPill(type) { return type === "Invoice" ? pill("Invoice", "pill info", "fa-solid fa-file-invoice-dollar") : pill("Payment", "pill ok", "fa-solid fa-money-bill-wave"); }
  function currentStatement() { return statements.find((row) => row.id === state.selectedStatementId) || statements[0] || null; }
  function emptyRow(tbody, colspan, message) { clear(tbody); const tr = document.createElement("tr"); const td = document.createElement("td"); td.colSpan = colspan; td.style.padding = "18px"; td.appendChild(divText(message, "muted")); tr.appendChild(td); tbody.appendChild(tr); }

  function setView(view) {
    state.view = view;
    document.querySelectorAll("#viewChips .chip").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    $("view-list").style.display = view === "list" ? "" : "none"; $("view-ledger").style.display = view === "ledger" ? "" : "none"; $("view-summary").style.display = view === "summary" ? "" : "none";
    const labels = { list: ["Statements", "Student account summaries with billed, paid and balance values."], ledger: ["Ledger", "Detailed movement history for the selected student statement."], summary: ["Summary", "Statement totals across the current result set."] };
    $("panelTitle").textContent = labels[view][0]; $("panelSub").textContent = labels[view][1]; render();
  }

  function renderList() {
    const tbody = $("tbody"); $("resultMeta").textContent = `${statements.length} statement(s)`; clear(tbody);
    if (!statements.length) return emptyRow(tbody, 8, "No statements found.");
    statements.forEach((statement) => {
      const tr = document.createElement("tr"); tr.dataset.id = String(statement.id || "");
      const studentTd = document.createElement("td"); studentTd.append(divText(statement.studentName || "-", "strong"), divText(statement.admissionNumber || "-", "muted")); tr.appendChild(studentTd);
      tr.appendChild(tdText(statement.programName || "-"));
      const invTd = document.createElement("td"); invTd.appendChild(pill(Number(statement.invoiceCount || 0), "pill info", "fa-solid fa-file-invoice-dollar")); tr.appendChild(invTd);
      const payTd = document.createElement("td"); payTd.appendChild(pill(Number(statement.paymentCount || 0), "pill ok", "fa-solid fa-money-bill-wave")); tr.appendChild(payTd);
      tr.appendChild(tdText(money(statement.totalInvoiced))); tr.appendChild(tdText(money(statement.totalPaid)));
      const balTd = document.createElement("td"); balTd.append(divText(money(statement.balance), "strong")); const muted = divText("", "muted"); muted.appendChild(balancePill(statement.balance)); balTd.appendChild(muted); tr.appendChild(balTd);
      const actionTd = document.createElement("td"); const actions = divText("", "actions");
      const open = document.createElement("button"); open.className = "btn-xs actOpen"; open.type = "button"; open.title = "Open Ledger"; const oi = document.createElement("i"); oi.className = "fa-solid fa-book"; open.appendChild(oi);
      const view = document.createElement("button"); view.className = "btn-xs actView"; view.type = "button"; view.title = "View Statement"; const vi = document.createElement("i"); vi.className = "fa-solid fa-eye"; view.appendChild(vi);
      actions.append(open, view); actionTd.appendChild(actions); tr.appendChild(actionTd); tbody.appendChild(tr);
    });
  }

  function appendLedgerRow(tbody, row, modal = false) {
    const tr = document.createElement("tr"); tr.appendChild(tdText(row.rawDate || "-", "muted"));
    if (modal) tr.appendChild(tdText(row.type || "-")); else { const typeTd = document.createElement("td"); typeTd.appendChild(movementPill(row.type)); tr.appendChild(typeTd); }
    const refTd = document.createElement("td"); if (modal) refTd.textContent = row.ref || "-"; else refTd.appendChild(divText(row.ref || "-", "strong")); tr.appendChild(refTd);
    tr.appendChild(tdText(row.description || "-"));
    if (!modal) tr.appendChild(tdText(row.programName || "-"));
    tr.appendChild(tdText(money(row.debit || 0))); tr.appendChild(tdText(money(row.credit || 0)));
    const running = document.createElement("td"); running.appendChild(divText(money(row.runningBalance || 0), "strong")); tr.appendChild(running);
    if (!modal) { const status = document.createElement("td"); status.appendChild(pill(row.status || "-")); tr.appendChild(status); }
    tbody.appendChild(tr);
  }

  function renderLedger() {
    const statement = currentStatement(); const tbody = $("tbodyLedger"); clear(tbody);
    if (!statement) { $("resultMeta").textContent = "0 movement(s)"; return emptyRow(tbody, 9, "No ledger found."); }
    const ledger = Array.isArray(statement.ledger) ? statement.ledger : [];
    $("resultMeta").textContent = `${ledger.length} movement(s) - ${statement.studentName || "-"}`;
    if (!ledger.length) return emptyRow(tbody, 9, "No ledger movements found.");
    ledger.forEach((row) => appendLedgerRow(tbody, row, false));
  }

  function render() { if (state.view === "list") renderList(); if (state.view === "ledger") renderLedger(); if (state.view === "summary") $("resultMeta").textContent = `${statements.length} statement(s)`; }

  function openStatementModal(statement) {
    if (!statement) return;
    $("vStudentName").textContent = statement.studentName || "-"; $("vProgramName").textContent = statement.programName || "-"; $("vAdmissionNo").textContent = statement.admissionNumber || "-";
    $("vCounts").textContent = `${Number(statement.invoiceCount || 0)} invoice(s) - ${Number(statement.paymentCount || 0)} payment(s)`;
    $("vTotalInvoiced").textContent = money(statement.totalInvoiced || 0); $("vTotalPaid").textContent = money(statement.totalPaid || 0); $("vBalance").textContent = money(statement.balance || 0);
    const ledger = Array.isArray(statement.ledger) ? statement.ledger : []; const tbody = $("tbodyModalLedger"); clear(tbody);
    if (!ledger.length) emptyRow(tbody, 7, "No ledger movements found."); else ledger.forEach((row) => appendLedgerRow(tbody, row, true));
    openModal("mView");
  }

  function exportUrl(studentId) {
    const params = new URLSearchParams(window.location.search);
    params.delete("view");
    if (studentId) params.set("student", studentId);
    return `/admin/student-statements/export${params.toString() ? `?${params.toString()}` : ""}`;
  }
  function exportAllStatements() { window.location.assign(exportUrl()); }
  function exportSingleStatement() { const s = currentStatement(); if (s) window.location.assign(exportUrl(s.id)); }

  $("viewChips")?.addEventListener("click", (event) => { const button = event.target.closest(".chip"); if (button) setView(button.dataset.view); });
  $("tbody")?.addEventListener("click", (event) => { const row = event.target.closest("tr[data-id]"); if (!row) return; const statement = statements.find((item) => item.id === row.dataset.id); if (!statement) return; if (event.target.closest(".actOpen")) { state.selectedStatementId = statement.id; setView("ledger"); } else if (event.target.closest(".actView")) { state.selectedStatementId = statement.id; openStatementModal(statement); } });
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
  $("mView")?.addEventListener("click", (event) => { if (event.target.id === "mView") closeModal("mView"); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((modal) => modal.classList.remove("show")); });
  $("btnExport")?.addEventListener("click", exportAllStatements); $("btnPrintStatement")?.addEventListener("click", () => window.print()); $("btnExportStatement")?.addEventListener("click", exportSingleStatement);
  setView("list"); render();
})();

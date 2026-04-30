(function () {
  const $ = (id) => document.getElementById(id);

  function readJson(id) {
    const el = $(id);
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (error) {
      console.error(`Failed to parse ${id}:`, error);
      return [];
    }
  }

  const statements = readJson("statementsData");
  if (!$("tbody")) return;

  const state = {
    view: "list",
    selectedStatementId: statements[0]?.id || null,
  };

  function money(value) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

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

  function pillBalance(value) {
    const amount = Number(value || 0);
    if (amount <= 0) {
      return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Settled</span>';
    }
    if (amount < 100000) {
      return '<span class="pill warn"><i class="fa-solid fa-clock"></i> Small Balance</span>';
    }
    return '<span class="pill bad"><i class="fa-solid fa-triangle-exclamation"></i> Outstanding</span>';
  }

  function pillMovement(type) {
    if (type === "Invoice") {
      return '<span class="pill info"><i class="fa-solid fa-file-invoice-dollar"></i> Invoice</span>';
    }
    return '<span class="pill ok"><i class="fa-solid fa-money-bill-wave"></i> Payment</span>';
  }

  function currentStatement() {
    return statements.find((row) => row.id === state.selectedStatementId) || statements[0] || null;
  }

  function setView(view) {
    state.view = view;

    document.querySelectorAll("#viewChips .chip").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });

    $("view-list").style.display = view === "list" ? "" : "none";
    $("view-ledger").style.display = view === "ledger" ? "" : "none";
    $("view-summary").style.display = view === "summary" ? "" : "none";

    const labels = {
      list: ["Statements", "Student account summaries with billed, paid and balance values."],
      ledger: ["Ledger", "Detailed movement history for the selected student statement."],
      summary: ["Summary", "Statement totals across the current result set."],
    };

    $("panelTitle").textContent = labels[view][0];
    $("panelSub").textContent = labels[view][1];
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${statements.length} statement(s)`;

    $("tbody").innerHTML =
      statements
        .map((statement) => {
          const studentName = escapeHtml(statement.studentName || "-");
          const regNo = escapeHtml(statement.admissionNumber || "-");
          const programName = escapeHtml(statement.programName || "-");

          return `
            <tr data-id="${escapeHtml(statement.id)}">
              <td>
                <div class="strong">${studentName}</div>
                <div class="muted">${regNo}</div>
              </td>
              <td>${programName}</td>
              <td><span class="pill info"><i class="fa-solid fa-file-invoice-dollar"></i> ${Number(statement.invoiceCount || 0)}</span></td>
              <td><span class="pill ok"><i class="fa-solid fa-money-bill-wave"></i> ${Number(statement.paymentCount || 0)}</span></td>
              <td>${money(statement.totalInvoiced)}</td>
              <td>${money(statement.totalPaid)}</td>
              <td>
                <div class="strong">${money(statement.balance)}</div>
                <div class="muted">${pillBalance(statement.balance)}</div>
              </td>
              <td>
                <div class="actions">
                  <button class="btn-xs actOpen" type="button" title="Open Ledger"><i class="fa-solid fa-book"></i></button>
                  <button class="btn-xs actView" type="button" title="View Statement"><i class="fa-solid fa-eye"></i></button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("") ||
      '<tr><td colspan="8" style="padding:18px;"><div class="muted">No statements found.</div></td></tr>';
  }

  function renderLedger() {
    const statement = currentStatement();
    if (!statement) {
      $("resultMeta").textContent = "0 movement(s)";
      $("tbodyLedger").innerHTML =
        '<tr><td colspan="9" style="padding:18px;"><div class="muted">No ledger found.</div></td></tr>';
      return;
    }

    const ledger = Array.isArray(statement.ledger) ? statement.ledger : [];
    $("resultMeta").textContent = `${ledger.length} movement(s) - ${statement.studentName || "-"}`;

    $("tbodyLedger").innerHTML =
      ledger
        .map((row) => `
          <tr>
            <td class="muted">${escapeHtml(row.rawDate || "-")}</td>
            <td>${pillMovement(row.type)}</td>
            <td><div class="strong">${escapeHtml(row.ref || "-")}</div></td>
            <td>${escapeHtml(row.description || "-")}</td>
            <td>${escapeHtml(row.programName || "-")}</td>
            <td>${money(row.debit || 0)}</td>
            <td>${money(row.credit || 0)}</td>
            <td><div class="strong">${money(row.runningBalance || 0)}</div></td>
            <td><span class="pill info"><i class="fa-solid fa-circle"></i> ${escapeHtml(row.status || "-")}</span></td>
          </tr>
        `)
        .join("") ||
      '<tr><td colspan="9" style="padding:18px;"><div class="muted">No ledger movements found.</div></td></tr>';
  }

  function render() {
    if (state.view === "list") renderList();
    if (state.view === "ledger") renderLedger();
    if (state.view === "summary") {
      $("resultMeta").textContent = `${statements.length} statement(s)`;
    }
  }

  function openStatementModal(statement) {
    if (!statement) return;

    $("vStudentName").textContent = statement.studentName || "-";
    $("vProgramName").textContent = statement.programName || "-";
    $("vAdmissionNo").textContent = statement.admissionNumber || "-";
    $("vCounts").textContent =
      `${Number(statement.invoiceCount || 0)} invoice(s) - ${Number(statement.paymentCount || 0)} payment(s)`;
    $("vTotalInvoiced").textContent = money(statement.totalInvoiced || 0);
    $("vTotalPaid").textContent = money(statement.totalPaid || 0);
    $("vBalance").textContent = money(statement.balance || 0);

    const ledger = Array.isArray(statement.ledger) ? statement.ledger : [];
    $("tbodyModalLedger").innerHTML =
      ledger
        .map((row) => `
          <tr>
            <td class="muted">${escapeHtml(row.rawDate || "-")}</td>
            <td>${escapeHtml(row.type || "-")}</td>
            <td>${escapeHtml(row.ref || "-")}</td>
            <td>${escapeHtml(row.description || "-")}</td>
            <td>${money(row.debit || 0)}</td>
            <td>${money(row.credit || 0)}</td>
            <td><div class="strong">${money(row.runningBalance || 0)}</div></td>
          </tr>
        `)
        .join("") ||
      '<tr><td colspan="7" style="padding:18px;"><div class="muted">No ledger movements found.</div></td></tr>';

    openModal("mView");
  }

  function exportCsv(rows, fileName) {
    const csv = rows.map((row) => row.map((value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportAllStatements() {
    const rows = [
      ["Student", "Admission No", "Subject / Class", "Invoices", "Payments", "Invoiced", "Paid", "Balance"],
      ...statements.map((statement) => [
        statement.studentName || "",
        statement.admissionNumber || "",
        statement.programName || "",
        Number(statement.invoiceCount || 0),
        Number(statement.paymentCount || 0),
        Number(statement.totalInvoiced || 0),
        Number(statement.totalPaid || 0),
        Number(statement.balance || 0),
      ]),
    ];

    exportCsv(rows, "student-statements.csv");
  }

  function exportSingleStatement() {
    const statement = currentStatement();
    if (!statement) return;

    const rows = [
      ["Student", statement.studentName || ""],
      ["Admission No", statement.admissionNumber || ""],
      ["Subject / Class", statement.programName || ""],
      ["Total Invoiced", Number(statement.totalInvoiced || 0)],
      ["Total Paid", Number(statement.totalPaid || 0)],
      ["Balance", Number(statement.balance || 0)],
      [""],
      ["Date", "Type", "Reference", "Description", "Subject / Class", "Debit", "Credit", "Running Balance", "Status"],
      ...(Array.isArray(statement.ledger) ? statement.ledger : []).map((row) => [
        row.rawDate || "",
        row.type || "",
        row.ref || "",
        row.description || "",
        row.programName || "",
        Number(row.debit || 0),
        Number(row.credit || 0),
        Number(row.runningBalance || 0),
        row.status || "",
      ]),
    ];

    exportCsv(rows, `statement-${statement.admissionNumber || statement.id}.csv`);
  }

  $("viewChips")?.addEventListener("click", function (event) {
    const button = event.target.closest(".chip");
    if (!button) return;
    setView(button.dataset.view);
  });

  $("tbody")?.addEventListener("click", function (event) {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;

    const statement = statements.find((item) => item.id === row.dataset.id);
    if (!statement) return;

    if (event.target.closest(".actOpen")) {
      state.selectedStatementId = statement.id;
      setView("ledger");
      return;
    }

    if (event.target.closest(".actView")) {
      state.selectedStatementId = statement.id;
      openStatementModal(statement);
    }
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", function () {
      closeModal(button.dataset.closeModal);
    });
  });

  ["mView"].forEach((modalId) => {
    const modal = $(modalId);
    if (!modal) return;
    modal.addEventListener("click", function (event) {
      if (event.target.id === modalId) closeModal(modalId);
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".modal-backdrop.show").forEach((modal) => {
      modal.classList.remove("show");
    });
  });

  $("btnExport")?.addEventListener("click", exportAllStatements);
  $("btnPrintStatement")?.addEventListener("click", function () {
    window.print();
  });
  $("btnExportStatement")?.addEventListener("click", exportSingleStatement);

  setView("list");
  render();
})();

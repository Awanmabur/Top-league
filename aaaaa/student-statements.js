(function () {
  const $ = (id) => document.getElementById(id);

  function readJson(id) {
    const el = $(id);
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error(`Failed to parse ${id}:`, err);
      return [];
    }
  }

  const STM = readJson("statementsData");

  if (!$("tbody")) return;

  const state = {
    view: "list",
    selectedStatementId: STM[0]?.id || null,
  };

  function money(v) {
    return Number(v || 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
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

  function pillBalance(v) {
    const n = Number(v || 0);
    if (n <= 0) return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Settled</span>';
    if (n < 100000) return '<span class="pill warn"><i class="fa-solid fa-clock"></i> Small Balance</span>';
    return '<span class="pill bad"><i class="fa-solid fa-triangle-exclamation"></i> Outstanding</span>';
  }

  function pillMovement(type) {
    if (type === "Invoice") return '<span class="pill info"><i class="fa-solid fa-file-invoice-dollar"></i> Invoice</span>';
    return '<span class="pill ok"><i class="fa-solid fa-money-bill-wave"></i> Payment</span>';
  }

  function setView(v) {
    state.view = v;

    document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.remove("active"));
    const activeBtn = document.querySelector(`#viewChips .chip[data-view="${v}"]`);
    if (activeBtn) activeBtn.classList.add("active");

    $("view-list").style.display = v === "list" ? "" : "none";
    $("view-ledger").style.display = v === "ledger" ? "" : "none";
    $("view-summary").style.display = v === "summary" ? "" : "none";

    const titles = {
      list: ["Statements", "Student account summaries with billed, paid and balance values."],
      ledger: ["Ledger", "Detailed movement history for the selected student statement."],
      summary: ["Summary", "Statement totals across the current result set."],
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    render();
  }

  function currentStatement() {
    return STM.find((x) => x.id === state.selectedStatementId) || STM[0] || null;
  }

  function renderList() {
    $("resultMeta").textContent = `${STM.length} statement(s)`;

    $("tbody").innerHTML =
      STM.map((s) => `
        <tr data-id="${s.id}">
          <td>
            <div class="strong">${s.studentName || "—"}</div>
            <div class="muted">${s.admissionNumber || "—"}</div>
          </td>
          <td>${s.programName || "—"}</td>
          <td><span class="pill info"><i class="fa-solid fa-file-invoice-dollar"></i> ${Number(s.invoiceCount || 0)}</span></td>
          <td><span class="pill ok"><i class="fa-solid fa-money-bill-wave"></i> ${Number(s.paymentCount || 0)}</span></td>
          <td>${money(s.totalInvoiced)}</td>
          <td>${money(s.totalPaid)}</td>
          <td>
            <div class="strong">${money(s.balance)}</div>
            <div class="muted">${pillBalance(s.balance)}</div>
          </td>
          <td>
            <div class="actions">
              <button class="btn-xs actOpen" type="button" title="Open Ledger"><i class="fa-solid fa-book"></i></button>
              <button class="btn-xs actView" type="button" title="View Statement"><i class="fa-solid fa-eye"></i></button>
            </div>
          </td>
        </tr>
      `).join("") ||
      '<tr><td colspan="8" style="padding:18px;"><div class="muted">No statements found.</div></td></tr>';
  }

  function renderLedger() {
    const s = currentStatement();
    if (!s) {
      $("resultMeta").textContent = "0 ledger movement(s)";
      $("tbodyLedger").innerHTML = '<tr><td colspan="9" style="padding:18px;"><div class="muted">No ledger found.</div></td></tr>';
      return;
    }

    const ledger = Array.isArray(s.ledger) ? s.ledger : [];
    $("resultMeta").textContent = `${ledger.length} movement(s) • ${s.studentName || "—"}`;

    $("tbodyLedger").innerHTML =
      ledger.map((row) => `
        <tr>
          <td class="muted">${row.rawDate || "—"}</td>
          <td>${pillMovement(row.type)}</td>
          <td><div class="strong">${row.ref || "—"}</div></td>
          <td>${row.description || "—"}</td>
          <td>${row.programName || "—"}</td>
          <td>${money(row.debit || 0)}</td>
          <td>${money(row.credit || 0)}</td>
          <td><div class="strong">${money(row.runningBalance || 0)}</div></td>
          <td><span class="pill info"><i class="fa-solid fa-circle"></i> ${row.status || "—"}</span></td>
        </tr>
      `).join("") ||
      '<tr><td colspan="9" style="padding:18px;"><div class="muted">No ledger movements found.</div></td></tr>';
  }

  function render() {
    if (state.view === "list") renderList();
    if (state.view === "ledger") renderLedger();
    if (state.view === "summary") $("resultMeta").textContent = `${STM.length} statement(s)`;
  }

  function openStatementModal(s) {
    if (!s) return;

    $("vStudentName").textContent = s.studentName || "—";
    $("vProgramName").textContent = s.programName || "—";
    $("vAdmissionNo").textContent = s.admissionNumber || "—";
    $("vCounts").textContent = `${Number(s.invoiceCount || 0)} invoice(s) • ${Number(s.paymentCount || 0)} payment(s)`;
    $("vTotalInvoiced").textContent = money(s.totalInvoiced || 0);
    $("vTotalPaid").textContent = money(s.totalPaid || 0);
    $("vBalance").textContent = money(s.balance || 0);

    const ledger = Array.isArray(s.ledger) ? s.ledger : [];
    $("tbodyModalLedger").innerHTML =
      ledger.map((row) => `
        <tr>
          <td class="muted">${row.rawDate || "—"}</td>
          <td>${row.type || "—"}</td>
          <td>${row.ref || "—"}</td>
          <td>${row.description || "—"}</td>
          <td>${money(row.debit || 0)}</td>
          <td>${money(row.credit || 0)}</td>
          <td><div class="strong">${money(row.runningBalance || 0)}</div></td>
        </tr>
      `).join("") ||
      '<tr><td colspan="7" style="padding:18px;"><div class="muted">No ledger movements found.</div></td></tr>';

    openModal("mView");
  }

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("tbody").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const s = STM.find((x) => x.id === tr.dataset.id);
    if (!s) return;

    if (e.target.closest(".actOpen")) {
      state.selectedStatementId = s.id;
      return setView("ledger");
    }

    if (e.target.closest(".actView")) {
      state.selectedStatementId = s.id;
      return openStatementModal(s);
    }
  });

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mView"].forEach(function (mid) {
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

  $("btnExport").addEventListener("click", function () {
    alert("Hook statements export route later.");
  });

  $("btnPrintStatement").addEventListener("click", function () {
    alert("Hook print statement route later.");
  });

  $("btnExportStatement").addEventListener("click", function () {
    alert("Hook single statement export route later.");
  });

  setView("list");
  render();
})();
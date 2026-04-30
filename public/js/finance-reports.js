(function () {
  const $ = (id) => document.getElementById(id);

  function readJson(id) {
    const el = $(id);
    if (!el) return {};
    try {
      return JSON.parse(el.value || "{}");
    } catch (err) {
      console.error(`Failed to parse ${id}:`, err);
      return {};
    }
  }

  const REPORTS = readJson("reportsData");

  const state = {
    view: "overview",
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

  function pillStatus(v) {
    const s = String(v || "");
    if (["Paid", "Completed", "Active", "Recorded"].includes(s)) {
      return `<span class="pill ok"><i class="fa-solid fa-circle-check"></i> ${s}</span>`;
    }
    if (["Pending", "Partially Paid", "Inactive"].includes(s)) {
      return `<span class="pill warn"><i class="fa-solid fa-clock"></i> ${s}</span>`;
    }
    if (["Unpaid", "Cancelled", "Voided", "Revoked", "Rejected"].includes(s)) {
      return `<span class="pill bad"><i class="fa-solid fa-triangle-exclamation"></i> ${s}</span>`;
    }
    return `<span class="pill info"><i class="fa-solid fa-circle"></i> ${s || "—"}</span>`;
  }

  function setView(v) {
    state.view = v;

    document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.remove("active"));
    const activeBtn = document.querySelector(`#viewChips .chip[data-view="${v}"]`);
    if (activeBtn) activeBtn.classList.add("active");

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
    $("resultMeta").textContent = `${rows.length} recent record(s)`;

    $("tbodyOverview").innerHTML =
      rows.map((row, index) => `
        <tr data-index="${index}">
          <td class="muted">${row.rawDate || "—"}</td>
          <td><span class="pill info"><i class="fa-solid fa-layer-group"></i> ${row.type || "—"}</span></td>
          <td><div class="strong">${row.ref || "—"}</div></td>
          <td>${row.description || "—"}</td>
          <td>${money(row.amount || 0)}</td>
          <td>${pillStatus(row.status)}</td>
          <td style="text-align:right;">
            <button class="btn-xs actView" type="button"><i class="fa-solid fa-eye"></i></button>
          </td>
        </tr>
      `).join("") ||
      '<tr><td colspan="7" style="padding:18px;"><div class="muted">No activity found.</div></td></tr>';
  }

  function renderCollections() {
    const rows = REPORTS.collectionByMethod || [];
    const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    $("resultMeta").textContent = `${rows.length} method(s)`;

    $("tbodyCollections").innerHTML =
      rows.map((row) => {
        const share = total > 0 ? ((Number(row.amount || 0) / total) * 100).toFixed(1) : "0.0";
        return `
          <tr>
            <td><div class="strong">${row.label || "—"}</div></td>
            <td>${money(row.amount || 0)}</td>
            <td><span class="pill ok"><i class="fa-solid fa-chart-pie"></i> ${share}%</span></td>
          </tr>
        `;
      }).join("") ||
      '<tr><td colspan="3" style="padding:18px;"><div class="muted">No collections found.</div></td></tr>';
  }

  function renderBalances() {
    const rows = REPORTS.balancesByStudent || [];
    $("resultMeta").textContent = `${rows.length} student balance row(s)`;

    $("tbodyBalances").innerHTML =
      rows.map((row, index) => `
        <tr data-index="${index}">
          <td><div class="strong">${row.studentName || "—"}</div></td>
          <td>${row.admissionNumber || "—"}</td>
          <td>${row.programName || "—"}</td>
          <td>${money(row.totalInvoiced || 0)}</td>
          <td>${money(row.totalPaid || 0)}</td>
          <td><div class="strong">${money(row.balance || 0)}</div></td>
          <td style="text-align:right;">
            <button class="btn-xs actViewBalance" type="button"><i class="fa-solid fa-eye"></i></button>
          </td>
        </tr>
      `).join("") ||
      '<tr><td colspan="7" style="padding:18px;"><div class="muted">No balance data found.</div></td></tr>';
  }

  function renderExpenses() {
    const rows = (REPORTS.expenseSummary && REPORTS.expenseSummary.categories) || [];
    $("resultMeta").textContent = `${rows.length} expense categor${rows.length === 1 ? "y" : "ies"}`;

    $("tbodyExpenses").innerHTML =
      rows.map((row) => `
        <tr>
          <td><div class="strong">${row.label || "—"}</div></td>
          <td>${money(row.amount || 0)}</td>
        </tr>
      `).join("") ||
      '<tr><td colspan="2" style="padding:18px;"><div class="muted">No expense data found.</div></td></tr>';
  }

  function render() {
    if (state.view === "overview") renderOverview();
    if (state.view === "collections") renderCollections();
    if (state.view === "balances") renderBalances();
    if (state.view === "expenses") renderExpenses();
  }

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("tbodyOverview").addEventListener("click", function (e) {
    const btn = e.target.closest(".actView");
    if (!btn) return;
    const tr = e.target.closest("tr[data-index]");
    if (!tr) return;
    const row = (REPORTS.recentActivity || [])[Number(tr.dataset.index)];
    if (!row) return;
    openDetail(row);
  });

  $("tbodyBalances").addEventListener("click", function (e) {
    const btn = e.target.closest(".actViewBalance");
    if (!btn) return;
    const tr = e.target.closest("tr[data-index]");
    if (!tr) return;
    const row = (REPORTS.balancesByStudent || [])[Number(tr.dataset.index)];
    if (!row) return;
    openDetail({
      type: "Student Balance",
      ref: row.admissionNumber || row.studentName,
      rawDate: "—",
      amount: row.balance || 0,
      description: `${row.studentName || "—"} - ${row.programName || "—"} - Invoiced ${money(row.totalInvoiced || 0)} - Paid ${money(row.totalPaid || 0)}`,
      status: row.balance > 0 ? "Outstanding" : "Settled",
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  const modal = $("mView");
  if (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target.id === "mView") closeModal("mView");
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach(function (el) {
        el.classList.remove("show");
      });
    }
  });

  function csvCell(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  $("btnExport").addEventListener("click", function () {
    const rows = [["Date", "Type", "Reference", "Description", "Amount", "Status"]];
    (REPORTS.recentActivity || []).forEach(function (row) {
      rows.push([
        row.rawDate || "",
        row.type || "",
        row.ref || "",
        row.description || "",
        row.amount || 0,
        row.status || "",
      ]);
    });

    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `finance-report-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

  setView("overview");
})();

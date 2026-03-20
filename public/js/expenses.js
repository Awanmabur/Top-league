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

  const EXP = readJson("expensesData");

  if (!$("tbody")) return;

  const state = {
    view: "list",
    selected: new Set(),
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

  function pillStatus(a) {
    if (a.status === "Approved") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Approved</span>';
    if (a.status === "Recorded") return '<span class="pill info"><i class="fa-solid fa-file-circle-check"></i> Recorded</span>';
    if (a.status === "Rejected") return '<span class="pill bad"><i class="fa-solid fa-ban"></i> Rejected</span>';
    return '<span class="pill draft"><i class="fa-solid fa-file"></i> Draft</span>';
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
    $("view-categories").style.display = v === "categories" ? "" : "none";
    $("view-summary").style.display = v === "summary" ? "" : "none";

    const titles = {
      list: ["Expenses", "Manage expense records, approvals, categories and amounts."],
      categories: ["Categories", "Expense totals grouped by category."],
      summary: ["Summary", "Expense approval and amount summary."],
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${EXP.length} expense(s)`;
    $("checkAll").checked = EXP.length > 0 && EXP.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML =
      EXP.map((a) => {
        const checked = state.selected.has(a.id) ? "checked" : "";
        return `
          <tr data-id="${a.id}">
            <td><input type="checkbox" class="rowCheck" data-id="${a.id}" ${checked}></td>
            <td>
              <div class="strong">${a.title || ""}</div>
              <div class="muted">${a.expenseNo || "—"} ${a.voucherNo ? `• ${a.voucherNo}` : ""}</div>
            </td>
            <td><span class="pill info"><i class="fa-solid fa-tag"></i> ${a.category || "Other"}</span></td>
            <td>${a.paidTo || "—"}</td>
            <td><span class="pill info"><i class="fa-solid fa-wallet"></i> ${a.method || "Cash"}</span></td>
            <td class="muted">${a.expenseDate || "—"}</td>
            <td><div class="strong">${money(a.amount || 0)}</div></td>
            <td>${pillStatus(a)}</td>
            <td>
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actRecord" type="button" title="Record"><i class="fa-solid fa-file-circle-check"></i></button>
                <button class="btn-xs actApprove" type="button" title="Approve"><i class="fa-solid fa-circle-check"></i></button>
                <button class="btn-xs actReject" type="button" title="Reject"><i class="fa-solid fa-ban"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      '<tr><td colspan="9" style="padding:18px;"><div class="muted">No expenses found.</div></td></tr>';
  }

  function renderCategories() {
    const grouped = Object.entries(
      EXP.reduce((acc, x) => {
        const key = x.category || "Other";
        acc[key] = (acc[key] || 0) + Number(x.amount || 0);
        return acc;
      }, {})
    )
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);

    const total = grouped.reduce((sum, x) => sum + Number(x.amount || 0), 0);

    $("resultMeta").textContent = `${grouped.length} categor${grouped.length === 1 ? "y" : "ies"}`;

    $("tbodyCategories").innerHTML =
      grouped.map((row) => {
        const share = total > 0 ? ((Number(row.amount || 0) / total) * 100).toFixed(1) : "0.0";
        return `
          <tr>
            <td><div class="strong">${row.label || "Other"}</div></td>
            <td>${money(row.amount || 0)}</td>
            <td><span class="pill warn"><i class="fa-solid fa-chart-pie"></i> ${share}%</span></td>
          </tr>
        `;
      }).join("") ||
      '<tr><td colspan="3" style="padding:18px;"><div class="muted">No category data found.</div></td></tr>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "categories") renderCategories();
    if (state.view === "summary") $("resultMeta").textContent = `${EXP.length} expense(s)`;
  }

  function syncPreview() {
    $("categoryPreview").textContent = $("eCategory").value || "Other";
    $("amountPreview").textContent = money($("eAmount").value || 0);
  }

  function openEditor(pref) {
    pref = pref || null;

    $("mTitle").textContent = pref ? "Edit Expense" : "Record Expense";
    const form = $("expenseForm");
    form.action = pref ? `/admin/expenses/${pref.id}/update` : "/admin/expenses";

    $("eVoucherNo").value = pref ? (pref.voucherNo || "") : "";
    $("eReference").value = pref ? (pref.reference || "") : "";
    $("eTitle").value = pref ? (pref.title || "") : "";
    $("eCategory").value = pref ? (pref.category || "Other") : "Other";
    $("eAmount").value = pref ? Number(pref.amount || 0) : "";
    $("eExpenseDate").value = pref ? (pref.expenseDate || "") : "";
    $("ePaidTo").value = pref ? (pref.paidTo || "") : "";
    $("eMethod").value = pref ? (pref.method || "Cash") : "Cash";
    $("eStatus").value = pref ? (pref.status || "Recorded") : "Recorded";
    $("eDescription").value = pref ? (pref.description || "") : "";
    $("eNotes").value = pref ? (pref.notes || "") : "";

    syncPreview();
    openModal("mEdit");
  }

  function openViewModal(a) {
    if (!a) return;

    $("vExpenseNo").textContent = a.expenseNo || "—";
    $("vVoucherNo").textContent = a.voucherNo || "—";
    $("vTitle").textContent = a.title || "—";
    $("vCategory").textContent = a.category || "—";
    $("vAmount").textContent = money(a.amount || 0);
    $("vMethod").textContent = a.method || "—";
    $("vPaidTo").textContent = a.paidTo || "—";
    $("vStatus").textContent = a.status || "—";
    $("vExpenseDate").textContent = a.expenseDate || "—";
    $("vReference").textContent = a.reference || "—";
    $("vDescription").textContent = a.description || "—";
    $("vNotes").textContent = a.notes || "—";

    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickNewExpense").addEventListener("click", function () {
    openEditor();
  });

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) EXP.forEach((a) => state.selected.add(a.id));
    else EXP.forEach((a) => state.selected.delete(a.id));
    render();
  });

  $("tbody").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    render();
  });

  $("tbody").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const a = EXP.find((x) => x.id === tr.dataset.id);
    if (!a) return;

    if (e.target.closest(".actView")) return openViewModal(a);
    if (e.target.closest(".actEdit")) return openEditor(a);
    if (e.target.closest(".actRecord")) return submitRowAction(`/admin/expenses/${a.id}/record`);
    if (e.target.closest(".actApprove")) return submitRowAction(`/admin/expenses/${a.id}/approve`);
    if (e.target.closest(".actReject")) return submitRowAction(`/admin/expenses/${a.id}/reject`);

    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete expense "${a.title}"?`)) {
        return submitRowAction(`/admin/expenses/${a.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one expense.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkRecord").addEventListener("click", function () { bulkSubmit("record"); });
  $("bulkApprove").addEventListener("click", function () { bulkSubmit("approve"); });
  $("bulkReject").addEventListener("click", function () { bulkSubmit("reject"); });
  $("bulkDraft").addEventListener("click", function () { bulkSubmit("draft"); });
  $("bulkDelete").addEventListener("click", function () {
    if (!state.selected.size) return;
    if (window.confirm("Delete selected expenses?")) bulkSubmit("delete");
  });

  $("eCategory").addEventListener("change", syncPreview);
  $("eAmount").addEventListener("input", syncPreview);

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
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

  $("btnExport").addEventListener("click", function () {
    alert("Hook expenses export route later.");
  });

  syncPreview();
  setView("list");
  render();
})();
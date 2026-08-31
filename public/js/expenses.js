(function () {
  const $ = (id) => document.getElementById(id);

  function readJson(id) {
    const node = $(id);
    if (!node) return [];
    try {
      return JSON.parse(node.value || "[]");
    } catch (err) {
      console.error(`Failed to parse ${id}:`, err);
      return [];
    }
  }

  const EXP = readJson("expensesData");
  if (!$("tbody")) return;

  const requestedView = new URLSearchParams(window.location.search).get("view");
  const state = {
    view: ["list", "categories", "summary"].includes(requestedView) ? requestedView : "list",
    selected: new Set(),
  };

  function money(value) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined && text !== null) item.textContent = String(text);
    return item;
  }

  function icon(className) {
    return node("i", className);
  }

  function pill(className, iconClass, text) {
    const span = node("span", `pill ${className}`);
    span.append(icon(iconClass), document.createTextNode(` ${text}`));
    return span;
  }

  function statusPill(expense) {
    if (expense.status === "Approved") return pill("ok", "fa-solid fa-circle-check", "Approved");
    if (expense.status === "Recorded") return pill("info", "fa-solid fa-file-circle-check", "Recorded");
    if (expense.status === "Rejected") return pill("bad", "fa-solid fa-ban", "Rejected");
    return pill("draft", "fa-solid fa-file", "Draft");
  }

  function actionButton(className, title, iconClass) {
    const button = node("button", `btn-xs ${className}`);
    button.type = "button";
    button.title = title;
    button.append(icon(iconClass));
    return button;
  }

  function openModal(id) {
    $(id)?.classList.add("show");
  }

  function closeModal(id) {
    $(id)?.classList.remove("show");
  }

  function submitRowAction(actionUrl) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    form.requestSubmit();
  }

  function bulkSubmit(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return;
    $("bulkIds").value = ids.join(",");
    $("bulkActionInput").value = action;
    $("bulkForm").requestSubmit();
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0 && state.view === "list");
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll("#viewChips .chip").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });
    $("view-list").style.display = view === "list" ? "" : "none";
    $("view-categories").style.display = view === "categories" ? "" : "none";
    $("view-summary").style.display = view === "summary" ? "" : "none";

    const titles = {
      list: ["Expenses", "Manage expense records, approvals, categories and amounts."],
      categories: ["Categories", "Expense totals grouped by category."],
      summary: ["Summary", "Expense approval and amount summary."],
    };
    $("panelTitle").textContent = titles[view][0];
    $("panelSub").textContent = titles[view][1];
    render();
  }

  function appendExpenseActions(container, expense) {
    container.append(actionButton("actView", "View", "fa-solid fa-eye"));
    if (expense.status !== "Approved") {
      container.append(actionButton("actEdit", "Edit", "fa-solid fa-pen"));
    }
    if (["Draft", "Rejected"].includes(expense.status)) {
      container.append(actionButton("actRecord", "Record", "fa-solid fa-file-circle-check"));
    }
    if (expense.status === "Recorded") {
      container.append(actionButton("actApprove", "Approve", "fa-solid fa-circle-check"));
      container.append(actionButton("actReject", "Reject", "fa-solid fa-ban"));
    }
    if (expense.status !== "Approved") {
      container.append(actionButton("actDelete", "Delete", "fa-solid fa-trash"));
    }
  }

  function renderList() {
    $("resultMeta").textContent = `${EXP.length} expense(s)`;
    $("checkAll").checked = EXP.length > 0 && EXP.every((expense) => state.selected.has(expense.id));
    const body = $("tbody");
    body.replaceChildren();

    if (!EXP.length) {
      const row = node("tr");
      const cell = node("td");
      cell.colSpan = 9;
      cell.style.padding = "18px";
      cell.append(node("div", "muted", "No expenses found."));
      row.append(cell);
      body.append(row);
      return;
    }

    for (const expense of EXP) {
      const row = node("tr");
      row.dataset.id = String(expense.id || "");

      const selectCell = node("td");
      const checkbox = node("input", "rowCheck");
      checkbox.type = "checkbox";
      checkbox.dataset.id = String(expense.id || "");
      checkbox.checked = state.selected.has(expense.id);
      selectCell.append(checkbox);

      const expenseCell = node("td");
      expenseCell.append(node("div", "strong", expense.title || ""));
      const meta = node("div", "muted", expense.expenseNo || "—");
      if (expense.voucherNo) meta.append(document.createTextNode(` • ${expense.voucherNo}`));
      expenseCell.append(meta);

      const categoryCell = node("td");
      categoryCell.append(pill("info", "fa-solid fa-tag", expense.category || "Other"));
      const paidCell = node("td", "", expense.paidTo || "—");
      const methodCell = node("td");
      methodCell.append(pill("info", "fa-solid fa-wallet", expense.method || "Other"));
      const dateCell = node("td", "muted", expense.expenseDate || "—");
      const amountCell = node("td");
      amountCell.append(node("div", "strong", money(expense.amount || 0)));
      const statusCell = node("td");
      statusCell.append(statusPill(expense));
      const actionCell = node("td");
      const actions = node("div", "actions");
      appendExpenseActions(actions, expense);
      actionCell.append(actions);

      row.append(selectCell, expenseCell, categoryCell, paidCell, methodCell, dateCell, amountCell, statusCell, actionCell);
      body.append(row);
    }
  }

  function renderCategories() {
    const grouped = Object.entries(
      EXP.reduce((acc, expense) => {
        const key = expense.category || "Other";
        acc[key] = (acc[key] || 0) + Number(expense.amount || 0);
        return acc;
      }, {})
    )
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);
    const total = grouped.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    $("resultMeta").textContent = `${grouped.length} categor${grouped.length === 1 ? "y" : "ies"}`;

    const body = $("tbodyCategories");
    body.replaceChildren();
    if (!grouped.length) {
      const row = node("tr");
      const cell = node("td");
      cell.colSpan = 3;
      cell.style.padding = "18px";
      cell.append(node("div", "muted", "No category data found."));
      row.append(cell);
      body.append(row);
      return;
    }

    for (const item of grouped) {
      const share = total > 0 ? ((Number(item.amount || 0) / total) * 100).toFixed(1) : "0.0";
      const row = node("tr");
      const labelCell = node("td");
      labelCell.append(node("div", "strong", item.label || "Other"));
      const amountCell = node("td", "", money(item.amount || 0));
      const shareCell = node("td");
      shareCell.append(pill("warn", "fa-solid fa-chart-pie", `${share}%`));
      row.append(labelCell, amountCell, shareCell);
      body.append(row);
    }
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

  function openEditor(expense) {
    const item = expense || null;
    if (item?.status === "Approved") return;
    $("mTitle").textContent = item ? "Edit Expense" : "Record Expense";
    const form = $("expenseForm");
    form.action = item ? `/admin/expenses/${item.id}/update` : "/admin/expenses";
    $("eVoucherNo").value = item?.voucherNo || "";
    $("eReference").value = item?.reference || "";
    $("eTitle").value = item?.title || "";
    $("eCategory").value = item?.category || "Other";
    $("eAmount").value = item ? Number(item.amount || 0) : "";
    $("eExpenseDate").value = item?.expenseDate || "";
    $("ePaidTo").value = item?.paidTo || "";
    $("eMethod").value = item?.method || "Cash";
    $("eStatus").value = item?.status || "Recorded";
    $("eDescription").value = item?.description || "";
    $("eNotes").value = item?.notes || "";
    syncPreview();
    openModal("mEdit");
  }

  function openViewModal(expense) {
    if (!expense) return;
    $("vExpenseNo").textContent = expense.expenseNo || "—";
    $("vVoucherNo").textContent = expense.voucherNo || "—";
    $("vTitle").textContent = expense.title || "—";
    $("vCategory").textContent = expense.category || "—";
    $("vAmount").textContent = money(expense.amount || 0);
    $("vMethod").textContent = expense.method || "—";
    $("vPaidTo").textContent = expense.paidTo || "—";
    $("vStatus").textContent = expense.status || "—";
    $("vExpenseDate").textContent = expense.expenseDate || "—";
    $("vReference").textContent = expense.reference || "—";
    $("vDescription").textContent = expense.description || "—";
    $("vNotes").textContent = expense.notes || "—";
    openModal("mView");
  }

  $("btnCreate")?.addEventListener("click", () => openEditor());
  $("quickNewExpense")?.addEventListener("click", () => openEditor());

  $("viewChips")?.addEventListener("click", function (event) {
    const button = event.target.closest(".chip");
    if (button?.dataset.view) setView(button.dataset.view);
  });

  $("checkAll")?.addEventListener("change", function (event) {
    if (event.target.checked) EXP.forEach((expense) => state.selected.add(expense.id));
    else EXP.forEach((expense) => state.selected.delete(expense.id));
    render();
  });

  $("tbody")?.addEventListener("change", function (event) {
    if (!event.target.classList.contains("rowCheck")) return;
    const id = event.target.dataset.id;
    if (event.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    render();
  });

  $("tbody")?.addEventListener("click", function (event) {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;
    const expense = EXP.find((item) => item.id === row.dataset.id);
    if (!expense) return;
    if (event.target.closest(".actView")) return openViewModal(expense);
    if (event.target.closest(".actEdit")) return openEditor(expense);
    if (event.target.closest(".actRecord")) return submitRowAction(`/admin/expenses/${expense.id}/record`);
    if (event.target.closest(".actApprove")) return submitRowAction(`/admin/expenses/${expense.id}/approve`);
    if (event.target.closest(".actReject")) return submitRowAction(`/admin/expenses/${expense.id}/reject`);
    if (event.target.closest(".actDelete") && window.confirm(`Delete expense "${expense.title}"?`)) {
      return submitRowAction(`/admin/expenses/${expense.id}/delete`);
    }
  });

  $("btnBulk")?.addEventListener("click", function () {
    if (!state.selected.size) return window.alert("Select at least one expense.");
    $("bulkbar").classList.add("show");
  });
  $("bulkClear")?.addEventListener("click", function () { state.selected.clear(); render(); });
  $("bulkRecord")?.addEventListener("click", () => bulkSubmit("record"));
  $("bulkApprove")?.addEventListener("click", () => bulkSubmit("approve"));
  $("bulkReject")?.addEventListener("click", () => bulkSubmit("reject"));
  $("bulkDraft")?.addEventListener("click", () => bulkSubmit("draft"));
  $("bulkDelete")?.addEventListener("click", function () {
    if (state.selected.size && window.confirm("Delete selected expenses? Approved records will remain locked.")) bulkSubmit("delete");
  });

  $("eCategory")?.addEventListener("change", syncPreview);
  $("eAmount")?.addEventListener("input", syncPreview);

  document.querySelectorAll("[data-close-modal]").forEach(function (button) {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });
  ["mEdit", "mView"].forEach(function (id) {
    $(id)?.addEventListener("click", function (event) {
      if (event.target.id === id) closeModal(id);
    });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((item) => item.classList.remove("show"));
  });

  $("btnExport")?.addEventListener("click", function () {
    const url = new URL(window.location.href);
    url.pathname = "/admin/expenses/export.csv";
    url.searchParams.delete("view");
    window.location.assign(`${url.pathname}${url.search}`);
  });

  syncPreview();
  setView(state.view);
})();

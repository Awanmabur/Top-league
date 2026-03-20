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

  const INV = readJson("invoicesData");
  const PAY = readJson("paymentsData");

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
    if (a.status === "Paid") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Paid</span>';
    if (a.status === "Partially Paid") return '<span class="pill warn"><i class="fa-solid fa-clock"></i> Partially Paid</span>';
    if (a.status === "Unpaid") return '<span class="pill bad"><i class="fa-solid fa-triangle-exclamation"></i> Unpaid</span>';
    if (a.status === "Overdue") return '<span class="pill bad"><i class="fa-solid fa-hourglass-end"></i> Overdue</span>';
    if (a.status === "Draft") return '<span class="pill draft"><i class="fa-solid fa-file"></i> Draft</span>';
    return '<span class="pill info"><i class="fa-solid fa-ban"></i> Cancelled</span>';
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
    $("view-payments").style.display = v === "payments" ? "" : "none";
    $("view-summary").style.display = v === "summary" ? "" : "none";

    const titles = {
      list: ["Invoices", "Manage invoice records, balances and billing details."],
      payments: ["Payments", "Recent payment activity tied to finance workflows."],
      summary: ["Summary", "Invoice status summary and billing snapshot."],
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${INV.length} invoice(s)`;
    $("checkAll").checked = INV.length > 0 && INV.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = INV.map((a) => {
      const checked = state.selected.has(a.id) ? "checked" : "";
      return `
        <tr data-id="${a.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${a.id}" ${checked}></td>
          <td>
            <div class="strong">${a.invoiceNo || ""}</div>
            <div class="muted">${a.reference || "No reference"}</div>
          </td>
          <td>
            <div class="strong">${a.studentName || "—"}</div>
            <div class="muted">${a.academicYear || "—"} ${a.term ? `• ${a.term}` : ""}</div>
          </td>
          <td>${a.programName || "—"}</td>
          <td>
            <div class="strong">${a.issueDate || "—"}</div>
            <div class="muted">Due: ${a.dueDate || "—"}</div>
          </td>
          <td>${money(a.totalAmount)}</td>
          <td>${money(a.paidAmount)}</td>
          <td>${money(a.balance)}</td>
          <td>${pillStatus(a)}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-xs actPaid" type="button" title="Mark Paid"><i class="fa-solid fa-circle-check"></i></button>
              <button class="btn-xs actCancel" type="button" title="Cancel"><i class="fa-solid fa-ban"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="10" style="padding:18px;"><div class="muted">No invoices found.</div></td></tr>';
  }

  function renderPayments() {
    $("resultMeta").textContent = `${PAY.length} payment(s)`;
    $("tbodyPayments").innerHTML = PAY.map((p) => `
      <tr>
        <td><div class="strong">${p.receiptNo || ""}</div></td>
        <td>${p.studentName || "—"}</td>
        <td>${money(p.amount)}</td>
        <td><span class="pill info"><i class="fa-solid fa-wallet"></i> ${p.method || "Cash"}</span></td>
        <td><span class="pill ok"><i class="fa-solid fa-circle-check"></i> ${p.status || "Completed"}</span></td>
        <td class="muted">${p.paymentDate || "—"}</td>
      </tr>
    `).join("") || '<tr><td colspan="6" style="padding:18px;"><div class="muted">No payments found.</div></td></tr>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "payments") renderPayments();
  }

  function createItemRow(item) {
    const tr = document.createElement("tr");
    tr.className = "itemRow";
    tr.innerHTML = `
      <td>
        <input class="input item-title" name="itemTitle" placeholder="e.g. Tuition Fee" value="${item?.title || ""}">
      </td>
      <td>
        <select class="select item-category" name="itemCategory">
          <option ${item?.category === "Tuition" ? "selected" : ""}>Tuition</option>
          <option ${item?.category === "Registration" ? "selected" : ""}>Registration</option>
          <option ${item?.category === "Library" ? "selected" : ""}>Library</option>
          <option ${item?.category === "Hostel" ? "selected" : ""}>Hostel</option>
          <option ${item?.category === "Examination" ? "selected" : ""}>Examination</option>
          <option ${item?.category === "Transport" ? "selected" : ""}>Transport</option>
          <option ${item?.category === "Other" ? "selected" : ""}>Other</option>
        </select>
      </td>
      <td>
        <input class="input item-qty calc-input" name="itemQty" type="number" min="1" step="1" value="${item?.qty || 1}">
      </td>
      <td>
        <input class="input item-unit calc-input" name="itemUnitAmount" type="number" min="0" step="0.01" value="${item?.unitAmount || 0}">
      </td>
      <td>
        <input class="input item-amount" type="text" value="${money(item?.amount || 0)}" readonly>
      </td>
      <td>
        <input class="input" name="itemNote" placeholder="Optional note" value="${item?.note || ""}">
      </td>
      <td>
        <button class="icon-btn removeItemBtn" type="button"><i class="fa-solid fa-trash"></i></button>
      </td>
    `;
    return tr;
  }

  function fillDefaultItemRows(items) {
    const tbody = $("itemsTbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    const rows = Array.isArray(items) && items.length ? items : [{ title: "", category: "Tuition", qty: 1, unitAmount: 0, amount: 0, note: "" }];
    rows.forEach((item) => tbody.appendChild(createItemRow(item)));
    syncTotals();
  }

  function syncTotals() {
    const rows = Array.from(document.querySelectorAll("#itemsTbody .itemRow"));
    let subtotal = 0;

    rows.forEach((row) => {
      const qty = Number(row.querySelector(".item-qty")?.value || 0);
      const unit = Number(row.querySelector(".item-unit")?.value || 0);
      const amount = qty * unit;
      subtotal += amount;
      const amountEl = row.querySelector(".item-amount");
      if (amountEl) amountEl.value = money(amount);
    });

    const discount = Number($("iDiscount")?.value || 0);
    const tax = Number($("iTax")?.value || 0);
    const total = Math.max(0, subtotal - discount + tax);

    $("subTotalPreview").textContent = money(subtotal);
    $("discountPreview").textContent = money(discount);
    $("taxPreview").textContent = money(tax);
    $("totalPreview").textContent = money(total);
  }

  function openEditor(pref) {
    pref = pref || null;

    $("mTitle").textContent = pref ? "Edit Invoice" : "Create Invoice";
    const form = $("invoiceForm");
    form.action = pref ? `/admin/invoices/${pref.id}/update` : "/admin/invoices";

    $("iStudent").value = pref ? (pref.studentId || "") : "";
    $("iProgram").value = pref ? (pref.programId || "") : "";
    $("iReference").value = pref ? (pref.reference || "") : "";
    $("iStatus").value = pref ? ((pref.status === "Draft" || pref.status === "Cancelled") ? "Draft" : "Unpaid") : "Unpaid";
    $("iAcademicYear").value = pref ? (pref.academicYear || "") : "";
    $("iTerm").value = pref ? (pref.term || "") : "";
    $("iIssueDate").value = pref ? (pref.issueDate || "") : "";
    $("iDueDate").value = pref ? (pref.dueDate || "") : "";
    $("iCurrency").value = pref ? (pref.currency || "UGX") : "UGX";
    $("iDiscount").value = pref ? Number(pref.discountAmount || 0) : 0;
    $("iTax").value = pref ? Number(pref.taxAmount || 0) : 0;
    $("iNotes").value = pref ? (pref.notes || "") : "";

    fillDefaultItemRows(pref ? pref.items : null);
    openModal("mEdit");
  }

  function openViewModal(a) {
    if (!a) return;

    $("vInvoiceNo").textContent = a.invoiceNo || "—";
    $("vStudent").textContent = a.studentName || "—";
    $("vProgram").textContent = a.programName || "—";
    $("vStatus").textContent = a.status || "—";
    $("vIssueDate").textContent = a.issueDate || "—";
    $("vDueDate").textContent = a.dueDate || "—";
    $("vTotal").textContent = money(a.totalAmount || 0);
    $("vBalance").textContent = money(a.balance || 0);

    const items = (a.items || []).map((x) => {
      return `• ${x.title || ""} — ${x.category || "Other"} — Qty ${x.qty || 1} × ${money(x.unitAmount || 0)} = ${money(x.amount || 0)}`;
    }).join("\n");

    $("vItems").textContent = items || "—";
    $("vNotes").textContent = a.notes || "—";

    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickNewInvoice").addEventListener("click", function () {
    openEditor();
  });

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) INV.forEach((a) => state.selected.add(a.id));
    else INV.forEach((a) => state.selected.delete(a.id));
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

    const a = INV.find((x) => x.id === tr.dataset.id);
    if (!a) return;

    if (e.target.closest(".actView")) return openViewModal(a);
    if (e.target.closest(".actEdit")) return openEditor(a);

    if (e.target.closest(".actPaid")) {
      if (window.confirm(`Mark invoice "${a.invoiceNo}" as paid?`)) {
        return submitRowAction(`/admin/invoices/${a.id}/mark-paid`);
      }
    }

    if (e.target.closest(".actCancel")) {
      if (window.confirm(`Cancel invoice "${a.invoiceNo}"?`)) {
        return submitRowAction(`/admin/invoices/${a.id}/cancel`);
      }
    }

    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete invoice "${a.invoiceNo}"?`)) {
        return submitRowAction(`/admin/invoices/${a.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one invoice.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkMarkPaid").addEventListener("click", function () { bulkSubmit("markPaid"); });
  $("bulkDraft").addEventListener("click", function () { bulkSubmit("draft"); });
  $("bulkCancel").addEventListener("click", function () { bulkSubmit("cancel"); });
  $("bulkDelete").addEventListener("click", function () {
    if (!state.selected.size) return;
    if (window.confirm("Delete selected invoices?")) bulkSubmit("delete");
  });

  $("addItemBtn").addEventListener("click", function () {
    $("itemsTbody").appendChild(createItemRow({}));
    syncTotals();
  });

  $("itemsTbody").addEventListener("input", function (e) {
    if (e.target.closest(".itemRow")) syncTotals();
  });

  $("itemsTbody").addEventListener("click", function (e) {
    const btn = e.target.closest(".removeItemBtn");
    if (!btn) return;
    const rows = document.querySelectorAll("#itemsTbody .itemRow");
    if (rows.length <= 1) {
      alert("At least one item is required.");
      return;
    }
    btn.closest(".itemRow")?.remove();
    syncTotals();
  });

  document.querySelectorAll(".calc-input").forEach(function (el) {
    el.addEventListener("input", syncTotals);
  });

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
    alert("Hook export route later.");
  });

  fillDefaultItemRows(null);
  setView("list");
  render();
})();
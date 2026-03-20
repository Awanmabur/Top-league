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

  const PAY = readJson("paymentsData");
  const INV = readJson("invoicesData");

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
    if (a.status === "Completed") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Completed</span>';
    if (a.status === "Pending") return '<span class="pill warn"><i class="fa-solid fa-clock"></i> Pending</span>';
    if (a.status === "Voided") return '<span class="pill bad"><i class="fa-solid fa-ban"></i> Voided</span>';
    return '<span class="pill info"><i class="fa-solid fa-rotate-left"></i> Refunded</span>';
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
    $("view-allocations").style.display = v === "allocations" ? "" : "none";
    $("view-summary").style.display = v === "summary" ? "" : "none";

    const titles = {
      list: ["Payments", "Manage payment entries, receipts and settlement activity."],
      allocations: ["Allocations", "Review how payments are linked to invoice records."],
      summary: ["Summary", "Payment status summary and collection snapshot."],
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${PAY.length} payment(s)`;
    $("checkAll").checked = PAY.length > 0 && PAY.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML =
      PAY.map((a) => {
        const checked = state.selected.has(a.id) ? "checked" : "";
        return `
          <tr data-id="${a.id}">
            <td><input type="checkbox" class="rowCheck" data-id="${a.id}" ${checked}></td>
            <td>
              <div class="strong">${a.receiptNo || ""}</div>
              <div class="muted">${a.reference || "No reference"}</div>
            </td>
            <td>
              <div class="strong">${a.studentName || "—"}</div>
              <div class="muted">${a.academicYear || "—"} ${a.term ? `• ${a.term}` : ""}</div>
            </td>
            <td>${a.invoiceNo || "Unallocated"}</td>
            <td>${a.programName || "—"}</td>
            <td>${money(a.amount)}</td>
            <td><span class="pill info"><i class="fa-solid fa-wallet"></i> ${a.method || "Cash"}</span></td>
            <td class="muted">${a.paymentDate || "—"}</td>
            <td>${pillStatus(a)}</td>
            <td>
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actVoid" type="button" title="Void"><i class="fa-solid fa-ban"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      '<tr><td colspan="10" style="padding:18px;"><div class="muted">No payments found.</div></td></tr>';
  }

  function renderAllocations() {
    $("resultMeta").textContent = `${PAY.length} payment(s)`;
    $("tbodyAlloc").innerHTML =
      PAY.map((p) => `
        <tr>
          <td><div class="strong">${p.receiptNo || ""}</div></td>
          <td>${p.studentName || "—"}</td>
          <td>${p.invoiceNo || "Unallocated"}</td>
          <td>${money(p.amount)}</td>
          <td>${pillStatus(p)}</td>
          <td class="muted">${p.paymentDate || "—"}</td>
        </tr>
      `).join("") ||
      '<tr><td colspan="6" style="padding:18px;"><div class="muted">No allocation data found.</div></td></tr>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "allocations") renderAllocations();
  }

  function openEditor(pref) {
    pref = pref || null;

    $("mTitle").textContent = pref ? "Edit Payment" : "Record Payment";
    const form = $("paymentForm");
    form.action = pref ? `/admin/payments/${pref.id}/update` : "/admin/payments";

    $("pStudent").value = pref ? (pref.studentId || "") : "";
    $("pInvoice").value = pref ? (pref.invoiceId || "") : "";
    $("pProgram").value = pref ? (pref.programId || "") : "";
    $("pReference").value = pref ? (pref.reference || "") : "";
    $("pAmount").value = pref ? Number(pref.amount || 0) : "";
    $("pMethod").value = pref ? (pref.method || "Cash") : "Cash";
    $("pStatus").value = pref ? (pref.status || "Completed") : "Completed";
    $("pPaymentDate").value = pref ? (pref.paymentDate || "") : "";
    $("pAcademicYear").value = pref ? (pref.academicYear || "") : "";
    $("pTerm").value = pref ? (pref.term || "") : "";
    $("pNotes").value = pref ? (pref.notes || "") : "";

    syncInvoicePreview();
    openModal("mEdit");
  }

  function openViewModal(a) {
    if (!a) return;

    $("vReceiptNo").textContent = a.receiptNo || "—";
    $("vStudent").textContent = a.studentName || "—";
    $("vInvoiceNo").textContent = a.invoiceNo || "Unallocated";
    $("vProgram").textContent = a.programName || "—";
    $("vAmount").textContent = money(a.amount || 0);
    $("vMethod").textContent = a.method || "—";
    $("vStatus").textContent = a.status || "—";
    $("vPaymentDate").textContent = a.paymentDate || "—";
    $("vNotes").textContent = a.notes || "—";

    openModal("mView");
  }

  function syncInvoicePreview() {
    const selectedId = $("pInvoice").value;
    const inv = INV.find((x) => x.id === selectedId);

    $("selectedInvoiceNo").textContent = inv ? (inv.invoiceNo || "—") : "Unallocated";
    $("selectedInvoiceBalance").textContent = inv ? money(inv.balance || 0) : "0";
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickNewPayment").addEventListener("click", function () {
    openEditor();
  });

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) PAY.forEach((a) => state.selected.add(a.id));
    else PAY.forEach((a) => state.selected.delete(a.id));
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

    const a = PAY.find((x) => x.id === tr.dataset.id);
    if (!a) return;

    if (e.target.closest(".actView")) return openViewModal(a);
    if (e.target.closest(".actEdit")) return openEditor(a);

    if (e.target.closest(".actVoid")) {
      if (window.confirm(`Void payment "${a.receiptNo}"?`)) {
        return submitRowAction(`/admin/payments/${a.id}/void`);
      }
    }

    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete payment "${a.receiptNo}"?`)) {
        return submitRowAction(`/admin/payments/${a.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one payment.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkComplete").addEventListener("click", function () { bulkSubmit("complete"); });
  $("bulkPending").addEventListener("click", function () { bulkSubmit("pending"); });
  $("bulkVoid").addEventListener("click", function () { bulkSubmit("void"); });
  $("bulkDelete").addEventListener("click", function () {
    if (!state.selected.size) return;
    if (window.confirm("Delete selected payments?")) bulkSubmit("delete");
  });

  $("pInvoice").addEventListener("change", syncInvoicePreview);

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

  syncInvoicePreview();
  setView("list");
  render();
})();
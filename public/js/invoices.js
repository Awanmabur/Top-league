(function () {
  const $ = (id) => document.getElementById(id);
  const INV = readJson("invoicesData", []);
  const PAY = readJson("paymentsData", []);
  const TEMPLATE = readJson("invoiceTemplateData", null);
  const totalRows = Number($("invoicesTotalData")?.value || INV.length) || INV.length;
  if (!$("tbody")) return;

  const state = { view: "list", selected: new Set() };

  function readJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try { return JSON.parse(el.value || JSON.stringify(fallback)); }
    catch (_) { return fallback; }
  }
  function money(v) { return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function node(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function icon(name) { const i = node("i", `fa-solid ${name}`); return i; }
  function button(cls, title, iconName) {
    const b = node("button", cls); b.type = "button"; b.title = title; b.appendChild(icon(iconName)); return b;
  }
  function openModal(id) { $(id)?.classList.add("show"); }
  function closeModal(id) { $(id)?.classList.remove("show"); }
  function submitRowAction(url) { const form = $("rowActionForm"); if (!form) return; form.action = url; form.submit(); }
  function bulkSubmit(action) {
    const ids = [...state.selected];
    if (!ids.length) return;
    $("bulkIds").value = ids.join(","); $("bulkActionInput").value = action; $("bulkForm").submit();
  }
  function statusPill(status) {
    const map = {
      Paid: ["pill ok", "fa-circle-check"],
      "Partially Paid": ["pill warn", "fa-clock"],
      Unpaid: ["pill bad", "fa-triangle-exclamation"],
      Overdue: ["pill bad", "fa-hourglass-end"],
      Draft: ["pill draft", "fa-file"],
      Cancelled: ["pill info", "fa-ban"],
    };
    const [cls, ic] = map[status] || ["pill info", "fa-circle-info"];
    const span = node("span", cls); span.append(icon(ic), document.createTextNode(` ${status || "Unpaid"}`)); return span;
  }
  function syncBulkbar() {
    if ($("selCount")) $("selCount").textContent = state.selected.size;
    $("bulkbar")?.classList.toggle("show", state.selected.size > 0 && state.view === "list");
  }
  function setView(v) {
    state.view = v;
    document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    ["list", "payments", "summary"].forEach((name) => { const x = $(`view-${name}`); if (x) x.style.display = v === name ? "" : "none"; });
    const titles = {
      list: ["Invoices", "Manage invoice records, balances and billing details."],
      payments: ["Payments", "Recent payment activity tied to finance workflows."],
      summary: ["Summary", "Invoice status summary and billing snapshot."],
    };
    if ($("panelTitle")) $("panelTitle").textContent = titles[v]?.[0] || "Invoices";
    if ($("panelSub")) $("panelSub").textContent = titles[v]?.[1] || "";
    render();
  }
  function tdText(text, className) { return node("td", className || "", text); }
  function renderList() {
    const body = $("tbody"); body.replaceChildren();
    $("resultMeta").textContent = `Showing ${INV.length} of ${totalRows} invoice(s)`;
    $("checkAll").checked = INV.length > 0 && INV.every((x) => state.selected.has(x.id));
    if (!INV.length) {
      const tr = node("tr"); const td = tdText("No invoices found.", "muted"); td.colSpan = 10; td.style.padding = "18px"; tr.appendChild(td); body.appendChild(tr); return;
    }
    INV.forEach((a) => {
      const tr = node("tr"); tr.dataset.id = a.id;
      const ctd = node("td"); const cb = node("input", "rowCheck"); cb.type = "checkbox"; cb.dataset.id = a.id; cb.checked = state.selected.has(a.id); ctd.appendChild(cb); tr.appendChild(ctd);

      const invTd = node("td"); invTd.append(node("div", "strong", a.invoiceNo || ""), node("div", "muted", a.reference || "No reference")); tr.appendChild(invTd);
      const stTd = node("td"); stTd.append(node("div", "strong", a.studentName || "—"), node("div", "muted", `${a.academicYear || "—"}${a.term ? ` • ${a.term}` : ""}`)); tr.appendChild(stTd);
      tr.appendChild(tdText(a.programName || "—"));
      const dateTd = node("td"); dateTd.append(node("div", "strong", a.issueDate || "—"), node("div", "muted", `Due: ${a.dueDate || "—"}`)); tr.appendChild(dateTd);
      tr.append(tdText(money(a.totalAmount)), tdText(money(a.paidAmount)), tdText(money(a.balance)));
      const statusTd = node("td"); statusTd.appendChild(statusPill(a.status)); tr.appendChild(statusTd);
      const actionTd = node("td"); const actions = node("div", "actions");
      actions.append(button("btn-xs actView", "View", "fa-eye"), button("btn-xs actEdit", "Edit", "fa-pen"));
      if (!["Paid", "Cancelled", "Draft"].includes(a.status)) actions.appendChild(button("btn-xs actPaid", "Settle balance", "fa-circle-check"));
      if (!["Paid", "Cancelled"].includes(a.status)) actions.appendChild(button("btn-xs actCancel", "Cancel", "fa-ban"));
      if (["Draft", "Cancelled"].includes(a.status)) actions.appendChild(button("btn-xs actDelete", "Archive", "fa-trash"));
      actionTd.appendChild(actions); tr.appendChild(actionTd); body.appendChild(tr);
    });
  }
  function renderPayments() {
    const body = $("tbodyPayments"); if (!body) return; body.replaceChildren();
    $("resultMeta").textContent = `${PAY.length} payment(s)`;
    if (!PAY.length) { const tr = node("tr"); const td = tdText("No payments found.", "muted"); td.colSpan = 6; td.style.padding = "18px"; tr.appendChild(td); body.appendChild(tr); return; }
    PAY.forEach((p) => {
      const tr = node("tr");
      const receipt = node("td"); const a = node("a", "strong", p.receiptNo || ""); a.href = `/admin/payments/${encodeURIComponent(p.id)}/receipt`; receipt.appendChild(a); tr.appendChild(receipt);
      tr.append(tdText(p.studentName || "—"), tdText(money(p.amount)));
      const m = node("td"); const pill = node("span", "pill info"); pill.append(icon("fa-wallet"), document.createTextNode(` ${p.method || "Other"}`)); m.appendChild(pill); tr.appendChild(m);
      const st = node("td"); st.appendChild(statusPill(p.status)); tr.append(st, tdText(p.paymentDate || "—", "muted")); body.appendChild(tr);
    });
  }
  function render() { syncBulkbar(); if (state.view === "list") renderList(); else if (state.view === "payments") renderPayments(); }

  function inputCell(input) { const td = node("td"); td.appendChild(input); return td; }
  function createItemRow(item) {
    item = item || {};
    const tr = node("tr", "itemRow");
    const title = node("input", "input item-title"); title.name = "itemTitle"; title.placeholder = "e.g. Tuition Fee"; title.value = item.title || "";
    const category = node("select", "select item-category"); category.name = "itemCategory";
    ["Tuition", "Registration", "Library", "Hostel", "Examination", "Transport", "Other"].forEach((v) => { const o = node("option", "", v); o.value = v; o.selected = (item.category || "Tuition") === v; category.appendChild(o); });
    const qty = node("input", "input item-qty calc-input"); qty.name = "itemQty"; qty.type = "number"; qty.min = "1"; qty.step = "1"; qty.value = Number(item.qty || 1);
    const unit = node("input", "input item-unit calc-input"); unit.name = "itemUnitAmount"; unit.type = "number"; unit.min = "0"; unit.step = "0.01"; unit.value = Number(item.unitAmount || 0);
    const amount = node("input", "input item-amount"); amount.type = "text"; amount.value = money(item.amount || 0); amount.readOnly = true;
    const note = node("input", "input"); note.name = "itemNote"; note.placeholder = "Optional note"; note.value = item.note || "";
    const remove = button("icon-btn removeItemBtn", "Remove item", "fa-trash");
    tr.append(inputCell(title), inputCell(category), inputCell(qty), inputCell(unit), inputCell(amount), inputCell(note), inputCell(remove));
    return tr;
  }
  function fillItemRows(items) {
    const tbody = $("itemsTbody"); tbody.replaceChildren();
    const rows = Array.isArray(items) && items.length ? items : [{}]; rows.forEach((item) => tbody.appendChild(createItemRow(item))); syncTotals();
  }
  function syncTotals() {
    let subtotal = 0;
    document.querySelectorAll("#itemsTbody .itemRow").forEach((row) => {
      const qty = Number(row.querySelector(".item-qty")?.value || 0); const unit = Number(row.querySelector(".item-unit")?.value || 0); const val = qty * unit; subtotal += val;
      const out = row.querySelector(".item-amount"); if (out) out.value = money(val);
    });
    const discount = Number($("iDiscount")?.value || 0); const tax = Number($("iTax")?.value || 0); const total = Math.max(0, subtotal - discount + tax);
    $("subTotalPreview").textContent = money(subtotal); $("discountPreview").textContent = money(discount); $("taxPreview").textContent = money(tax); $("totalPreview").textContent = money(total);
  }
  function openEditor(pref, template) {
    const base = pref || template || {};
    $("mTitle").textContent = pref ? "Edit Invoice" : (template ? `Create Invoice — ${template.name || "Fee Structure"}` : "Create Invoice");
    $("invoiceForm").action = pref ? `/admin/invoices/${encodeURIComponent(pref.id)}/update` : "/admin/invoices";
    $("iFeeStructure").value = pref?.feeStructureId || template?.id || "";
    $("iStudent").value = pref?.studentId || ""; $("iProgram").value = base.programId || ""; $("iReference").value = pref?.reference || "";
    $("iStatus").value = pref?.status === "Draft" ? "Draft" : "Unpaid"; $("iAcademicYear").value = base.academicYear || ""; $("iTerm").value = base.term || "";
    $("iIssueDate").value = pref?.issueDate || ""; $("iDueDate").value = pref?.dueDate || ""; $("iCurrency").value = pref?.currency || "UGX";
    $("iDiscount").value = Number(pref?.discountAmount || 0); $("iTax").value = Number(pref?.taxAmount || 0); $("iNotes").value = pref?.notes || template?.notes || "";
    fillItemRows(base.items); openModal("mEdit");
  }
  function openView(a) {
    $("vInvoiceNo").textContent = a.invoiceNo || "—"; $("vStudent").textContent = a.studentName || "—"; $("vProgram").textContent = a.programName || "—";
    $("vStatus").textContent = a.status || "—"; $("vIssueDate").textContent = a.issueDate || "—"; $("vDueDate").textContent = a.dueDate || "—";
    $("vTotal").textContent = money(a.totalAmount); $("vBalance").textContent = money(a.balance); $("vNotes").textContent = a.notes || "—";
    $("vItems").replaceChildren(...((a.items || []).map((it) => node("div", "", `${it.title || "Item"} — ${money(it.amount)}`))));
    if (!(a.items || []).length) $("vItems").textContent = "—";
    openModal("mView");
  }

  $("btnCreate")?.addEventListener("click", () => openEditor()); $("quickNewInvoice")?.addEventListener("click", () => openEditor());
  $("viewChips")?.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) setView(b.dataset.view); });
  $("checkAll")?.addEventListener("change", (e) => { if (e.target.checked) INV.forEach((x) => state.selected.add(x.id)); else state.selected.clear(); render(); });
  $("tbody")?.addEventListener("change", (e) => { if (!e.target.classList.contains("rowCheck")) return; e.target.checked ? state.selected.add(e.target.dataset.id) : state.selected.delete(e.target.dataset.id); render(); });
  $("tbody")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]"); if (!tr) return; const a = INV.find((x) => x.id === tr.dataset.id); if (!a) return;
    if (e.target.closest(".actView")) return openView(a); if (e.target.closest(".actEdit")) return openEditor(a);
    if (e.target.closest(".actPaid") && confirm(`Settle the outstanding balance for ${a.invoiceNo}? A real payment receipt will be created.`)) return submitRowAction(`/admin/invoices/${encodeURIComponent(a.id)}/mark-paid`);
    if (e.target.closest(".actCancel") && confirm(`Cancel invoice ${a.invoiceNo}?`)) return submitRowAction(`/admin/invoices/${encodeURIComponent(a.id)}/cancel`);
    if (e.target.closest(".actDelete") && confirm(`Archive invoice ${a.invoiceNo}?`)) return submitRowAction(`/admin/invoices/${encodeURIComponent(a.id)}/delete`);
  });
  $("btnBulk")?.addEventListener("click", () => { if (!state.selected.size) return alert("Select at least one invoice."); $("bulkbar").classList.add("show"); });
  $("bulkClear")?.addEventListener("click", () => { state.selected.clear(); render(); });
  $("bulkMarkPaid")?.addEventListener("click", () => bulkSubmit("markPaid")); $("bulkCancel")?.addEventListener("click", () => bulkSubmit("cancel"));
  $("bulkDraft")?.addEventListener("click", () => alert("Issued invoices cannot be moved backward to Draft."));
  $("bulkDelete")?.addEventListener("click", () => { if (state.selected.size && confirm("Archive selected Draft/Cancelled invoices?")) bulkSubmit("delete"); });
  $("addItemBtn")?.addEventListener("click", () => { $("itemsTbody").appendChild(createItemRow({})); syncTotals(); });
  $("itemsTbody")?.addEventListener("click", (e) => { const b = e.target.closest(".removeItemBtn"); if (!b) return; const rows = document.querySelectorAll("#itemsTbody .itemRow"); if (rows.length <= 1) return alert("At least one item is required."); b.closest(".itemRow")?.remove(); syncTotals(); });
  $("itemsTbody")?.addEventListener("input", (e) => { if (e.target.classList.contains("calc-input")) syncTotals(); });
  ["iDiscount", "iTax"].forEach((id) => $(id)?.addEventListener("input", syncTotals));
  document.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.closeModal)));
  ["mEdit", "mView"].forEach((id) => $(id)?.addEventListener("click", (e) => { if (e.target.id === id) closeModal(id); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((x) => x.classList.remove("show")); });
  $("btnExport")?.addEventListener("click", () => { window.location.href = `/admin/invoices/export.csv${window.location.search || ""}`; });

  fillItemRows(); setView("list"); render();
  if (TEMPLATE && TEMPLATE.id) openEditor(null, TEMPLATE);
})();

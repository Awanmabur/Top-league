(function () {
  const $ = (id) => document.getElementById(id);
  const PAY = readJson("paymentsData", []);
  const INV = readJson("invoicesData", []);
  if (!$("tbody")) return;
  const state = { view: "list", selected: new Set() };

  function readJson(id, fallback) { const el = $(id); if (!el) return fallback; try { return JSON.parse(el.value || JSON.stringify(fallback)); } catch (_) { return fallback; } }
  function money(v) { return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function node(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined && text !== null) n.textContent = String(text); return n; }
  function icon(name) { return node("i", `fa-solid ${name}`); }
  function button(cls, title, iconName) { const b = node("button", cls); b.type = "button"; b.title = title; b.appendChild(icon(iconName)); return b; }
  function openModal(id) { $(id)?.classList.add("show"); }
  function closeModal(id) { $(id)?.classList.remove("show"); }
  function submitRowAction(url) { const f = $("rowActionForm"); if (!f) return; f.action = url; f.submit(); }
  function bulkSubmit(action) { const ids = [...state.selected]; if (!ids.length) return; $("bulkIds").value = ids.join(","); $("bulkActionInput").value = action; $("bulkForm").submit(); }
  function statusPill(status) {
    const map = { Completed: ["pill ok", "fa-circle-check"], Pending: ["pill warn", "fa-clock"], Voided: ["pill bad", "fa-ban"], Refunded: ["pill info", "fa-rotate-left"] };
    const [cls, ic] = map[status] || ["pill info", "fa-circle-info"]; const s = node("span", cls); s.append(icon(ic), document.createTextNode(` ${status || "Pending"}`)); return s;
  }
  function methodPill(method) { const s = node("span", "pill info"); s.append(icon("fa-wallet"), document.createTextNode(` ${method || "Other"}`)); return s; }
  function syncBulkbar() { $("selCount").textContent = state.selected.size; $("bulkbar")?.classList.toggle("show", state.selected.size > 0 && state.view === "list"); }
  function setView(v) {
    state.view = v; document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    ["list", "allocations", "summary"].forEach((name) => { const x = $(`view-${name}`); if (x) x.style.display = v === name ? "" : "none"; });
    const titles = { list: ["Payments", "Manage payment entries, receipts and settlement activity."], allocations: ["Allocations", "Review how payments are linked to invoice records."], summary: ["Summary", "Payment status summary and collection snapshot."] };
    $("panelTitle").textContent = titles[v]?.[0] || "Payments"; $("panelSub").textContent = titles[v]?.[1] || ""; render();
  }
  function td(text, className) { return node("td", className || "", text); }
  function renderList() {
    const body = $("tbody"); body.replaceChildren(); $("resultMeta").textContent = `${PAY.length} payment(s)`; $("checkAll").checked = PAY.length > 0 && PAY.every((x) => state.selected.has(x.id));
    if (!PAY.length) { const tr = node("tr"); const c = td("No payments found.", "muted"); c.colSpan = 10; c.style.padding = "18px"; tr.appendChild(c); body.appendChild(tr); return; }
    PAY.forEach((a) => {
      const tr = node("tr"); tr.dataset.id = a.id;
      const ctd = node("td"); const cb = node("input", "rowCheck"); cb.type = "checkbox"; cb.dataset.id = a.id; cb.checked = state.selected.has(a.id); ctd.appendChild(cb); tr.appendChild(ctd);
      const receiptTd = node("td"); const link = node("a", "strong", a.receiptNo || ""); link.href = `/admin/payments/${encodeURIComponent(a.id)}/receipt`; receiptTd.append(link, node("div", "muted", a.reference || "No reference")); tr.appendChild(receiptTd);
      const st = node("td"); st.append(node("div", "strong", a.studentName || "—"), node("div", "muted", `${a.academicYear || "—"}${a.term ? ` • ${a.term}` : ""}`)); tr.appendChild(st);
      tr.append(td(a.invoiceNo || "Unallocated"), td(a.programName || "—"), td(money(a.amount)));
      const method = node("td"); method.appendChild(methodPill(a.method)); tr.append(method, td(a.paymentDate || "—", "muted"));
      const status = node("td"); status.appendChild(statusPill(a.status)); tr.appendChild(status);
      const actionTd = node("td"); const actions = node("div", "actions"); actions.append(button("btn-xs actView", "View", "fa-eye"));
      if (a.status === "Pending") actions.append(button("btn-xs actEdit", "Edit", "fa-pen"), button("btn-xs actComplete", "Complete", "fa-circle-check"), button("btn-xs actDelete", "Archive", "fa-trash"));
      if (["Pending", "Completed"].includes(a.status)) actions.appendChild(button("btn-xs actVoid", "Void", "fa-ban"));
      if (a.status === "Completed") actions.appendChild(button("btn-xs actRefund", "Refund", "fa-rotate-left"));
      actionTd.appendChild(actions); tr.appendChild(actionTd); body.appendChild(tr);
    });
  }
  function renderAllocations() {
    const body = $("tbodyAlloc"); if (!body) return; body.replaceChildren(); $("resultMeta").textContent = `${PAY.length} payment(s)`;
    if (!PAY.length) { const tr = node("tr"); const c = td("No allocation data found.", "muted"); c.colSpan = 6; c.style.padding = "18px"; tr.appendChild(c); body.appendChild(tr); return; }
    PAY.forEach((p) => { const tr = node("tr"); const r = node("td"); const a = node("a", "strong", p.receiptNo || ""); a.href = `/admin/payments/${encodeURIComponent(p.id)}/receipt`; r.appendChild(a); tr.append(r, td(p.studentName || "—"), td(p.invoiceNo || "Unallocated"), td(money(p.amount))); const st = node("td"); st.appendChild(statusPill(p.status)); tr.append(st, td(p.paymentDate || "—", "muted")); body.appendChild(tr); });
  }
  function render() { syncBulkbar(); if (state.view === "list") renderList(); else if (state.view === "allocations") renderAllocations(); }
  function openEditor(pref) {
    if (pref && pref.status !== "Pending") return alert("Only Pending payments can be edited. Use Void or Refund for completed records.");
    $("mTitle").textContent = pref ? "Edit Pending Payment" : "Record Payment"; $("paymentForm").action = pref ? `/admin/payments/${encodeURIComponent(pref.id)}/update` : "/admin/payments";
    $("pStudent").value = pref?.studentId || ""; $("pInvoice").value = pref?.invoiceId || ""; $("pProgram").value = pref?.programId || ""; $("pReference").value = pref?.reference || "";
    $("pAmount").value = pref ? Number(pref.amount || 0) : ""; $("pMethod").value = pref?.method || "Cash"; $("pStatus").value = pref?.status || "Completed"; $("pPaymentDate").value = pref?.paymentDate || "";
    $("pAcademicYear").value = pref?.academicYear || ""; $("pTerm").value = pref?.term || ""; $("pNotes").value = pref?.notes || ""; syncInvoicePreview(); openModal("mEdit");
  }
  function openView(a) {
    $("vReceiptNo").textContent = a.receiptNo || "—"; $("vStudent").textContent = a.studentName || "—"; $("vInvoiceNo").textContent = a.invoiceNo || "Unallocated"; $("vProgram").textContent = a.programName || "—";
    $("vAmount").textContent = money(a.amount); $("vMethod").textContent = a.method || "—"; $("vStatus").textContent = a.status || "—"; $("vPaymentDate").textContent = a.paymentDate || "—"; $("vNotes").textContent = a.notes || "—"; openModal("mView");
  }
  function syncInvoicePreview() { const inv = INV.find((x) => x.id === $("pInvoice").value); $("selectedInvoiceNo").textContent = inv?.invoiceNo || "Unallocated"; $("selectedInvoiceBalance").textContent = inv ? money(inv.balance || 0) : "0"; if (inv && !$("pStudent").value) $("pStudent").value = inv.studentId || ""; }

  $("btnCreate")?.addEventListener("click", () => openEditor()); $("quickNewPayment")?.addEventListener("click", () => openEditor());
  $("viewChips")?.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) setView(b.dataset.view); });
  $("checkAll")?.addEventListener("change", (e) => { if (e.target.checked) PAY.forEach((x) => state.selected.add(x.id)); else state.selected.clear(); render(); });
  $("tbody")?.addEventListener("change", (e) => { if (!e.target.classList.contains("rowCheck")) return; e.target.checked ? state.selected.add(e.target.dataset.id) : state.selected.delete(e.target.dataset.id); render(); });
  $("tbody")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]"); if (!tr) return; const a = PAY.find((x) => x.id === tr.dataset.id); if (!a) return;
    if (e.target.closest(".actView")) return openView(a); if (e.target.closest(".actEdit")) return openEditor(a);
    if (e.target.closest(".actComplete") && confirm(`Complete payment ${a.receiptNo}?`)) return submitRowAction(`/admin/payments/${encodeURIComponent(a.id)}/complete`);
    if (e.target.closest(".actVoid") && confirm(`Void payment ${a.receiptNo}?`)) return submitRowAction(`/admin/payments/${encodeURIComponent(a.id)}/void`);
    if (e.target.closest(".actRefund") && confirm(`Refund payment ${a.receiptNo}?`)) return submitRowAction(`/admin/payments/${encodeURIComponent(a.id)}/refund`);
    if (e.target.closest(".actDelete") && confirm(`Archive pending payment ${a.receiptNo}?`)) return submitRowAction(`/admin/payments/${encodeURIComponent(a.id)}/delete`);
  });
  $("btnBulk")?.addEventListener("click", () => { if (!state.selected.size) return alert("Select at least one payment."); $("bulkbar").classList.add("show"); });
  $("bulkClear")?.addEventListener("click", () => { state.selected.clear(); render(); });
  $("bulkComplete")?.addEventListener("click", () => bulkSubmit("complete")); $("bulkVoid")?.addEventListener("click", () => bulkSubmit("void")); $("bulkRefund")?.addEventListener("click", () => bulkSubmit("refund"));
  $("bulkDelete")?.addEventListener("click", () => { if (state.selected.size && confirm("Archive selected Pending payments?")) bulkSubmit("delete"); });
  $("pInvoice")?.addEventListener("change", syncInvoicePreview);
  document.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.closeModal)));
  ["mEdit", "mView"].forEach((id) => $(id)?.addEventListener("click", (e) => { if (e.target.id === id) closeModal(id); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((x) => x.classList.remove("show")); });
  $("btnExport")?.addEventListener("click", () => { window.location.href = `/admin/payments/export.csv${window.location.search || ""}`; });

  syncInvoicePreview(); setView("list"); render();
})();

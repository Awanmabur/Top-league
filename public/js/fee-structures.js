(function () {
  const $ = (id) => document.getElementById(id);
  const DATA = readJson("feeStructuresData", []);
  if (!$('tbody')) return;

  const state = { view: "list", selected: new Set(), current: DATA[0] || null };

  function readJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try { return JSON.parse(el.value || JSON.stringify(fallback)); } catch (_) { return fallback; }
  }
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function icon(name) { return node("i", `fa-solid ${name}`); }
  function money(v) { return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function button(cls, title, iconName) {
    const b = node("button", cls); b.type = "button"; b.title = title; b.appendChild(icon(iconName)); return b;
  }
  function inputCell(control) { const td = node("td"); td.appendChild(control); return td; }
  function openModal(id) { $(id)?.classList.add("show"); }
  function closeModal(id) { $(id)?.classList.remove("show"); }
  function submitAction(url) { const form = $("rowActionForm"); if (!form) return; form.action = url; form.submit(); }
  function bulkSubmit(action) {
    const ids = [...state.selected];
    if (!ids.length) return alert("Select at least one fee structure.");
    $("bulkIds").value = ids.join(","); $("bulkActionInput").value = action; $("bulkForm").submit();
  }
  function statusPill(status) {
    const map = { Active: ["pill ok", "fa-circle-check"], Inactive: ["pill warn", "fa-clock"], Archived: ["pill bad", "fa-box-archive"] };
    const [cls, ic] = map[status] || ["pill info", "fa-circle-info"];
    const span = node("span", cls); span.append(icon(ic), document.createTextNode(` ${status || "Inactive"}`)); return span;
  }
  function syncBulk() {
    if ($("selCount")) $("selCount").textContent = state.selected.size;
    $("bulkbar")?.classList.toggle("show", state.selected.size > 0 && state.view === "list");
    const all = DATA.length > 0 && DATA.every((x) => state.selected.has(x.id));
    if ($("checkAll")) $("checkAll").checked = all;
  }
  function setView(view) {
    state.view = view;
    document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    ["list", "items", "summary"].forEach((name) => { const el = $(`view-${name}`); if (el) el.style.display = view === name ? "" : "none"; });
    const titles = {
      list: ["Fee Structures", "Manage billing templates and their fee line items."],
      items: ["Fee Items", "Review the line items for the selected fee structure."],
      summary: ["Summary", "Fee structure status and value snapshot."],
    };
    if ($("panelTitle")) $("panelTitle").textContent = titles[view]?.[0] || "Fee Structures";
    if ($("panelSub")) $("panelSub").textContent = titles[view]?.[1] || "";
    renderItems(); syncBulk();
  }
  function renderList() {
    const tbody = $("tbody"); tbody.replaceChildren();
    DATA.forEach((a) => {
      const tr = node("tr"); tr.dataset.id = a.id;
      const check = node("input"); check.type = "checkbox"; check.className = "rowCheck"; check.dataset.id = a.id; check.checked = state.selected.has(a.id);
      const struct = node("td"); struct.append(node("div", "strong", a.name || "Fee Structure"), node("div", "muted", a.code || "—"));
      const period = node("td"); period.append(node("div", "strong", a.academicYear || "—"), node("div", "muted", a.term || "—"));
      const actions = node("td", "actions"); actions.style.textAlign = "right";
      const view = button("btn-xs actView", "View", "fa-eye");
      const edit = button("btn-xs actEdit", "Edit", "fa-pen");
      const use = node("a", "btn-xs actUse"); use.title = "Use for invoice"; use.href = `/admin/invoices?structure=${encodeURIComponent(a.id)}`; use.appendChild(icon("fa-file-invoice-dollar"));
      actions.append(view, edit, use);
      if (a.status !== "Active") actions.appendChild(button("btn-xs actActivate", "Activate", "fa-circle-check"));
      if (a.status !== "Inactive") actions.appendChild(button("btn-xs actInactive", "Set inactive", "fa-clock"));
      if (a.status !== "Archived") actions.appendChild(button("btn-xs actArchive", "Archive", "fa-box-archive"));
      actions.appendChild(button("btn-xs actDelete", "Delete", "fa-trash"));
      tr.append(inputCell(check), struct, node("td", "", a.programName || "—"), node("td", "", a.className || "—"), node("td", "", a.intakeName || "—"), period, node("td", "strong", money(a.totalAmount)), inputCell(statusPill(a.status)), actions);
      tbody.appendChild(tr);
    });
    if (!DATA.length) {
      const tr = node("tr"); const td = node("td", "muted", "No fee structures match the current filters."); td.colSpan = 9; tr.appendChild(td); tbody.appendChild(tr);
    }
    if ($("resultMeta")) $("resultMeta").textContent = `${DATA.length} structure(s)`;
    syncBulk();
  }
  function renderItems() {
    const tbody = $("tbodyItems"); if (!tbody) return; tbody.replaceChildren();
    const a = state.current || DATA[0];
    (a?.items || []).forEach((item) => {
      const tr = node("tr"); tr.append(node("td", "strong", item.title || "Item"), node("td", "", item.category || "Other"), node("td", "", money(item.amount)), node("td", "", item.required ? "Yes" : "No"), node("td", "", item.note || "—")); tbody.appendChild(tr);
    });
    if (!a || !(a.items || []).length) { const tr = node("tr"); const td = node("td", "muted", "Select a structure with fee items."); td.colSpan = 5; tr.appendChild(td); tbody.appendChild(tr); }
  }
  function createItemRow(item = {}) {
    const tr = node("tr", "itemRow");
    const title = node("input", "input"); title.name = "itemTitle"; title.required = true; title.maxLength = 160; title.value = item.title || ""; title.placeholder = "Tuition";
    const category = node("input", "input"); category.name = "itemCategory"; category.maxLength = 80; category.value = item.category || "Other"; category.placeholder = "Tuition";
    const amount = node("input", "input calcAmount"); amount.name = "itemAmount"; amount.type = "number"; amount.min = "0"; amount.step = "0.01"; amount.value = Number(item.amount || 0);
    const requiredWrap = node("div"); const requiredHidden = node("input"); requiredHidden.type = "hidden"; requiredHidden.name = "itemRequired"; requiredHidden.value = item.required === false ? "false" : "true";
    const required = node("input", "itemRequiredCheck"); required.type = "checkbox"; required.checked = item.required !== false; required.addEventListener("change", () => { requiredHidden.value = required.checked ? "true" : "false"; syncPreviews(); }); requiredWrap.append(requiredHidden, required);
    const note = node("input", "input"); note.name = "itemNote"; note.maxLength = 300; note.value = item.note || ""; note.placeholder = "Optional";
    const remove = button("icon-btn removeItemBtn", "Remove item", "fa-trash");
    tr.append(inputCell(title), inputCell(category), inputCell(amount), inputCell(requiredWrap), inputCell(note), inputCell(remove));
    return tr;
  }
  function fillItemRows(items) {
    const tbody = $("itemsTbody"); tbody.replaceChildren();
    const rows = Array.isArray(items) && items.length ? items : [{}]; rows.forEach((item) => tbody.appendChild(createItemRow(item))); syncPreviews();
  }
  function syncPreviews() {
    const rows = [...document.querySelectorAll("#itemsTbody .itemRow")];
    const total = rows.reduce((sum, row) => sum + Number(row.querySelector(".calcAmount")?.value || 0), 0);
    const required = rows.filter((row) => row.querySelector(".itemRequiredCheck")?.checked).length;
    $("itemsCountPreview").textContent = rows.length; $("requiredCountPreview").textContent = required; $("totalPreview").textContent = money(total);
  }
  function openEditor(a) {
    $("mTitle").textContent = a ? "Edit Fee Structure" : "Create Fee Structure";
    $("feeStructureForm").action = a ? `/admin/fee-structures/${encodeURIComponent(a.id)}/update` : "/admin/fee-structures";
    $("fName").value = a?.name || ""; $("fProgram").value = a?.programId || ""; $("fClass").value = a?.classId || ""; $("fIntake").value = a?.intakeId || "";
    $("fAcademicYear").value = a?.academicYear || ""; $("fTerm").value = a?.term || ""; $("fStatus").value = a?.status || "Active"; $("fNotes").value = a?.notes || "";
    fillItemRows(a?.items); openModal("mEdit");
  }
  function openView(a) {
    state.current = a; renderItems();
    $("vName").textContent = a.name || "—"; $("vProgram").textContent = a.programName || "—"; $("vClass").textContent = a.className || "—"; $("vIntake").textContent = a.intakeName || "—";
    $("vAcademicYear").textContent = a.academicYear || "—"; $("vTerm").textContent = a.term || "—"; $("vStatus").textContent = a.status || "—"; $("vTotal").textContent = money(a.totalAmount); $("vNotes").textContent = a.notes || "—";
    const tbody = $("tbodyModalItems"); tbody.replaceChildren();
    (a.items || []).forEach((item) => { const tr = node("tr"); tr.append(node("td", "strong", item.title || "Item"), node("td", "", item.category || "Other"), node("td", "", money(item.amount)), node("td", "", item.required ? "Yes" : "No"), node("td", "", item.note || "—")); tbody.appendChild(tr); });
    openModal("mView");
  }

  $("btnCreate")?.addEventListener("click", () => openEditor()); $("quickNewStructure")?.addEventListener("click", () => openEditor());
  $("btnExport")?.addEventListener("click", () => { window.location.href = `/admin/fee-structures/export.csv${window.location.search || ""}`; });
  $("viewChips")?.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) setView(b.dataset.view); });
  $("checkAll")?.addEventListener("change", (e) => { if (e.target.checked) DATA.forEach((x) => state.selected.add(x.id)); else state.selected.clear(); renderList(); });
  $("tbody")?.addEventListener("change", (e) => { if (!e.target.classList.contains("rowCheck")) return; e.target.checked ? state.selected.add(e.target.dataset.id) : state.selected.delete(e.target.dataset.id); syncBulk(); });
  $("tbody")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]"); if (!tr) return; const a = DATA.find((x) => x.id === tr.dataset.id); if (!a) return;
    if (e.target.closest(".actView")) return openView(a); if (e.target.closest(".actEdit")) return openEditor(a); if (e.target.closest(".actUse")) return;
    if (e.target.closest(".actActivate")) return submitAction(`/admin/fee-structures/${encodeURIComponent(a.id)}/activate`);
    if (e.target.closest(".actInactive")) return submitAction(`/admin/fee-structures/${encodeURIComponent(a.id)}/inactive`);
    if (e.target.closest(".actArchive") && confirm(`Archive ${a.name}?`)) return submitAction(`/admin/fee-structures/${encodeURIComponent(a.id)}/archive`);
    if (e.target.closest(".actDelete") && confirm(`Remove ${a.name} from active fee structures? Existing invoices will keep their historical snapshot.`)) return submitAction(`/admin/fee-structures/${encodeURIComponent(a.id)}/delete`);
  });
  $("btnBulk")?.addEventListener("click", () => { if (!state.selected.size) return alert("Select at least one fee structure."); $("bulkbar")?.classList.add("show"); });
  $("bulkClear")?.addEventListener("click", () => { state.selected.clear(); renderList(); });
  $("bulkActivate")?.addEventListener("click", () => bulkSubmit("activate")); $("bulkInactive")?.addEventListener("click", () => bulkSubmit("inactive"));
  $("bulkArchive")?.addEventListener("click", () => { if (confirm("Archive selected fee structures?")) bulkSubmit("archive"); });
  $("bulkDelete")?.addEventListener("click", () => { if (confirm("Remove selected fee structures? Existing invoices will keep their historical snapshots.")) bulkSubmit("delete"); });
  $("addItemBtn")?.addEventListener("click", () => { $("itemsTbody").appendChild(createItemRow({})); syncPreviews(); });
  $("itemsTbody")?.addEventListener("click", (e) => { const b = e.target.closest(".removeItemBtn"); if (!b) return; const rows = document.querySelectorAll("#itemsTbody .itemRow"); if (rows.length <= 1) return alert("At least one fee item is required."); b.closest(".itemRow")?.remove(); syncPreviews(); });
  $("itemsTbody")?.addEventListener("input", (e) => { if (e.target.classList.contains("calcAmount")) syncPreviews(); });
  document.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.closeModal)));
  ["mEdit", "mView"].forEach((id) => $(id)?.addEventListener("click", (e) => { if (e.target.id === id) closeModal(id); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((x) => x.classList.remove("show")); });

  renderList(); renderItems(); setView("list");
})();

(function () {
  const $ = (id) => document.getElementById(id);
  const dataEl = $("scholarshipsData");
  if (!dataEl || !$("tbody")) return;

  let SCH = [];
  try { SCH = JSON.parse(dataEl.value || "[]"); } catch (_) { SCH = []; }
  const state = { view: "list", selected: new Set() };

  const text = (tag, value, cls) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = value == null || value === "" ? "—" : String(value);
    return el;
  };
  const btn = (title, icon, cls) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn-xs ${cls || ""}`.trim();
    b.title = title;
    const i = document.createElement("i");
    i.className = `fa-solid ${icon}`;
    b.appendChild(i);
    return b;
  };
  const money = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const valueLabel = (a) => a.type === "Percentage" ? `${Number(a.value || 0)}%` : a.type === "Full" ? "100%" : money(a.amount || 0);
  const statusPill = (status) => {
    const span = document.createElement("span");
    const map = { Active: "ok", Inactive: "warn", Expired: "warn", Revoked: "danger" };
    span.className = `pill ${map[status] || "info"}`;
    span.textContent = status || "—";
    return span;
  };
  const openModal = (id) => $(id)?.classList.add("show");
  const closeModal = (id) => $(id)?.classList.remove("show");
  const submitRowAction = (url) => { const f = $("rowActionForm"); if (f) { f.action = url; f.submit(); } };
  const bulkSubmit = (action) => {
    if (!state.selected.size) return;
    $("bulkIds").value = Array.from(state.selected).join(",");
    $("bulkActionInput").value = action;
    $("bulkForm").submit();
  };

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0 && state.view === "list");
  }

  function renderList() {
    $("resultMeta").textContent = `${SCH.length} scholarship(s)`;
    $("checkAll").checked = SCH.length > 0 && SCH.every((x) => state.selected.has(x.id));
    const body = $("tbody"); body.replaceChildren();
    if (!SCH.length) {
      const tr = document.createElement("tr"); const td = document.createElement("td"); td.colSpan = 9; td.style.padding = "18px"; td.appendChild(text("div", "No scholarships found.", "muted")); tr.appendChild(td); body.appendChild(tr); return;
    }
    SCH.forEach((a) => {
      const tr = document.createElement("tr"); tr.dataset.id = a.id;
      const c0 = document.createElement("td"); const ck = document.createElement("input"); ck.type = "checkbox"; ck.className = "rowCheck"; ck.dataset.id = a.id; ck.checked = state.selected.has(a.id); c0.appendChild(ck); tr.appendChild(c0);
      const c1 = document.createElement("td"); c1.appendChild(text("div", a.name, "strong")); c1.appendChild(text("div", a.code || "No code", "muted")); tr.appendChild(c1);
      tr.appendChild(text("td", a.studentName));
      tr.appendChild(text("td", a.programName));
      const c4 = document.createElement("td"); const type = text("span", a.type || "Fixed Amount", "pill info"); c4.appendChild(type); tr.appendChild(c4);
      const c5 = document.createElement("td"); c5.appendChild(text("div", valueLabel(a), "strong")); tr.appendChild(c5);
      const c6 = document.createElement("td"); c6.appendChild(text("div", a.startDate || "—", "strong")); c6.appendChild(text("div", `End: ${a.endDate || "—"}`, "muted")); tr.appendChild(c6);
      const c7 = document.createElement("td"); c7.appendChild(statusPill(a.status)); tr.appendChild(c7);
      const c8 = document.createElement("td"); const actions = document.createElement("div"); actions.className = "actions";
      actions.append(btn("View", "fa-eye", "actView"), btn("Edit", "fa-pen", "actEdit"));
      if ((a.recordKind || (a.studentId ? "Award" : "Program")) === "Program") actions.appendChild(btn("Applications", "fa-users", "actApplications"));
      actions.append(btn("Activate", "fa-circle-check", "actActivate"), btn("Expire", "fa-calendar-xmark", "actExpire"), btn("Revoke", "fa-ban", "actRevoke"), btn("Delete", "fa-trash", "actDelete"));
      c8.appendChild(actions); tr.appendChild(c8); body.appendChild(tr);
    });
  }

  function renderAwards() {
    $("resultMeta").textContent = `${SCH.length} scholarship(s)`;
    const body = $("tbodyAwards"); body.replaceChildren();
    if (!SCH.length) {
      const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 8; td.style.padding = "18px"; td.appendChild(text("div", "No award data found.", "muted")); tr.appendChild(td); body.appendChild(tr); return;
    }
    SCH.forEach((a) => {
      const tr = document.createElement("tr");
      const name = document.createElement("td"); name.appendChild(text("div", a.name, "strong")); tr.appendChild(name);
      tr.appendChild(text("td", a.code)); tr.appendChild(text("td", a.sponsor)); tr.appendChild(text("td", a.studentName)); tr.appendChild(text("td", a.programName));
      const typ = document.createElement("td"); typ.appendChild(text("span", a.type || "Fixed Amount", "pill info")); tr.appendChild(typ);
      const val = document.createElement("td"); val.appendChild(text("div", valueLabel(a), "strong")); tr.appendChild(val);
      const st = document.createElement("td"); st.appendChild(statusPill(a.status)); tr.appendChild(st); body.appendChild(tr);
    });
  }

  function render() { syncBulkbar(); if (state.view === "list") renderList(); else if (state.view === "awards") renderAwards(); else $("resultMeta").textContent = `${SCH.length} scholarship(s)`; }

  function setView(v) {
    state.view = v;
    document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    $("view-list").style.display = v === "list" ? "" : "none";
    $("view-awards").style.display = v === "awards" ? "" : "none";
    $("view-summary").style.display = v === "summary" ? "" : "none";
    const titles = { list: ["Scholarships", "Manage scholarship records, scope, value and lifecycle status."], awards: ["Awards", "Review scholarship targets, sponsors and award values."], summary: ["Summary", "Scholarship summary across the current result set."] };
    $("panelTitle").textContent = titles[v][0]; $("panelSub").textContent = titles[v][1]; render();
  }

  function syncTypeFields() {
    const type = $("sType").value; $("typePreview").textContent = type;
    $("valueField").style.display = type === "Percentage" ? "" : "none";
    $("amountField").style.display = type === "Fixed Amount" ? "" : "none";
    $("valuePreview").textContent = type === "Percentage" ? `${Number($("sValue").value || 0)}%` : type === "Full" ? "100%" : money($("sAmount").value || 0);
  }

  function openEditor(a) {
    const form = $("scholarshipForm"); $("mTitle").textContent = a ? "Edit Scholarship" : "Create Scholarship"; form.action = a ? `/admin/scholarships/${a.id}/update` : "/admin/scholarships";
    const vals = { sName: a?.name || "", sCode: a?.code || "", sStudent: a?.studentId || "", sProgram: a?.programId || "", sType: a?.type || "Fixed Amount", sValue: Number(a?.value || 0), sAmount: Number(a?.amount || 0), sSponsor: a?.sponsor || "", sStartDate: a?.startDate || "", sEndDate: a?.endDate || "", sStatus: a?.status || "Active", sNotes: a?.notes || "" };
    Object.entries(vals).forEach(([id,v]) => { if ($(id)) $(id).value = v; }); syncTypeFields(); openModal("mEdit");
  }

  function openView(a) {
    const vals = { vName:a.name, vCode:a.code, vStudent:a.studentName, vProgram:a.programName, vType:a.type, vValue:valueLabel(a), vSponsor:a.sponsor, vStatus:a.status, vStartDate:a.startDate, vEndDate:a.endDate, vNotes:a.notes };
    Object.entries(vals).forEach(([id,v]) => { if ($(id)) $(id).textContent = v || "—"; }); openModal("mView");
  }

  $("btnCreate")?.addEventListener("click", () => openEditor()); $("quickNewScholarship")?.addEventListener("click", () => openEditor());
  $("viewChips")?.addEventListener("click", (e) => { const b=e.target.closest(".chip"); if(b) setView(b.dataset.view); });
  $("checkAll")?.addEventListener("change", (e) => { if(e.target.checked) SCH.forEach((a)=>state.selected.add(a.id)); else state.selected.clear(); render(); });
  $("tbody")?.addEventListener("change", (e) => { if(!e.target.classList.contains("rowCheck")) return; e.target.checked ? state.selected.add(e.target.dataset.id) : state.selected.delete(e.target.dataset.id); render(); });
  $("tbody")?.addEventListener("click", (e) => {
    const tr=e.target.closest("tr[data-id]"); if(!tr) return; const a=SCH.find((x)=>x.id===tr.dataset.id); if(!a) return;
    if(e.target.closest(".actView")) return openView(a); if(e.target.closest(".actEdit")) return openEditor(a); if(e.target.closest(".actApplications")) { window.location.href=`/admin/scholarships/${a.id}/applications`; return; }
    if(e.target.closest(".actActivate")) return submitRowAction(`/admin/scholarships/${a.id}/activate`); if(e.target.closest(".actExpire")) return submitRowAction(`/admin/scholarships/${a.id}/expire`); if(e.target.closest(".actRevoke")) return submitRowAction(`/admin/scholarships/${a.id}/revoke`);
    if(e.target.closest(".actDelete") && window.confirm(`Delete scholarship "${a.name || ""}"?`)) submitRowAction(`/admin/scholarships/${a.id}/delete`);
  });
  $("btnBulk")?.addEventListener("click", () => { if(!state.selected.size) return window.alert("Select at least one scholarship."); $("bulkbar").classList.add("show"); });
  $("bulkClear")?.addEventListener("click", () => { state.selected.clear(); render(); });
  $("bulkActivate")?.addEventListener("click", () => bulkSubmit("activate")); $("bulkInactive")?.addEventListener("click", () => bulkSubmit("inactive")); $("bulkExpire")?.addEventListener("click", () => bulkSubmit("expire")); $("bulkRevoke")?.addEventListener("click", () => bulkSubmit("revoke"));
  $("bulkDelete")?.addEventListener("click", () => { if(state.selected.size && window.confirm("Delete selected scholarships?")) bulkSubmit("delete"); });
  $("sType")?.addEventListener("change", syncTypeFields); $("sValue")?.addEventListener("input", syncTypeFields); $("sAmount")?.addEventListener("input", syncTypeFields);
  document.querySelectorAll("[data-close-modal]").forEach((b)=>b.addEventListener("click",()=>closeModal(b.dataset.closeModal)));
  ["mEdit","mView"].forEach((id)=>$(id)?.addEventListener("click",(e)=>{if(e.target.id===id)closeModal(id);}));
  document.addEventListener("keydown",(e)=>{if(e.key==="Escape")document.querySelectorAll(".modal-backdrop.show").forEach((el)=>el.classList.remove("show"));});
  $("btnExport")?.addEventListener("click", () => { const qs = window.location.search || ""; window.location.href = `/admin/scholarships/export.csv${qs}`; });
  syncTypeFields(); setView("list");
})();

(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  function readJson(id, fallback) {
    try { return JSON.parse($(id)?.value || JSON.stringify(fallback)); } catch (_) { return fallback; }
  }
  const INTEGRATIONS = readJson("integrationsData", []);
  const LOGS = readJson("logsData", []);
  const state = { view: "list", selected: new Set() };
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function button(icon, title, className) {
    const b = el("button", null, `btn-xs ${className || ""}`.trim());
    b.type = "button"; b.title = title;
    const i = el("i", null, `fa-solid ${icon}`); b.appendChild(i);
    return b;
  }
  function pill(text, cls, icon) {
    const span = el("span", null, `pill ${cls}`);
    if (icon) span.appendChild(el("i", null, `fa-solid ${icon}`));
    span.appendChild(document.createTextNode(` ${text}`));
    return span;
  }
  function statusPill(item) {
    if (item.quarantined) return pill("Quarantined", "bad", "fa-shield-halved");
    if (item.status === "Active") return pill("Active", "ok", "fa-circle-check");
    if (item.status === "Error") return pill("Error", "bad", "fa-circle-exclamation");
    return pill("Disabled", "warn", "fa-circle-pause");
  }
  function syncBulkbar() {
    const count = state.selected.size;
    $("selCount").textContent = String(count);
    $("bulkbar").classList.toggle("show", count > 0);
  }
  function setView(v) {
    state.view = v;
    document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.remove("active"));
    document.querySelector(`#viewChips .chip[data-view="${v}"]`)?.classList.add("active");
    $("view-list").style.display = v === "list" ? "" : "none";
    $("view-usage").style.display = v === "usage" ? "" : "none";
    $("view-logs").style.display = v === "logs" ? "" : "none";
    const titles = {
      list: ["Integrations", "Manage endpoints, encrypted credentials and integration status."],
      usage: ["Usage", "Review real probe counts, success rate, failures and response time."],
      logs: ["Request Logs", "Inspect bounded probe activity without response bodies or credentials."],
    };
    $("panelTitle").textContent = titles[v][0]; $("panelSub").textContent = titles[v][1];
    render();
  }
  function emptyRow(colspan, message) {
    const tr = el("tr"); const td = el("td"); td.colSpan = colspan; td.style.padding = "18px"; td.appendChild(el("div", message, "muted")); tr.appendChild(td); return tr;
  }
  function renderList() {
    const tbody = $("tbody"); tbody.replaceChildren();
    $("resultMeta").textContent = `${INTEGRATIONS.length} integration(s)`;
    $("checkAll").checked = INTEGRATIONS.length > 0 && INTEGRATIONS.every((x) => state.selected.has(x.id));
    if (!INTEGRATIONS.length) { tbody.appendChild(emptyRow(9, "No integrations found.")); return; }
    INTEGRATIONS.forEach((item) => {
      const tr = el("tr"); tr.dataset.id = item.id;
      const tdCheck = el("td"); const check = document.createElement("input"); check.type = "checkbox"; check.className = "rowCheck"; check.dataset.id = item.id; check.checked = state.selected.has(item.id); tdCheck.appendChild(check); tr.appendChild(tdCheck);
      const tdName = el("td"); tdName.appendChild(el("div", item.name || "—", "strong")); tdName.appendChild(el("div", item.quarantined ? (item.quarantineReason || "Quarantined") : (item.notes || "—"), "muted")); tr.appendChild(tdName);
      tr.appendChild(el("td", item.type || "Custom")); tr.appendChild(el("td", item.provider || "—")); tr.appendChild(el("td", item.baseUrl || "—"));
      const tdStatus = el("td"); tdStatus.appendChild(statusPill(item)); tr.appendChild(tdStatus);
      const tdAuth = el("td"); tdAuth.appendChild(el("div", item.authType || "None")); tdAuth.appendChild(el("div", item.credentialConfigured ? "Credential configured" : "No credential", "muted")); tr.appendChild(tdAuth);
      tr.appendChild(el("td", item.lastTestAt || "—", "muted"));
      const tdActions = el("td"); const actions = el("div", null, "actions");
      actions.appendChild(button("fa-eye", "View", "actView"));
      if (!item.quarantined) actions.appendChild(button("fa-pen", "Edit", "actEdit"));
      if (!item.quarantined) actions.appendChild(button("fa-power-off", "Toggle", "actToggle"));
      if (!item.quarantined) actions.appendChild(button("fa-vial-circle-check", "Test", "actTest"));
      actions.appendChild(button("fa-trash", "Archive", "actDelete")); tdActions.appendChild(actions); tr.appendChild(tdActions);
      tbody.appendChild(tr);
    });
  }
  function renderUsage() {
    const tbody = $("tbodyEng"); tbody.replaceChildren(); $("resultMeta").textContent = `${INTEGRATIONS.length} usage row(s)`;
    if (!INTEGRATIONS.length) { tbody.appendChild(emptyRow(6, "No usage data found.")); return; }
    INTEGRATIONS.forEach((item) => {
      const tr = el("tr"); tr.appendChild(el("td", item.name || "—", "strong"));
      const data = [
        [item.metrics?.requests || 0, "info", "fa-paper-plane"],
        [item.metrics?.success || 0, "ok", "fa-circle-check"],
        [item.metrics?.failures || 0, "bad", "fa-circle-exclamation"],
        [item.metrics?.successRate || "0%", "info", "fa-percent"],
        [item.metrics?.avgResponse || "—", "info", "fa-gauge-high"],
      ];
      data.forEach(([v,c,i]) => { const td=el("td"); td.appendChild(pill(v,c,i)); tr.appendChild(td); }); tbody.appendChild(tr);
    });
  }
  function renderLogs() {
    const root = $("timelineList"); root.replaceChildren();
    const q = String($("rSearch").value || "").trim().toLowerCase(), f = $("rFilter").value;
    const list = LOGS.filter((item) => { const text = `${item.integrationName || ""} ${item.endpoint || ""} ${item.status || ""}`.toLowerCase(); return (!q || text.includes(q)) && (f === "all" || item.status === f); });
    $("resultMeta").textContent = `${list.length} log(s)`;
    if (!list.length) { root.appendChild(el("div", "No request logs found.", "note")); return; }
    list.forEach((item) => {
      const card=el("div",null,"timeline-item"), head=el("div",null,"timeline-head"); head.appendChild(el("div",`${item.integrationName || "—"} • ${item.status || "—"}`,"strong")); head.appendChild(el("div",item.createdAt || "—","muted")); card.appendChild(head);
      const body=el("div",null,"timeline-body"); [["Endpoint",item.endpoint||"—"],["Method",item.method||"HEAD"],["HTTP",item.statusCode||"—"],["Response",item.responseTime||"—"],["Message",item.message||"—"]].forEach(([k,v])=>{const d=el("div"); d.appendChild(el("strong",`${k}: `)); d.appendChild(document.createTextNode(String(v))); body.appendChild(d);}); card.appendChild(body); root.appendChild(card);
    });
  }
  function render() { syncBulkbar(); if (state.view === "list") renderList(); else if (state.view === "usage") renderUsage(); else renderLogs(); }
  function openModal(id) { $(id)?.classList.add("show"); }
  function closeModal(id) { $(id)?.classList.remove("show"); }
  function openView(item) {
    [["vName",item.name],["vType",item.type],["vProvider",item.provider],["vBaseUrl",item.baseUrl],["vStatus",item.status],["vAuthType",item.authType],["vEndpoint",item.endpoint],["vLastTest",item.lastTestAt]].forEach(([id,v]) => { $(id).textContent = v || "—"; });
    $("vMeta").textContent = item.metaPretty || "{}"; openModal("mView");
  }
  function openCreate(type) {
    $("integrationId").value=""; $("integrationRevision").value=""; $("iName").value=""; $("iType").value=type||"Custom"; $("iProvider").value=""; $("iBaseUrl").value=""; $("iAuthType").value="API Key"; $("iStatus").value="Disabled"; $("iApiKey").value=""; $("iEndpoint").value="/"; $("iTestMethod").value="HEAD"; $("iNotes").value=""; openModal("mCreate");
  }
  function openEdit(item) {
    $("integrationId").value=item.id||""; $("integrationRevision").value=String(item.revision||0); $("iName").value=item.name||""; $("iType").value=item.type||"Custom"; $("iProvider").value=item.provider||""; $("iBaseUrl").value=item.baseUrl||""; $("iAuthType").value=item.authType||"None"; $("iStatus").value=item.storedStatus === "Active" ? "Active" : "Disabled"; $("iApiKey").value=""; $("iEndpoint").value=item.endpoint||"/"; $("iTestMethod").value=item.testMethod||"HEAD"; $("iNotes").value=item.notes||""; openModal("mCreate");
  }
  function submitRowAction(action) { const f=$("rowActionForm"); f.action=action; f.submit(); }
  function bulkSubmit(action) { if (!state.selected.size) return; $("bulkIds").value=[...state.selected].join(","); $("bulkActionInput").value=action; $("bulkForm").submit(); }

  $("btnCreate")?.addEventListener("click",()=>openCreate("Custom")); $("quickPayments")?.addEventListener("click",()=>openCreate("Payments")); $("quickMessaging")?.addEventListener("click",()=>openCreate("Messaging")); $("quickLatest")?.addEventListener("click",()=>INTEGRATIONS[0]&&openView(INTEGRATIONS[0])); $("btnRefresh")?.addEventListener("click",()=>window.location.reload());
  $("viewChips")?.addEventListener("click",(e)=>{const b=e.target.closest(".chip");if(b)setView(b.dataset.view);});
  $("checkAll")?.addEventListener("change",(e)=>{ if(e.target.checked)INTEGRATIONS.forEach(x=>state.selected.add(x.id));else state.selected.clear();render();});
  $("tbody")?.addEventListener("change",(e)=>{if(!e.target.classList.contains("rowCheck"))return; if(e.target.checked)state.selected.add(e.target.dataset.id);else state.selected.delete(e.target.dataset.id);render();});
  $("tbody")?.addEventListener("click",(e)=>{const tr=e.target.closest("tr[data-id]");if(!tr)return;const item=INTEGRATIONS.find(x=>x.id===tr.dataset.id);if(!item)return;if(e.target.closest(".actView"))return openView(item);if(e.target.closest(".actEdit"))return openEdit(item);if(e.target.closest(".actToggle"))return submitRowAction(`/admin/integrations/${item.id}/toggle`);if(e.target.closest(".actTest"))return submitRowAction(`/admin/integrations/${item.id}/test`);if(e.target.closest(".actDelete")&&window.confirm(`Archive "${item.name}"?`))return submitRowAction(`/admin/integrations/${item.id}/delete`);});
  $("btnBulk")?.addEventListener("click",()=>syncBulkbar()); $("bulkClear")?.addEventListener("click",()=>{state.selected.clear();render();}); $("bulkEnable")?.addEventListener("click",()=>bulkSubmit("enable")); $("bulkDisable")?.addEventListener("click",()=>bulkSubmit("disable")); $("bulkTest")?.addEventListener("click",()=>bulkSubmit("test"));
  $("rSearch")?.addEventListener("input",render); $("rFilter")?.addEventListener("change",render);
  document.querySelectorAll("[data-close-modal]").forEach((b)=>b.addEventListener("click",()=>closeModal(b.dataset.closeModal)));
  ["mCreate","mView"].forEach((id)=>$(id)?.addEventListener("click",(e)=>{if(e.target.id===id)closeModal(id);})); document.addEventListener("keydown",(e)=>{if(e.key==="Escape")document.querySelectorAll(".modal-backdrop.show").forEach(x=>x.classList.remove("show"));});
  setView("list");
})();

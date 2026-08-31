(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const dataNode = $("ticketsData");
  let tickets = [];
  try { tickets = JSON.parse(dataNode?.value || dataNode?.textContent || "[]"); } catch (_) { tickets = []; }

  const byId = new Map(tickets.map((t) => [String(t.id), t]));
  const selectedIds = new Set();
  let activeTicket = tickets[0] || null;

  const csrf = document.querySelector('#rowActionForm input[name="_csrf"]')?.value || "";
  const text = (v) => String(v ?? "");
  const lower = (v) => text(v).toLowerCase();

  function make(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = text(value);
      else if (key.startsWith("data-")) node.setAttribute(key, text(value));
      else if (key === "type") node.type = value;
      else node.setAttribute(key, text(value));
    });
    (Array.isArray(children) ? children : [children]).filter(Boolean).forEach((child) => node.appendChild(child));
    return node;
  }

  function pill(value, kind = "") {
    const clean = text(value);
    let cls = "pill info";
    if (["Resolved", "Closed", "Low"].includes(clean)) cls = "pill ok";
    if (["In Progress", "Medium"].includes(clean)) cls = "pill warn";
    if (["Urgent", "High"].includes(clean)) cls = "pill bad";
    if (kind === "category") cls = "pill pin";
    return make("span", { className: cls, text: clean || "—" });
  }

  function actionButton(label, icon, action, id) {
    const btn = make("button", { className: "btn-xs", type: "button", "data-action": action, "data-id": id });
    const i = make("i", { className: `fa-solid ${icon}` });
    btn.append(i, document.createTextNode(` ${label}`));
    return btn;
  }

  function renderList() {
    const tbody = $("tbody");
    if (!tbody) return;
    tbody.replaceChildren();
    tickets.forEach((ticket) => {
      const tr = document.createElement("tr");
      tr.dataset.ticketId = ticket.id;

      const checkTd = document.createElement("td");
      const check = make("input", { type: "checkbox", "data-ticket-check": ticket.id });
      check.checked = selectedIds.has(String(ticket.id));
      checkTd.appendChild(check);

      const ticketTd = document.createElement("td");
      ticketTd.append(make("div", { className: "strong", text: ticket.ticketNo || ticket.id }));
      ticketTd.append(make("div", { className: "muted", text: ticket.subject }));

      const catTd = document.createElement("td"); catTd.append(pill(ticket.category, "category"));
      const requesterTd = document.createElement("td");
      requesterTd.append(make("div", { className: "strong", text: ticket.requesterName || ticket.requesterType || "External" }));
      requesterTd.append(make("div", { className: "muted", text: ticket.requesterEmail || ticket.requesterType || "" }));
      const assignedTd = make("td", { text: ticket.assignedTo || "—" });
      const priTd = document.createElement("td"); priTd.append(pill(ticket.priority));
      const statusTd = document.createElement("td"); statusTd.append(pill(ticket.status));
      const actionsTd = document.createElement("td"); actionsTd.style.textAlign = "right";
      const actions = make("div", { className: "actions" });
      actions.append(
        actionButton("View", "fa-eye", "view", ticket.id),
        actionButton("Edit", "fa-pen", "edit", ticket.id)
      );
      if (ticket.status !== "Closed") {
        if (ticket.status === "Open") actions.append(actionButton("Progress", "fa-gear", "progress", ticket.id));
        if (!["Resolved", "Closed"].includes(ticket.status)) actions.append(actionButton("Resolve", "fa-circle-check", "resolve", ticket.id));
        actions.append(actionButton("Close", "fa-lock", "close", ticket.id));
      }
      actions.append(actionButton("Delete", "fa-trash", "delete", ticket.id));
      actionsTd.appendChild(actions);
      tr.append(checkTd, ticketTd, catTd, requesterTd, assignedTd, priTd, statusTd, actionsTd);
      tbody.appendChild(tr);
    });
    if ($("resultMeta")) $("resultMeta").textContent = `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`;
  }

  function renderPerformance() {
    const tbody = $("tbodyEng");
    if (!tbody) return;
    tbody.replaceChildren();
    tickets.forEach((ticket) => {
      const tr = document.createElement("tr");
      const cells = [
        ticket.ticketNo || ticket.id,
        Number(ticket.stats?.replies || 0),
        ticket.stats?.firstResponse || "—",
        ticket.stats?.resolutionTime || "—",
        ticket.stats?.slaBreached ? "Breached" : "Within SLA",
      ];
      cells.forEach((value) => tr.append(make("td", { text: value })));
      const statusTd = document.createElement("td"); statusTd.append(pill(ticket.status)); tr.append(statusTd);
      tbody.appendChild(tr);
    });
  }

  function renderThread() {
    const list = $("threadList");
    if (!list) return;
    list.replaceChildren();
    if (!activeTicket) {
      list.append(make("div", { className: "note", text: "Select a ticket to view its thread." }));
      return;
    }
    const query = lower($("rSearch")?.value).trim();
    const roleFilter = $("rFilter")?.value || "all";
    const rows = (activeTicket.thread || []).filter((msg) => {
      if (roleFilter !== "all" && msg.role !== roleFilter) return false;
      if (!query) return true;
      return lower(`${msg.author} ${msg.body}`).includes(query);
    });
    if (!rows.length) {
      list.append(make("div", { className: "note", text: "No thread messages match this view." }));
      return;
    }
    rows.forEach((msg) => {
      const card = make("div", { className: "thread-item" });
      const head = make("div", { className: "thread-head" });
      const left = make("div", { className: "strong", text: `${msg.author || "Message"} • ${msg.role || ""}` });
      const time = make("div", { className: "muted", text: msg.createdAt || "" });
      head.append(left, time);
      card.append(head, make("div", { className: "thread-body", text: msg.body || "" }));
      list.appendChild(card);
    });
  }

  function openModal(id) { $(id)?.classList.add("show"); }
  function closeModal(id) { $(id)?.classList.remove("show"); }

  function setActive(ticket) {
    activeTicket = ticket || null;
    renderThread();
  }

  function populateView(ticket) {
    if (!ticket) return;
    setActive(ticket);
    $("vSubject").textContent = ticket.subject || "—";
    $("vCategory").textContent = ticket.category || "—";
    $("vRequester").textContent = [ticket.requesterName, ticket.requesterEmail].filter(Boolean).join(" • ") || ticket.requesterType || "—";
    $("vAssignedTo").textContent = ticket.assignedTo || "—";
    $("vPriority").textContent = ticket.priority || "—";
    $("vStatus").textContent = ticket.status || "—";
    $("vDueDate").textContent = ticket.dueDate || "—";
    $("vSla").textContent = ticket.slaHours ? `${ticket.slaHours} hours` : "—";
    $("vBody").textContent = ticket.description || "—";
    openModal("mView");
  }

  function resetEditForm(ticket = null) {
    const form = $("ticketForm");
    if (!form) return;
    form.action = ticket ? `/admin/helpdesk/${encodeURIComponent(ticket.id)}/update` : "/admin/helpdesk";
    $("mTitle").textContent = ticket ? `Edit ${ticket.ticketNo || "Ticket"}` : "New Ticket";
    $("tSubject").value = ticket?.subject || "";
    $("tCategory").value = ticket?.category || "General";
    $("tPriority").value = ticket?.priority || "Medium";
    $("tRequesterName").value = ticket?.requesterName || "";
    $("tRequesterEmail").value = ticket?.requesterEmail || "";
    $("tAssignedTo").value = ticket?.assignedTo || "";
    $("tBody").value = ticket?.description || "";
    $("tStatus").value = ticket?.status || "Open";
    $("tDueDate").value = ticket?.dueDateRaw || "";
    $("tSlaHours").value = ticket?.slaHours || "";
    updateCharCount();
    openModal("mEdit");
  }

  function post(path, fields = {}, confirmText = "") {
    if (confirmText && !window.confirm(confirmText)) return;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = path;
    if (csrf) {
      const token = make("input", { type: "hidden", name: "_csrf", value: csrf });
      token.name = "_csrf"; token.value = csrf; form.appendChild(token);
    }
    Object.entries(fields).forEach(([name, value]) => {
      const input = document.createElement("input");
      input.type = "hidden"; input.name = name; input.value = text(value); form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }

  function updateBulkUi() {
    if ($("selCount")) $("selCount").textContent = String(selectedIds.size);
    if ($("checkAll")) $("checkAll").checked = tickets.length > 0 && selectedIds.size === tickets.length;
  }

  function doBulk(action) {
    if (!selectedIds.size) return window.alert("Select at least one ticket first.");
    $("bulkIds").value = [...selectedIds].join(",");
    $("bulkActionInput").value = action;
    $("bulkForm").submit();
  }

  function updateCharCount() {
    const body = $("tBody")?.value || "";
    if ($("charCount")) $("charCount").textContent = `${body.length} / 5000`;
  }

  document.addEventListener("click", (event) => {
    const close = event.target.closest("[data-close-modal]");
    if (close) return closeModal(close.dataset.closeModal);

    const action = event.target.closest("[data-action]");
    if (!action) return;
    const ticket = byId.get(String(action.dataset.id));
    if (!ticket) return;
    setActive(ticket);
    switch (action.dataset.action) {
      case "view": return populateView(ticket);
      case "edit": return resetEditForm(ticket);
      case "progress": return post(`/admin/helpdesk/${ticket.id}/progress`);
      case "resolve": return post(`/admin/helpdesk/${ticket.id}/resolve`, {}, "Mark this ticket resolved?");
      case "close": return post(`/admin/helpdesk/${ticket.id}/close`, {}, "Close this ticket? Closed tickets are terminal.");
      case "delete": return post(`/admin/helpdesk/${ticket.id}/delete`, {}, "Remove this ticket from the active helpdesk?");
      default: return undefined;
    }
  });

  $("tbody")?.addEventListener("change", (event) => {
    const box = event.target.closest("[data-ticket-check]");
    if (!box) return;
    const id = String(box.dataset.ticketCheck);
    box.checked ? selectedIds.add(id) : selectedIds.delete(id);
    setActive(byId.get(id));
    updateBulkUi();
  });

  $("checkAll")?.addEventListener("change", (event) => {
    selectedIds.clear();
    if (event.target.checked) tickets.forEach((t) => selectedIds.add(String(t.id)));
    document.querySelectorAll("[data-ticket-check]").forEach((box) => { box.checked = event.target.checked; });
    updateBulkUi();
  });

  document.querySelectorAll("[data-view]").forEach((chip) => chip.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((x) => x.classList.remove("active"));
    chip.classList.add("active");
    ["list", "performance", "thread"].forEach((name) => {
      const panel = $(`view-${name}`); if (panel) panel.style.display = name === chip.dataset.view ? "" : "none";
    });
    const titles = {
      list: ["Tickets", "Manage ticket assignments, priorities and resolution workflow."],
      performance: ["Performance", "Response, resolution and SLA metrics from ticket activity."],
      thread: [activeTicket?.ticketNo ? `Thread • ${activeTicket.ticketNo}` : "Thread", "Review the full requester/support conversation."],
    };
    if ($("panelTitle")) $("panelTitle").textContent = titles[chip.dataset.view][0];
    if ($("panelSub")) $("panelSub").textContent = titles[chip.dataset.view][1];
    if (chip.dataset.view === "thread") renderThread();
  }));

  $("btnCreate")?.addEventListener("click", () => resetEditForm());
  $("quickTechnical")?.addEventListener("click", () => { resetEditForm(); $("tCategory").value = "Technical"; });
  $("quickFinance")?.addEventListener("click", () => { resetEditForm(); $("tCategory").value = "Finance"; });
  $("quickUrgent")?.addEventListener("click", () => { resetEditForm(); $("tPriority").value = "Urgent"; });
  $("btnBulk")?.addEventListener("click", () => $("bulkbar")?.classList.toggle("show"));
  $("bulkProgress")?.addEventListener("click", () => doBulk("progress"));
  $("bulkResolve")?.addEventListener("click", () => doBulk("resolve"));
  $("bulkClose")?.addEventListener("click", () => doBulk("close"));
  $("bulkClear")?.addEventListener("click", () => {
    selectedIds.clear(); document.querySelectorAll("[data-ticket-check]").forEach((b) => { b.checked = false; }); updateBulkUi();
  });
  $("btnExport")?.addEventListener("click", () => { window.location.href = `/admin/helpdesk/export${window.location.search || ""}`; });
  $("btnTemplates")?.addEventListener("click", () => { window.location.href = "/admin/helpdesk/templates"; });
  $("btnSettings")?.addEventListener("click", () => { window.location.href = "/admin/settings"; });
  $("tBody")?.addEventListener("input", updateCharCount);
  $("rSearch")?.addEventListener("input", renderThread);
  $("rFilter")?.addEventListener("change", renderThread);
  $("btnReply")?.addEventListener("click", () => {
    if (!activeTicket) return window.alert("Select a ticket first.");
    if (activeTicket.status === "Closed") return window.alert("Closed tickets cannot accept replies.");
    const message = window.prompt(`Reply to ${activeTicket.ticketNo || "ticket"}`);
    if (!message?.trim()) return;
    post(`/admin/helpdesk/${activeTicket.id}/reply`, { message: message.trim() });
  });

  document.querySelectorAll(".modal-backdrop").forEach((modal) => modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal(modal.id);
  }));

  renderList();
  renderPerformance();
  renderThread();
  updateBulkUi();
  updateCharCount();
})();

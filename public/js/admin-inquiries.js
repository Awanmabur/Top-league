(function () {
  const $ = (id) => document.getElementById(id);

  function readData() {
    const node = $("inquiriesData");
    if (!node) return [];
    try {
      const parsed = JSON.parse(node.value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error("Failed to parse inquiries data:", err);
      return [];
    }
  }

  const INQ = readData();
  if (!$("tbody")) return;

  const state = { view: "list", selected: new Set() };

  function node(tag, className, text) {
    const out = document.createElement(tag);
    if (className) out.className = className;
    if (text !== undefined && text !== null) out.textContent = String(text);
    return out;
  }

  function icon(name) {
    const i = document.createElement("i");
    i.className = `fa-solid ${name}`;
    return i;
  }

  function actionButton(className, title, iconName) {
    const button = node("button", `btn-xs ${className}`);
    button.type = "button";
    button.title = title;
    button.appendChild(icon(iconName));
    return button;
  }

  function openModal(id) {
    $(id)?.classList.add("show");
  }

  function closeModal(id) {
    $(id)?.classList.remove("show");
  }

  function submitPost(actionUrl, fields = {}) {
    const form = $("rowActionForm");
    if (!form) return;
    form.querySelectorAll("[data-dynamic-field]").forEach((input) => input.remove());
    Object.entries(fields).forEach(([name, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = String(value ?? "");
      input.dataset.dynamicField = "1";
      form.appendChild(input);
    });
    form.action = actionUrl;
    form.submit();
  }

  function statusPill(status) {
    const s = String(status || "new").toLowerCase();
    const span = node("span", `pill ${s === "resolved" ? "ok" : s === "read" ? "warn" : "info"}`);
    span.appendChild(icon(s === "resolved" ? "fa-circle-check" : s === "read" ? "fa-envelope-open" : "fa-envelope"));
    span.appendChild(document.createTextNode(` ${s === "resolved" ? "Resolved" : s === "read" ? "Read" : "New"}`));
    return span;
  }

  function schoolPill(value) {
    const span = node("span", "pill info");
    span.appendChild(icon("fa-school"));
    span.appendChild(document.createTextNode(` ${value || "—"}`));
    return span;
  }

  function cell(child, className) {
    const td = node("td", className || "");
    if (child instanceof Node) td.appendChild(child);
    else td.textContent = child == null ? "—" : String(child);
    return td;
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0 && state.view === "list");
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll("#viewChips .chip").forEach((button) => button.classList.remove("active"));
    document.querySelector(`#viewChips .chip[data-view="${view}"]`)?.classList.add("active");
    $("view-list").style.display = view === "list" ? "" : "none";
    $("view-summary").style.display = view === "summary" ? "" : "none";
    const titles = {
      list: ["Inquiries", "Manage incoming contact messages."],
      summary: ["Summary", "Inquiry counts by status."],
    };
    $("panelTitle").textContent = titles[view][0];
    $("panelSub").textContent = titles[view][1];
    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${INQ.length} inquiry(s)`;
    $("checkAll").checked = INQ.length > 0 && INQ.every((item) => state.selected.has(String(item._id || "")));
    const tbody = $("tbody");
    tbody.replaceChildren();

    if (!INQ.length) {
      const tr = node("tr");
      const td = node("td");
      td.colSpan = 8;
      td.style.padding = "18px";
      td.appendChild(node("div", "muted", "No inquiries found."));
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    INQ.forEach((item) => {
      const id = String(item._id || "");
      const tr = node("tr");
      tr.dataset.id = id;

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "rowCheck";
      check.dataset.id = id;
      check.checked = state.selected.has(id);
      tr.appendChild(cell(check));
      tr.appendChild(cell(node("div", "strong", item.name || "—")));
      tr.appendChild(cell(node("div", "", item.contact || "—")));
      tr.appendChild(cell(node("div", "muted", item.message || "—")));
      tr.appendChild(cell(schoolPill(item.schoolCode || "—")));
      tr.appendChild(cell(item.createdAtLabel || "—", "muted"));
      tr.appendChild(cell(statusPill(item.statusLabel || item.status)));

      const actions = node("div", "actions");
      actions.appendChild(actionButton("actView", "View", "fa-eye"));
      if (String(item.statusLabel || item.status || "new").toLowerCase() === "new") {
        actions.appendChild(actionButton("actRead", "Mark Read", "fa-envelope-open"));
      }
      if (String(item.statusLabel || item.status || "new").toLowerCase() !== "resolved") {
        actions.appendChild(actionButton("actResolve", "Resolve", "fa-circle-check"));
      }
      actions.appendChild(actionButton("actDelete", "Delete", "fa-trash"));
      tr.appendChild(cell(actions));
      tbody.appendChild(tr);
    });
  }

  function renderSummary() {
    const counts = { new: 0, read: 0, resolved: 0 };
    INQ.forEach((item) => {
      const s = String(item.statusLabel || item.status || "new").toLowerCase();
      if (s === "resolved") counts.resolved += 1;
      else if (s === "read") counts.read += 1;
      else counts.new += 1;
    });
    $("resultMeta").textContent = `${INQ.length} inquiry(s)`;
    const tbody = $("tbodySummary");
    tbody.replaceChildren();
    [
      ["new", counts.new, "Fresh messages that still need attention."],
      ["read", counts.read, "Reviewed inquiries awaiting closure."],
      ["resolved", counts.resolved, "Completed or closed inquiries."],
    ].forEach(([status, count, description]) => {
      const tr = node("tr");
      tr.appendChild(cell(statusPill(status)));
      const strong = node("strong", "", String(count));
      tr.appendChild(cell(strong));
      tr.appendChild(cell(description, "muted"));
      tbody.appendChild(tr);
    });
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    else renderSummary();
  }

  function openViewModal(item) {
    if (!item) return;
    $("vName").textContent = item.name || "—";
    $("vContact").textContent = item.contact || "—";
    $("vSchoolCode").textContent = item.schoolCode || "—";
    $("vStatus").textContent = item.statusLabel || item.status || "—";
    $("vCreated").textContent = item.createdAtLabel || "—";
    $("vUpdated").textContent = item.updatedAtLabel || "—";
    $("vMessage").textContent = item.message || "—";
    openModal("mView");
  }

  function bulk(action) {
    if (!state.selected.size) return;
    if (action === "delete" && !window.confirm(`Delete ${state.selected.size} selected inquiry(s)?`)) return;
    submitPost("/admin/inquiries/bulk", { action, ids: [...state.selected].join(",") });
  }

  $("viewChips").addEventListener("click", (event) => {
    const button = event.target.closest(".chip");
    if (button) setView(button.dataset.view);
  });

  $("checkAll").addEventListener("change", (event) => {
    if (event.target.checked) INQ.forEach((item) => state.selected.add(String(item._id || "")));
    else state.selected.clear();
    render();
  });

  $("tbody").addEventListener("change", (event) => {
    if (!event.target.classList.contains("rowCheck")) return;
    const id = String(event.target.dataset.id || "");
    if (event.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    render();
  });

  $("tbody").addEventListener("click", (event) => {
    const tr = event.target.closest("tr[data-id]");
    if (!tr) return;
    const id = String(tr.dataset.id || "");
    const item = INQ.find((row) => String(row._id || "") === id);
    if (!item) return;
    if (event.target.closest(".actView")) return openViewModal(item);
    if (event.target.closest(".actRead")) return submitPost(`/admin/inquiries/${id}/read`);
    if (event.target.closest(".actResolve")) return submitPost(`/admin/inquiries/${id}/resolve`);
    if (event.target.closest(".actDelete") && window.confirm(`Delete inquiry from "${item.name || "this sender"}"?`)) {
      return submitPost(`/admin/inquiries/${id}/delete`);
    }
  });

  $("btnBulk").addEventListener("click", () => {
    if (!state.selected.size) return window.alert("Select at least one inquiry.");
    $("bulkbar").classList.add("show");
  });
  $("bulkClear").addEventListener("click", () => { state.selected.clear(); render(); });
  $("bulkRead").addEventListener("click", () => bulk("read"));
  $("bulkResolve").addEventListener("click", () => bulk("resolve"));
  $("bulkDelete").addEventListener("click", () => bulk("delete"));

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });
  ["mView"].forEach((id) => {
    const backdrop = $(id);
    backdrop?.addEventListener("click", (event) => { if (event.target.id === id) closeModal(id); });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show"));
  });

  $("btnExport").addEventListener("click", () => {
    const current = new URL(window.location.href);
    const target = new URL("/admin/inquiries/export.csv", window.location.origin);
    ["q", "status"].forEach((key) => {
      const value = current.searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    });
    window.location.href = target.toString();
  });
  $("btnRefresh").addEventListener("click", () => window.location.reload());
  $("quickNew").addEventListener("click", () => { const url = new URL(window.location.href); url.searchParams.set("status", "new"); window.location.href = url.toString(); });
  $("quickResolved").addEventListener("click", () => { const url = new URL(window.location.href); url.searchParams.set("status", "resolved"); window.location.href = url.toString(); });
  $("quickRefresh").addEventListener("click", () => window.location.reload());

  setView("list");
  render();
})();

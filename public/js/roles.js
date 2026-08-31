(function () {
  const $ = (id) => document.getElementById(id);

  function readJson(id) {
    const el = $(id);
    if (!el) return [];
    try { return JSON.parse(el.value || "[]"); }
    catch (err) { console.error(`Failed to parse ${id}:`, err); return []; }
  }

  const ROLES = readJson("rolesData");
  if (!$("tbody")) return;
  const state = { view: "list", selected: new Set() };

  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function icon(cls) {
    const i = document.createElement("i");
    i.className = cls;
    return i;
  }

  function button(cls, title, iconClass) {
    const b = node("button", null, `btn-xs ${cls}`);
    b.type = "button";
    b.title = title;
    b.appendChild(icon(iconClass));
    return b;
  }

  function openModal(id) { const el = $(id); if (el) el.classList.add("show"); }
  function closeModal(id) { const el = $(id); if (el) el.classList.remove("show"); }

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

  function statusPill(status) {
    const active = status === "Active";
    const span = node("span", null, `pill ${active ? "ok" : "warn"}`);
    span.appendChild(icon(active ? "fa-solid fa-circle-check" : "fa-solid fa-ban"));
    span.appendChild(document.createTextNode(` ${active ? "Active" : "Inactive"}`));
    return span;
  }

  function infoPill(text) {
    const span = node("span", null, "pill info");
    span.appendChild(icon("fa-solid fa-key"));
    span.appendChild(document.createTextNode(` ${text}`));
    return span;
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0 && state.view === "list");
  }

  function setView(view) {
    state.view = ["list", "permissions", "summary"].includes(view) ? view : "list";
    document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
    $("view-list").style.display = state.view === "list" ? "" : "none";
    $("view-permissions").style.display = state.view === "permissions" ? "" : "none";
    $("view-summary").style.display = state.view === "summary" ? "" : "none";
    const titles = {
      list: ["Roles", "Manage staff role records and access permissions."],
      permissions: ["Permissions", "Review permissions assigned to roles."],
      summary: ["Summary", "Role and permission summary."],
    };
    $("panelTitle").textContent = titles[state.view][0];
    $("panelSub").textContent = titles[state.view][1];
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${ROLES.length} role(s)`;
    $("checkAll").checked = ROLES.length > 0 && ROLES.every((x) => state.selected.has(x.id));
    const body = $("tbody");
    body.replaceChildren();

    if (!ROLES.length) {
      const tr = node("tr"); const td = node("td"); td.colSpan = 8; td.style.padding = "18px";
      td.appendChild(node("div", "No roles found.", "muted")); tr.appendChild(td); body.appendChild(tr); return;
    }

    ROLES.forEach((role) => {
      const tr = node("tr"); tr.dataset.id = role.id;
      const selectTd = node("td");
      const check = document.createElement("input"); check.type = "checkbox"; check.className = "rowCheck"; check.dataset.id = role.id; check.checked = state.selected.has(role.id);
      selectTd.appendChild(check); tr.appendChild(selectTd);

      const roleTd = node("td"); roleTd.appendChild(node("div", role.name || "", "strong")); roleTd.appendChild(node("div", role.description || "—", "muted")); tr.appendChild(roleTd);
      tr.appendChild(node("td", role.code || "—"));
      const permTd = node("td"); permTd.appendChild(infoPill((role.permissions || []).length)); tr.appendChild(permTd);
      tr.appendChild(node("td", role.usersCount || 0));
      const statusTd = node("td"); statusTd.appendChild(statusPill(role.status)); tr.appendChild(statusTd);
      tr.appendChild(node("td", role.createdAt || "—"));
      const actionsTd = node("td"); const actions = node("div", null, "actions");
      actions.appendChild(button("actView", "View", "fa-solid fa-eye"));
      actions.appendChild(button("actEdit", "Edit", "fa-solid fa-pen"));
      actions.appendChild(button("actActivate", "Activate", "fa-solid fa-circle-check"));
      actions.appendChild(button("actDeactivate", "Deactivate", "fa-solid fa-ban"));
      actions.appendChild(button("actDelete", "Delete", "fa-solid fa-trash"));
      actionsTd.appendChild(actions); tr.appendChild(actionsTd);
      body.appendChild(tr);
    });
  }

  function renderPerms() {
    $("resultMeta").textContent = `${ROLES.length} role(s)`;
    const body = $("tbodyPerms"); body.replaceChildren();
    if (!ROLES.length) {
      const tr = node("tr"); const td = node("td"); td.colSpan = 2; td.style.padding = "18px"; td.appendChild(node("div", "No permissions found.", "muted")); tr.appendChild(td); body.appendChild(tr); return;
    }
    ROLES.forEach((role) => {
      const tr = node("tr");
      const roleTd = node("td"); roleTd.appendChild(node("div", role.name || "", "strong")); roleTd.appendChild(node("div", role.code || "—", "muted")); tr.appendChild(roleTd);
      tr.appendChild(node("td", (role.permissions || []).length ? role.permissions.join(", ") : "—"));
      body.appendChild(tr);
    });
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    else if (state.view === "permissions") renderPerms();
    else $("resultMeta").textContent = `${ROLES.length} role(s)`;
  }

  function clearPermissionChecks() { document.querySelectorAll(".permCheck").forEach((el) => { el.checked = false; }); }
  function setPermissionChecks(role) {
    clearPermissionChecks();
    const granted = new Set(role.permissions || []);
    document.querySelectorAll(".permCheck").forEach((el) => { el.checked = granted.has(el.dataset.permission || ""); });
  }

  function openEditor(role) {
    role = role || null;
    $("mTitle").textContent = role ? "Edit Role" : "Create Role";
    $("roleForm").action = role ? `/admin/roles/${encodeURIComponent(role.id)}/update` : "/admin/roles";
    $("rName").value = role?.name || "";
    $("rCode").value = role?.code || "";
    $("rStatus").value = role?.status || "Active";
    $("rDescription").value = role?.description || "";
    if (role) setPermissionChecks(role); else clearPermissionChecks();
    openModal("mEdit");
  }

  function openViewModal(role) {
    $("vName").textContent = role.name || "—";
    $("vCode").textContent = role.code || "—";
    $("vStatus").textContent = role.status || "—";
    $("vUsersCount").textContent = String(role.usersCount || 0);
    $("vDescription").textContent = role.description || "—";
    $("vPermissions").textContent = (role.permissions || []).length ? role.permissions.join(", ") : "—";
    openModal("mView");
  }

  $("btnCreate")?.addEventListener("click", () => openEditor());
  $("quickNewRole")?.addEventListener("click", () => openEditor());
  $("viewChips")?.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) setView(b.dataset.view); });
  $("checkAll")?.addEventListener("change", (e) => { if (e.target.checked) ROLES.forEach((x) => state.selected.add(x.id)); else state.selected.clear(); render(); });
  $("tbody")?.addEventListener("change", (e) => { if (!e.target.classList.contains("rowCheck")) return; e.target.checked ? state.selected.add(e.target.dataset.id) : state.selected.delete(e.target.dataset.id); render(); });
  $("tbody")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]"); if (!tr) return;
    const role = ROLES.find((x) => x.id === tr.dataset.id); if (!role) return;
    if (e.target.closest(".actView")) return openViewModal(role);
    if (e.target.closest(".actEdit")) return openEditor(role);
    if (e.target.closest(".actActivate")) return submitRowAction(`/admin/roles/${encodeURIComponent(role.id)}/activate`);
    if (e.target.closest(".actDeactivate")) return submitRowAction(`/admin/roles/${encodeURIComponent(role.id)}/deactivate`);
    if (e.target.closest(".actDelete") && window.confirm(`Delete role "${role.name}"?`)) return submitRowAction(`/admin/roles/${encodeURIComponent(role.id)}/delete`);
  });

  $("btnBulk")?.addEventListener("click", () => { if (!state.selected.size) return window.alert("Select at least one role."); $("bulkbar").classList.add("show"); });
  $("bulkClear")?.addEventListener("click", () => { state.selected.clear(); render(); });
  $("bulkActivate")?.addEventListener("click", () => bulkSubmit("activate"));
  $("bulkDeactivate")?.addEventListener("click", () => bulkSubmit("deactivate"));
  $("bulkDelete")?.addEventListener("click", () => { if (state.selected.size && window.confirm("Delete selected roles?")) bulkSubmit("delete"); });
  $("btnExport")?.addEventListener("click", () => { window.location.href = `/admin/roles/export.csv${window.location.search || ""}`; });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
  ["mEdit", "mView"].forEach((id) => $(id)?.addEventListener("click", (e) => { if (e.target.id === id) closeModal(id); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show")); });

  setView("list");
})();

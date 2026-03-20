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

  const ROLES = readJson("rolesData");
  const PERMS = Array.isArray(window.__ROLE_PERMS__) ? window.__ROLE_PERMS__ : [];

  if (!$("tbody")) return;

  const state = {
    view: "list",
    selected: new Set(),
  };

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

  function pillStatus(v) {
    return v === "Active"
      ? '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>'
      : '<span class="pill warn"><i class="fa-solid fa-ban"></i> Inactive</span>';
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
    $("view-permissions").style.display = v === "permissions" ? "" : "none";
    $("view-summary").style.display = v === "summary" ? "" : "none";

    const titles = {
      list: ["Roles", "Manage staff role records and access permissions."],
      permissions: ["Permissions", "Review permissions assigned to roles."],
      summary: ["Summary", "Role and permission summary."],
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${ROLES.length} role(s)`;
    $("checkAll").checked = ROLES.length > 0 && ROLES.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML =
      ROLES.map((a) => {
        const checked = state.selected.has(a.id) ? "checked" : "";
        return `
          <tr data-id="${a.id}">
            <td><input type="checkbox" class="rowCheck" data-id="${a.id}" ${checked}></td>
            <td><div class="strong">${a.name || ""}</div><div class="muted">${a.description || "—"}</div></td>
            <td>${a.code || "—"}</td>
            <td><span class="pill info"><i class="fa-solid fa-key"></i> ${(a.permissions || []).length}</span></td>
            <td>${a.usersCount || 0}</td>
            <td>${pillStatus(a.status)}</td>
            <td>${a.createdAt || "—"}</td>
            <td>
              <div class="actions">
                <button class="btn-xs actView" type="button"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actActivate" type="button"><i class="fa-solid fa-circle-check"></i></button>
                <button class="btn-xs actDeactivate" type="button"><i class="fa-solid fa-ban"></i></button>
                <button class="btn-xs actDelete" type="button"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      '<tr><td colspan="8" style="padding:18px;"><div class="muted">No roles found.</div></td></tr>';
  }

  function renderPerms() {
    $("resultMeta").textContent = `${ROLES.length} role(s)`;
    $("tbodyPerms").innerHTML =
      ROLES.map((a) => `
        <tr>
          <td><div class="strong">${a.name || ""}</div><div class="muted">${a.code || "—"}</div></td>
          <td>${(a.permissions || []).length ? (a.permissions || []).join(", ") : "—"}</td>
        </tr>
      `).join("") ||
      '<tr><td colspan="2" style="padding:18px;"><div class="muted">No permissions found.</div></td></tr>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "permissions") renderPerms();
    if (state.view === "summary") $("resultMeta").textContent = `${ROLES.length} role(s)`;
  }

  function clearPermissionChecks() {
    document.querySelectorAll('.permCheck').forEach((el) => {
      el.checked = false;
    });
  }

  function setPermissionChecks(role) {
    clearPermissionChecks();
    (role.permissions || []).forEach((key) => {
      const el = document.querySelector(`.permCheck[name="perm_${key}"]`);
      if (el) el.checked = true;
    });
  }

  function openEditor(pref) {
    pref = pref || null;
    $("mTitle").textContent = pref ? "Edit Role" : "Create Role";

    const form = $("roleForm");
    form.action = pref ? `/admin/roles/${pref.id}/update` : "/admin/roles";

    $("rName").value = pref ? (pref.name || "") : "";
    $("rCode").value = pref ? (pref.code || "") : "";
    $("rStatus").value = pref ? (pref.status || "Active") : "Active";
    $("rDescription").value = pref ? (pref.description || "") : "";

    if (pref) setPermissionChecks(pref);
    else clearPermissionChecks();

    openModal("mEdit");
  }

  function openViewModal(a) {
    $("vName").textContent = a.name || "—";
    $("vCode").textContent = a.code || "—";
    $("vStatus").textContent = a.status || "—";
    $("vUsersCount").textContent = a.usersCount || 0;
    $("vDescription").textContent = a.description || "—";
    $("vPermissions").textContent = (a.permissions || []).length ? a.permissions.join(", ") : "—";
    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () { openEditor(); });
  $("quickNewRole").addEventListener("click", function () { openEditor(); });

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) ROLES.forEach((a) => state.selected.add(a.id));
    else ROLES.forEach((a) => state.selected.delete(a.id));
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
    const a = ROLES.find((x) => x.id === tr.dataset.id);
    if (!a) return;

    if (e.target.closest(".actView")) return openViewModal(a);
    if (e.target.closest(".actEdit")) return openEditor(a);
    if (e.target.closest(".actActivate")) return submitRowAction(`/admin/roles/${a.id}/activate`);
    if (e.target.closest(".actDeactivate")) return submitRowAction(`/admin/roles/${a.id}/deactivate`);
    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete role "${a.name}"?`)) {
        return submitRowAction(`/admin/roles/${a.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one role.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkActivate").addEventListener("click", function () { bulkSubmit("activate"); });
  $("bulkDeactivate").addEventListener("click", function () { bulkSubmit("deactivate"); });
  $("bulkDelete").addEventListener("click", function () {
    if (!state.selected.size) return;
    if (window.confirm("Delete selected roles?")) bulkSubmit("delete");
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
    alert("Hook role export route later.");
  });

  setView("list");
})();
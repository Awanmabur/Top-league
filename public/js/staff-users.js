(function () {
  const $ = (id) => document.getElementById(id);

  function readData() {
    const el = $("usersData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse users data:", err);
      return [];
    }
  }

  const USERS = readData();
  if (!$("tbody")) return;

  const state = {
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

  function submitRowAction(actionUrl, fields) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;

    form.querySelectorAll(".dyn").forEach((n) => n.remove());

    Object.entries(fields || {}).forEach(([key, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = value;
      input.className = "dyn";
      form.appendChild(input);
    });

    form.submit();
  }

  function bulkSubmit(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return;
    $("bulkIds").value = ids.join(",");
    $("bulkActionInput").value = action;
    $("bulkForm").submit();
  }

  function statusPill(u) {
    if (u.status === "active") return '<span class="pill ok"><i class="fa-solid fa-check"></i> Active</span>';
    if (u.status === "invited") return '<span class="pill warn"><i class="fa-solid fa-paper-plane"></i> Invited</span>';
    return '<span class="pill bad"><i class="fa-solid fa-ban"></i> Suspended</span>';
  }

  function passwordPill(u) {
    return u.hasPassword
      ? '<span class="pill ok"><i class="fa-solid fa-lock"></i> Set</span>'
      : '<span class="pill warn"><i class="fa-solid fa-key"></i> Pending</span>';
  }

  function linkedProfile(u) {
    if (u.staffId) return '<span class="pill info"><i class="fa-solid fa-id-badge"></i> Staff</span>';
    if (u.studentId) return '<span class="pill info"><i class="fa-solid fa-user-graduate"></i> Student</span>';
    return '<span class="pill info"><i class="fa-regular fa-circle"></i> None</span>';
  }

  function roleBadges(roles) {
    const arr = Array.isArray(roles) ? roles : [];
    if (!arr.length) return '<span class="pill info">—</span>';
    return arr.map((r) => `<span class="pill info"><i class="fa-solid fa-user-shield"></i> ${r}</span>`).join(" ");
  }

  function syncBulkbar() {
    $("selCount").textContent = state.selected.size;
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function render() {
    $("resultMeta").textContent = `${USERS.length} user(s)`;
    $("checkAll").checked = USERS.length > 0 && USERS.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = USERS.map((u) => {
      const checked = state.selected.has(u.id) ? "checked" : "";
      return `
        <tr data-id="${u.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${u.id}" ${checked}></td>
          <td>
            <div class="strong">${u.fullName || "—"}</div>
          </td>
          <td>
            <div>${u.email || "—"}</div>
            <div class="muted">${u.phone || "—"}</div>
          </td>
          <td><div class="role-badges">${roleBadges(u.roles)}</div></td>
          <td>${passwordPill(u)}</td>
          <td>${statusPill(u)}</td>
          <td>${linkedProfile(u)}</td>
          <td class="muted">${u.createdAt || "—"}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actResend" type="button" title="Resend Invite"><i class="fa-solid fa-paper-plane"></i></button>
              <button class="btn-xs actActivate" type="button" title="Activate"><i class="fa-solid fa-check"></i></button>
              <button class="btn-xs actSuspend" type="button" title="Suspend"><i class="fa-solid fa-ban"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="9" style="padding:18px;"><div class="muted">No users found.</div></td></tr>';

    syncBulkbar();
  }

  function resetForm() {
    $("mTitle").textContent = "Create User";
    $("userForm").action = "/admin/staff-users";
    $("uFirstName").value = "";
    $("uLastName").value = "";
    $("uPhone").value = "";
    $("uEmail").value = "";
    $("uRole").value = "";
    $("uDepartmentId").value = "";
    $("uRegNo").value = "";
    $("uProgramId").value = "";
    $("uClassGroupId").value = "";
    toggleRoleFields();
  }

  function toggleRoleFields() {
    const role = $("uRole").value;
    $("studentFields").style.display = role === "student" ? "" : "none";
  }

  function openView(u) {
    $("vName").textContent = u.fullName || "—";
    $("vEmail").textContent = u.email || "—";
    $("vPhone").textContent = u.phone || "—";
    $("vStatus").textContent = u.status || "—";
    $("vRoles").textContent = u.rolesText || "—";
    $("vPassword").textContent = u.hasPassword ? "Password Set" : "Password Pending";
    $("vLinked").textContent = u.staffId ? "Staff Profile" : (u.studentId ? "Student Profile" : "None");
    $("vCreated").textContent = u.createdAt || "—";
    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () {
    resetForm();
    openModal("mEdit");
  });

  $("quickStaff").addEventListener("click", function () {
    resetForm();
    $("uRole").value = "staff";
    toggleRoleFields();
    openModal("mEdit");
  });

  $("quickStudent").addEventListener("click", function () {
    resetForm();
    $("uRole").value = "student";
    toggleRoleFields();
    openModal("mEdit");
  });

  $("uRole").addEventListener("change", toggleRoleFields);

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) USERS.forEach((x) => state.selected.add(x.id));
    else USERS.forEach((x) => state.selected.delete(x.id));
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

    const u = USERS.find((x) => x.id === tr.dataset.id);
    if (!u) return;

    if (e.target.closest(".actView")) return openView(u);
    if (e.target.closest(".actResend")) return submitRowAction(`/admin/staff-users/${u.id}/resend-invite`);
    if (e.target.closest(".actActivate")) return submitRowAction(`/admin/staff-users/${u.id}/status`, { status: "active" });
    if (e.target.closest(".actSuspend")) return submitRowAction(`/admin/staff-users/${u.id}/status`, { status: "suspended" });
    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete "${u.fullName}"?`)) {
        return submitRowAction(`/admin/staff-users/${u.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one user.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate").addEventListener("click", function () { bulkSubmit("activate"); });
  $("bulkSuspend").addEventListener("click", function () { bulkSubmit("suspend"); });
  $("bulkDelete").addEventListener("click", function () {
    if (window.confirm("Delete selected users?")) bulkSubmit("delete");
  });
  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
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

  render();
})();
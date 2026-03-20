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

  const ALL_USERS = readData();
  if (!$("tbody")) return;

  const state = {
    selected: new Set(),
    q: "",
    status: "all",
    role: "all",
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

  function closeAllModals() {
    document.querySelectorAll(".modal-backdrop.show").forEach((el) => {
      el.classList.remove("show");
    });
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

  function getFilteredUsers() {
    return ALL_USERS.filter((u) => {
      const hay = [
        u.fullName,
        u.firstName,
        u.lastName,
        u.email,
        u.phone,
        ...(u.roles || []),
        u.status,
      ].join(" ").toLowerCase();

      const matchesQ = !state.q || hay.includes(state.q);
      const matchesStatus = state.status === "all" || u.status === state.status;
      const matchesRole = state.role === "all" || (u.roles || []).includes(state.role);

      return matchesQ && matchesStatus && matchesRole;
    });
  }

  function syncBulkbar(filteredUsers) {
    $("selCount").textContent = state.selected.size;
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
    $("resultMeta").textContent = `${filteredUsers.length} user(s)`;
    $("checkAll").checked =
      filteredUsers.length > 0 &&
      filteredUsers.every((x) => state.selected.has(x.id));
  }

  function render() {
    const users = getFilteredUsers();

    $("tbody").innerHTML = users.map((u) => {
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

    syncBulkbar(users);
  }

  function resetForm() {
    $("mTitle").textContent = "Create User";
    $("userForm").action = "/admin/users";
    $("uFirstName").value = "";
    $("uLastName").value = "";
    $("uPhone").value = "";
    $("uEmail").value = "";
    $("uRole").value = "";
    $("uDepartmentId").value = "";
    $("uRegNo").value = "";
    if ($("uProgramId")) $("uProgramId").value = "";
    if ($("uClassGroupId")) $("uClassGroupId").value = "";
    toggleRoleFields();
  }

  function toggleRoleFields() {
    const role = $("uRole").value;
    const studentFields = $("studentFields");
    const deptWrap = $("deptWrap");

    if (studentFields) studentFields.style.display = role === "student" ? "" : "none";
    if (deptWrap) deptWrap.style.display = role === "student" ? "none" : "";
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

  function copyInviteLink() {
    const el = $("inviteLinkBox");
    if (!el || !el.value) return;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(el.value).then(() => {
        alert("Invite link copied.");
      }).catch(() => fallbackCopy(el));
      return;
    }
    fallbackCopy(el);
  }

  function fallbackCopy(el) {
    el.focus();
    el.select();
    el.setSelectionRange(0, 999999);
    document.execCommand("copy");
    alert("Invite link copied.");
  }

  $("btnCreate")?.addEventListener("click", function () {
    resetForm();
    openModal("mEdit");
  });

  $("quickStaff")?.addEventListener("click", function () {
    resetForm();
    $("uRole").value = "staff";
    toggleRoleFields();
    openModal("mEdit");
  });

  $("quickStudent")?.addEventListener("click", function () {
    resetForm();
    $("uRole").value = "student";
    toggleRoleFields();
    openModal("mEdit");
  });

  $("uRole")?.addEventListener("change", toggleRoleFields);

  $("q")?.addEventListener("input", function (e) {
    state.q = String(e.target.value || "").trim().toLowerCase();
    render();
  });

  $("filterStatus")?.addEventListener("change", function (e) {
    state.status = e.target.value || "all";
    render();
  });

  $("filterRole")?.addEventListener("change", function (e) {
    state.role = e.target.value || "all";
    render();
  });

  $("btnResetFilters")?.addEventListener("click", function () {
    state.q = "";
    state.status = "all";
    state.role = "all";
    $("q").value = "";
    $("filterStatus").value = "all";
    $("filterRole").value = "all";
    render();
  });

  $("checkAll")?.addEventListener("change", function (e) {
    const filteredUsers = getFilteredUsers();
    if (e.target.checked) filteredUsers.forEach((x) => state.selected.add(x.id));
    else filteredUsers.forEach((x) => state.selected.delete(x.id));
    render();
  });

  $("tbody")?.addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    render();
  });

  $("tbody")?.addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const u = ALL_USERS.find((x) => x.id === tr.dataset.id);
    if (!u) return;

    if (e.target.closest(".actView")) return openView(u);

    if (e.target.closest(".actResend")) {
      return submitRowAction(`/admin/users/${u.id}/resend-invite`);
    }

    if (e.target.closest(".actActivate")) {
      return submitRowAction(`/admin/users/${u.id}/status`, { status: "active" });
    }

    if (e.target.closest(".actSuspend")) {
      return submitRowAction(`/admin/users/${u.id}/status`, { status: "suspended" });
    }

    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete "${u.fullName}"?`)) {
        return submitRowAction(`/admin/users/${u.id}/delete`);
      }
    }
  });

  $("btnBulk")?.addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one user.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate")?.addEventListener("click", function () { bulkSubmit("activate"); });
  $("bulkSuspend")?.addEventListener("click", function () { bulkSubmit("suspend"); });
  $("bulkDelete")?.addEventListener("click", function () {
    if (window.confirm("Delete selected users?")) bulkSubmit("delete");
  });
  $("bulkClear")?.addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("btnCopyInvite")?.addEventListener("click", copyInviteLink);

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mEdit", "mView", "mInvite"].forEach(function (mid) {
    const el = $(mid);
    if (!el) return;
    el.addEventListener("click", function (e) {
      if (e.target.id === mid) closeModal(mid);
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAllModals();
  });

  toggleRoleFields();
  render();

  if (window.__OPEN_MODAL__) {
    openModal(window.__OPEN_MODAL__);
  }
})();
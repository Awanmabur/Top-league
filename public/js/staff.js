(function () {
  const $ = (id) => document.getElementById(id);

  function readData() {
    const el = $("staffData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse staff data:", err);
      return [];
    }
  }

  const DATA = readData();
  if (!$("tbody")) return;

  const state = {
    selected: new Set(),
  };

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("show");
    document.body.style.overflow = "";
  }

  function submitRowAction(actionUrl, fields) {
    const form = $("rowActionForm");
    if (!form) return;

    form.action = actionUrl;
    form.querySelectorAll(".dyn").forEach((n) => n.remove());

    Object.entries(fields || {}).forEach(([k, v]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = k;
      input.value = v;
      input.className = "dyn";
      form.appendChild(input);
    });

    form.submit();
  }

  function bulkSubmit(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) {
      alert("Select at least one staff record.");
      return;
    }

    $("bulkIds").value = ids.join(",");
    $("bulkActionInput").value = action;
    $("bulkForm").submit();
  }

  function statusPill(s) {
    if (s === "Active") {
      return '<span class="pill ok"><i class="fa-solid fa-check"></i> Active</span>';
    }
    if (s === "On Leave") {
      return '<span class="pill warn"><i class="fa-solid fa-calendar-check"></i> On Leave</span>';
    }
    if (s === "Suspended") {
      return '<span class="pill bad"><i class="fa-solid fa-ban"></i> Suspended</span>';
    }
    return '<span class="pill info"><i class="fa-solid fa-door-open"></i> Exited</span>';
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function currency(n) {
    return Number(n || 0).toLocaleString();
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function render() {
    $("resultMeta").textContent = `${DATA.length} staff record(s)`;
    $("checkAll").checked = DATA.length > 0 && DATA.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML =
      DATA.map((s) => {
        const checked = state.selected.has(s.id) ? "checked" : "";
        return `
          <tr data-id="${escapeHtml(s.id)}">
            <td><input type="checkbox" class="rowCheck" data-id="${escapeHtml(s.id)}" ${checked}></td>
            <td>
              <div class="strong">${escapeHtml(s.fullName || "")}</div>
              <div class="muted">${escapeHtml(s.email || "—")} • ${escapeHtml(s.phone || "—")}</div>
            </td>
            <td><span class="pill info"><i class="fa-solid fa-id-badge"></i> ${escapeHtml(s.employeeId || "—")}</span></td>
            <td>${escapeHtml(s.departmentName || "—")}</td>
            <td>
              <div class="strong">${escapeHtml(s.roleName || "—")}</div>
              <div class="muted">${escapeHtml(s.jobTitle || "—")}</div>
            </td>
            <td><span class="pill info"><i class="fa-solid fa-briefcase"></i> ${escapeHtml(s.employmentType || "—")}</span></td>
            <td>${currency(s.salary)}</td>
            <td>${statusPill(s.status)}</td>
            <td>
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actActive" type="button" title="Activate"><i class="fa-solid fa-check"></i></button>
                <button class="btn-xs actLeave" type="button" title="On Leave"><i class="fa-solid fa-calendar-check"></i></button>
                <button class="btn-xs actSuspend" type="button" title="Suspend"><i class="fa-solid fa-ban"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      '<tr><td colspan="9" style="padding:18px;"><div class="muted">No staff found.</div></td></tr>';

    syncBulkbar();
  }

  function fillForm(s) {
    $("mTitle").textContent = s ? "Edit Staff" : "Add Staff";
    const form = $("staffForm");
    form.action = s ? `/admin/staff/${encodeURIComponent(s.id)}/update` : "/admin/staff";

    $("fUserId").value = s && s.userId ? s.userId : "";
    $("fEmployeeId").value = s && s.employeeId !== "—" ? (s.employeeId || "") : "";
    $("fFirstName").value = s ? s.firstName || "" : "";
    $("fMiddleName").value = s ? s.middleName || "" : "";
    $("fLastName").value = s ? s.lastName || "" : "";
    $("fEmail").value = s ? s.email || "" : "";
    $("fPhone").value = s ? s.phone || "" : "";
    $("fGender").value = s ? s.gender || "" : "";
    $("fDepartmentId").value = s ? s.departmentId || "" : "";
    $("fRoleId").value = s ? s.roleId || "" : "";
    $("fJobTitle").value = s ? s.jobTitle || "" : "";
    $("fEmploymentType").value = s ? s.employmentType || "Full Time" : "Full Time";
    $("fJoinDate").value = s ? s.joinDate || "" : "";
    $("fSalary").value = s ? s.salary || 0 : 0;
    $("fPayrollNumber").value = s ? s.payrollNumber || "" : "";
    $("fBankName").value = s ? s.bankName || "" : "";
    $("fBankAccountName").value = s ? s.bankAccountName || "" : "";
    $("fBankAccountNumber").value = s ? s.bankAccountNumber || "" : "";
    $("fStatus").value = s ? s.status || "Active" : "Active";
    $("fAddress").value = s ? s.address || "" : "";
    $("fEmergencyContactName").value = s ? s.emergencyContactName || "" : "";
    $("fEmergencyContactPhone").value = s ? s.emergencyContactPhone || "" : "";
    $("fNotes").value = s ? s.notes || "" : "";

    openModal("mEdit");
  }

  function openView(s) {
    $("vName").textContent = s.fullName || "—";
    $("vEmployeeId").textContent = s.employeeId || "—";
    $("vEmail").textContent = s.email || "—";
    $("vPhone").textContent = s.phone || "—";
    $("vDepartment").textContent = s.departmentName || "—";
    $("vRole").textContent = s.roleName || s.jobTitle || "—";
    $("vEmploymentType").textContent = s.employmentType || "—";
    $("vStatus").textContent = s.status || "—";
    $("vJoinDate").textContent = s.joinDate || "—";
    $("vSalary").textContent = currency(s.salary);
    $("vPayrollNumber").textContent = s.payrollNumber || "—";
    $("vEmergency").textContent = `${s.emergencyContactName || "—"}${s.emergencyContactPhone ? " • " + s.emergencyContactPhone : ""}`;
    $("vNotes").textContent = s.notes || "—";
    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () {
    fillForm(null);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) DATA.forEach((x) => state.selected.add(x.id));
    else DATA.forEach((x) => state.selected.delete(x.id));
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

    const s = DATA.find((x) => x.id === tr.dataset.id);
    if (!s) return;

    if (e.target.closest(".actView")) return openView(s);
    if (e.target.closest(".actEdit")) return fillForm(s);
    if (e.target.closest(".actActive")) return submitRowAction(`/admin/staff/${encodeURIComponent(s.id)}/status`, { status: "Active" });
    if (e.target.closest(".actLeave")) return submitRowAction(`/admin/staff/${encodeURIComponent(s.id)}/status`, { status: "On Leave" });
    if (e.target.closest(".actSuspend")) return submitRowAction(`/admin/staff/${encodeURIComponent(s.id)}/status`, { status: "Suspended" });
    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete "${s.fullName}"?`)) {
        return submitRowAction(`/admin/staff/${encodeURIComponent(s.id)}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one staff record.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate").addEventListener("click", function () {
    bulkSubmit("activate");
  });

  $("bulkLeave").addEventListener("click", function () {
    bulkSubmit("leave");
  });

  $("bulkSuspend").addEventListener("click", function () {
    bulkSubmit("suspend");
  });

  $("bulkExit").addEventListener("click", function () {
    bulkSubmit("exit");
  });

  $("bulkDelete").addEventListener("click", function () {
    if (window.confirm("Delete selected staff records?")) {
      bulkSubmit("delete");
    }
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
      document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show"));
      document.body.style.overflow = "";
    }
  });

  render();
})();
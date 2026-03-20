(function () {
  const $ = (id) => document.getElementById(id);

  function readData() {
    const el = $("leaveData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse leave data:", err);
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

  function statusPill(x) {
    if (x.status === "Approved") return '<span class="pill ok"><i class="fa-solid fa-check"></i> Approved</span>';
    if (x.status === "Pending") return '<span class="pill warn"><i class="fa-solid fa-clock"></i> Pending</span>';
    if (x.status === "Rejected") return '<span class="pill bad"><i class="fa-solid fa-ban"></i> Rejected</span>';
    return '<span class="pill info"><i class="fa-solid fa-xmark"></i> Cancelled</span>';
  }

  function syncBulkbar() {
    $("selCount").textContent = state.selected.size;
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function render() {
    $("resultMeta").textContent = `${DATA.length} leave request(s)`;
    $("checkAll").checked = DATA.length > 0 && DATA.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = DATA.map((x) => {
      const checked = state.selected.has(x.id) ? "checked" : "";
      return `
        <tr data-id="${x.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${x.id}" ${checked}></td>
          <td>
            <div class="strong">${x.staffName || "—"}</div>
            <div class="muted">${x.employeeId || "—"} • ${x.departmentName || "—"}</div>
          </td>
          <td><span class="pill info"><i class="fa-solid fa-tag"></i> ${x.leaveType || "—"}</span></td>
          <td>
            <div class="strong">${x.startDate || "—"} → ${x.endDate || "—"}</div>
          </td>
          <td><span class="pill info"><i class="fa-solid fa-calendar-days"></i> ${x.days || 0}</span></td>
          <td>${statusPill(x)}</td>
          <td><div class="muted">${x.reason || "—"}</div></td>
          <td class="muted">${x.updatedAt || "—"}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-xs actApprove" type="button" title="Approve"><i class="fa-solid fa-check"></i></button>
              <button class="btn-xs actReject" type="button" title="Reject"><i class="fa-solid fa-ban"></i></button>
              <button class="btn-xs actCancel" type="button" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="9" style="padding:18px;"><div class="muted">No leave requests found.</div></td></tr>';

    syncBulkbar();
  }

  function resetForm() {
    $("mTitle").textContent = "New Leave Request";
    $("leaveForm").action = "/admin/staff-leave";
    $("lStaffId").value = "";
    $("lLeaveType").value = "Annual";
    $("lStartDate").value = "";
    $("lEndDate").value = "";
    $("lDays").value = 0;
    $("lReason").value = "";
  }

  function calcDays() {
    const start = $("lStartDate").value;
    const end = $("lEndDate").value;
    if (!start || !end) {
      $("lDays").value = 0;
      return;
    }

    const a = new Date(start);
    const b = new Date(end);
    const diff = Math.floor((b - a) / 86400000);
    $("lDays").value = diff >= 0 ? diff + 1 : 0;
  }

  function openEditor(x) {
    if (!x) {
      resetForm();
      openModal("mEdit");
      return;
    }

    $("mTitle").textContent = "Edit Leave Request";
    $("leaveForm").action = `/admin/staff-leave/${x.id}/update`;
    $("lStaffId").value = x.staffId || "";
    $("lLeaveType").value = x.leaveType || "Annual";
    $("lStartDate").value = x.startDate || "";
    $("lEndDate").value = x.endDate || "";
    $("lDays").value = x.days || 0;
    $("lReason").value = x.reason || "";
    openModal("mEdit");
  }

  function openView(x) {
    $("vStaff").textContent = x.staffName || "—";
    $("vEmployeeId").textContent = x.employeeId || "—";
    $("vDepartment").textContent = x.departmentName || "—";
    $("vLeaveType").textContent = x.leaveType || "—";
    $("vStartDate").textContent = x.startDate || "—";
    $("vEndDate").textContent = x.endDate || "—";
    $("vDays").textContent = x.days || "—";
    $("vStatus").textContent = x.status || "—";
    $("vReason").textContent = x.reason || "—";
    $("vRejectionReason").textContent = x.rejectionReason || "—";
    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor(null);
  });

  $("quickAnnual").addEventListener("click", function () {
    resetForm();
    $("lLeaveType").value = "Annual";
    openModal("mEdit");
  });

  $("quickSick").addEventListener("click", function () {
    resetForm();
    $("lLeaveType").value = "Sick";
    openModal("mEdit");
  });

  $("lStartDate").addEventListener("change", calcDays);
  $("lEndDate").addEventListener("change", calcDays);

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

    const x = DATA.find((row) => row.id === tr.dataset.id);
    if (!x) return;

    if (e.target.closest(".actView")) return openView(x);
    if (e.target.closest(".actEdit")) return openEditor(x);
    if (e.target.closest(".actApprove")) return submitRowAction(`/admin/staff-leave/${x.id}/approve`);
    if (e.target.closest(".actReject")) {
      const reason = window.prompt("Reason for rejection:", x.rejectionReason || "");
      if (reason === null) return;
      return submitRowAction(`/admin/staff-leave/${x.id}/reject`, { rejectionReason: reason });
    }
    if (e.target.closest(".actCancel")) return submitRowAction(`/admin/staff-leave/${x.id}/cancel`);
    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete leave request for "${x.staffName}"?`)) {
        return submitRowAction(`/admin/staff-leave/${x.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one leave request.");
    $("bulkbar").classList.add("show");
  });

  $("bulkApprove").addEventListener("click", function () { bulkSubmit("approve"); });
  $("bulkReject").addEventListener("click", function () { bulkSubmit("reject"); });
  $("bulkCancel").addEventListener("click", function () { bulkSubmit("cancel"); });
  $("bulkDelete").addEventListener("click", function () {
    if (window.confirm("Delete selected leave requests?")) bulkSubmit("delete");
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
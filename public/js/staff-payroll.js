(function () {
  const $ = (id) => document.getElementById(id);

  function readData() {
    const el = $("payrollData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse payroll data:", err);
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

  function money(n) {
    return Number(n || 0).toLocaleString();
  }

  function statusPill(x) {
    if (x.status === "Draft") return '<span class="pill warn"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
    if (x.status === "Processed") return '<span class="pill info"><i class="fa-solid fa-gears"></i> Processed</span>';
    if (x.status === "Paid") return '<span class="pill ok"><i class="fa-solid fa-money-check-dollar"></i> Paid</span>';
    return '<span class="pill bad"><i class="fa-solid fa-ban"></i> Cancelled</span>';
  }

  function syncBulkbar() {
    $("selCount").textContent = state.selected.size;
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function render() {
    $("resultMeta").textContent = `${DATA.length} payroll run(s)`;
    $("checkAll").checked = DATA.length > 0 && DATA.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = DATA.map((x) => {
      const checked = state.selected.has(x.id) ? "checked" : "";
      return `
        <tr data-id="${x.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${x.id}" ${checked}></td>
          <td>
            <div class="strong">${x.title || "—"}</div>
            <div class="muted">${x.createdAt || "—"}</div>
          </td>
          <td><span class="pill info"><i class="fa-solid fa-calendar-days"></i> ${x.month}/${x.year}</span></td>
          <td>${x.payDate || "—"}</td>
          <td><span class="pill info"><i class="fa-solid fa-users"></i> ${x.staffCount || 0}</span></td>
          <td>${money(x.gross)}</td>
          <td>${money(x.deductions)}</td>
          <td><strong>${money(x.net)}</strong></td>
          <td>${statusPill(x)}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-xs actProcess" type="button" title="Process"><i class="fa-solid fa-gears"></i></button>
              <button class="btn-xs actPaid" type="button" title="Mark Paid"><i class="fa-solid fa-money-check-dollar"></i></button>
              <button class="btn-xs actCancel" type="button" title="Cancel"><i class="fa-solid fa-ban"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="10" style="padding:18px;"><div class="muted">No payroll runs found.</div></td></tr>';

    syncBulkbar();
  }

  function resetForm() {
    const now = new Date();
    $("mTitle").textContent = "New Payroll Run";
    $("payrollForm").action = "/admin/staff-payroll";
    $("pTitle").value = "";
    $("pMonth").value = String(now.getMonth() + 1);
    $("pYear").value = String(now.getFullYear());
    $("pPayDate").value = "";
    $("pNotes").value = "";
  }

  function openEditor(x) {
    if (!x) {
      resetForm();
      openModal("mEdit");
      return;
    }

    $("mTitle").textContent = "Edit Payroll Run";
    $("payrollForm").action = `/admin/staff-payroll/${x.id}/update`;
    $("pTitle").value = x.title || "";
    $("pMonth").value = String(x.month || "");
    $("pYear").value = String(x.year || "");
    $("pPayDate").value = x.payDate || "";
    $("pNotes").value = x.notes || "";
    openModal("mEdit");
  }

  function openView(x) {
    $("vTitle").textContent = x.title || "—";
    $("vPeriod").textContent = `${x.month || "—"}/${x.year || "—"}`;
    $("vPayDate").textContent = x.payDate || "—";
    $("vStatus").textContent = x.status || "—";
    $("vStaffCount").textContent = x.staffCount || 0;
    $("vGross").textContent = money(x.gross);
    $("vDeductions").textContent = money(x.deductions);
    $("vNet").textContent = money(x.net);
    $("vNotes").textContent = x.notes || "—";
    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor(null);
  });

  $("quickCurrent").addEventListener("click", function () {
    resetForm();
    const now = new Date();
    $("pMonth").value = String(now.getMonth() + 1);
    $("pYear").value = String(now.getFullYear());
    $("pTitle").value = `Payroll ${now.getMonth() + 1}/${now.getFullYear()}`;
    openModal("mEdit");
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

    const x = DATA.find((row) => row.id === tr.dataset.id);
    if (!x) return;

    if (e.target.closest(".actView")) return openView(x);
    if (e.target.closest(".actEdit")) return openEditor(x);
    if (e.target.closest(".actProcess")) return submitRowAction(`/admin/staff-payroll/${x.id}/process`);
    if (e.target.closest(".actPaid")) return submitRowAction(`/admin/staff-payroll/${x.id}/paid`);
    if (e.target.closest(".actCancel")) return submitRowAction(`/admin/staff-payroll/${x.id}/cancel`);
    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete payroll run "${x.title}"?`)) {
        return submitRowAction(`/admin/staff-payroll/${x.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one payroll run.");
    $("bulkbar").classList.add("show");
  });

  $("bulkPaid").addEventListener("click", function () { bulkSubmit("paid"); });
  $("bulkCancel").addEventListener("click", function () { bulkSubmit("cancel"); });
  $("bulkDelete").addEventListener("click", function () {
    if (window.confirm("Delete selected payroll runs?")) bulkSubmit("delete");
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
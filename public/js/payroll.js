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

  const RUNS = readJson("payrollRunsData");
  const ITEMS = readJson("payrollItemsData");

  if (!$("tbody")) return;

  const state = {
    view: "list",
    selected: new Set(),
  };

  function money(v) {
    return Number(v || 0).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

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
    if (v === "Approved") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Approved</span>';
    if (v === "Processed") return '<span class="pill info"><i class="fa-solid fa-gears"></i> Processed</span>';
    if (v === "Closed") return '<span class="pill warn"><i class="fa-solid fa-lock"></i> Closed</span>';
    return '<span class="pill soft"><i class="fa-solid fa-file"></i> Draft</span>';
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
    $("view-items").style.display = v === "items" ? "" : "none";
    $("view-summary").style.display = v === "summary" ? "" : "none";

    const titles = {
      list: ["Payroll Runs", "Manage payroll periods and their status."],
      items: ["Payroll Items", "Review staff pay rows."],
      summary: ["Summary", "Payroll summary for current runs."],
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${RUNS.length} payroll run(s)`;
    $("checkAll").checked = RUNS.length > 0 && RUNS.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML =
      RUNS.map((a) => {
        const checked = state.selected.has(a.id) ? "checked" : "";
        return `
          <tr data-id="${a.id}">
            <td><input type="checkbox" class="rowCheck" data-id="${a.id}" ${checked}></td>
            <td>
              <div class="strong">${a.title || ""}</div>
              <div class="muted">${a.periodLabel || "—"}</div>
            </td>
            <td>${a.departmentName || "All Departments"}</td>
            <td>${a.month || "—"} ${a.year || ""}</td>
            <td>${a.payDate || "—"}</td>
            <td>${a.staffCount || 0}</td>
            <td>${money(a.grossAmount || 0)}</td>
            <td>${money(a.deductionsAmount || 0)}</td>
            <td>${money(a.netAmount || 0)}</td>
            <td>${pillStatus(a.status)}</td>
            <td>
              <div class="actions">
                <button class="btn-xs actView" type="button"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actProcess" type="button"><i class="fa-solid fa-gears"></i></button>
                <button class="btn-xs actApprove" type="button"><i class="fa-solid fa-circle-check"></i></button>
                <button class="btn-xs actClose" type="button"><i class="fa-solid fa-lock"></i></button>
                <button class="btn-xs actDelete" type="button"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      '<tr><td colspan="11" style="padding:18px;"><div class="muted">No payroll runs found.</div></td></tr>';
  }

  function renderItems() {
    $("resultMeta").textContent = `${ITEMS.length} payroll item(s)`;

    $("tbodyItems").innerHTML =
      ITEMS.map((a) => `
        <tr>
          <td><div class="strong">${a.staffName || "—"}</div></td>
          <td>${a.departmentName || "—"}</td>
          <td>${money(a.basicSalary || 0)}</td>
          <td>${money(a.allowances || 0)}</td>
          <td>${money(a.bonuses || 0)}</td>
          <td>${money(a.deductions || 0)}</td>
          <td>${money(a.netPay || 0)}</td>
          <td>${pillStatus(a.status || "Draft")}</td>
        </tr>
      `).join("") ||
      '<tr><td colspan="8" style="padding:18px;"><div class="muted">No payroll items found.</div></td></tr>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "items") renderItems();
    if (state.view === "summary") $("resultMeta").textContent = `${RUNS.length} payroll run(s)`;
  }

  function openEditor(pref) {
    pref = pref || null;
    $("mTitle").textContent = pref ? "Edit Payroll Run" : "Create Payroll Run";
    const form = $("payrollForm");
    form.action = pref ? `/admin/payroll/${pref.id}/update` : "/admin/payroll";

    $("pTitle").value = pref ? (pref.title || "") : "";
    $("pMonth").value = pref ? (pref.month || "January") : "January";
    $("pYear").value = pref ? (pref.year || new Date().getFullYear()) : new Date().getFullYear();
    $("pPeriodLabel").value = pref ? (pref.periodLabel || "") : "";
    $("pDepartment").value = pref ? (pref.departmentId || "") : "";
    $("pPayDate").value = pref ? (pref.payDate || "") : "";
    $("pNotes").value = pref ? (pref.notes || "") : "";

    openModal("mEdit");
  }

  function openViewModal(a) {
    $("vTitle").textContent = a.title || "—";
    $("vDepartment").textContent = a.departmentName || "All Departments";
    $("vPeriod").textContent = `${a.month || "—"} ${a.year || ""}`;
    $("vPayDate").textContent = a.payDate || "—";
    $("vStaffCount").textContent = a.staffCount || 0;
    $("vStatus").textContent = a.status || "—";
    $("vGross").textContent = money(a.grossAmount || 0);
    $("vDeductions").textContent = money(a.deductionsAmount || 0);
    $("vNet").textContent = money(a.netAmount || 0);
    $("vNotes").textContent = a.notes || "—";
    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () { openEditor(); });
  $("quickNewPayroll").addEventListener("click", function () { openEditor(); });

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) RUNS.forEach((a) => state.selected.add(a.id));
    else RUNS.forEach((a) => state.selected.delete(a.id));
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
    const a = RUNS.find((x) => x.id === tr.dataset.id);
    if (!a) return;

    if (e.target.closest(".actView")) return openViewModal(a);
    if (e.target.closest(".actEdit")) return openEditor(a);
    if (e.target.closest(".actProcess")) return submitRowAction(`/admin/payroll/${a.id}/process`);
    if (e.target.closest(".actApprove")) return submitRowAction(`/admin/payroll/${a.id}/approve`);
    if (e.target.closest(".actClose")) return submitRowAction(`/admin/payroll/${a.id}/close`);
    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete payroll run "${a.title}"?`)) {
        return submitRowAction(`/admin/payroll/${a.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one payroll run.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkProcess").addEventListener("click", function () { bulkSubmit("process"); });
  $("bulkApprove").addEventListener("click", function () { bulkSubmit("approve"); });
  $("bulkClose").addEventListener("click", function () { bulkSubmit("close"); });
  $("bulkDraft").addEventListener("click", function () { bulkSubmit("draft"); });
  $("bulkDelete").addEventListener("click", function () {
    if (!state.selected.size) return;
    if (window.confirm("Delete selected payroll runs?")) bulkSubmit("delete");
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
    alert("Hook payroll export route later.");
  });

  setView("list");
})();
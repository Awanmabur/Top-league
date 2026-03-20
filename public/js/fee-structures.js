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

  const FEE = readJson("feeStructuresData");

  if (!$("tbody")) return;

  const state = {
    view: "list",
    selected: new Set(),
    itemsSourceId: FEE[0]?.id || null,
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

  function pillStatus(a) {
    if (a.status === "Active") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>';
    if (a.status === "Inactive") return '<span class="pill warn"><i class="fa-solid fa-clock"></i> Inactive</span>';
    return '<span class="pill info"><i class="fa-solid fa-box-archive"></i> Archived</span>';
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
      list: ["Fee Structures", "Manage billing templates and their fee line items."],
      items: ["Fee Items", "Review line items under the selected structure."],
      summary: ["Summary", "Billing template summary across the current result set."],
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${FEE.length} structure(s)`;
    $("checkAll").checked = FEE.length > 0 && FEE.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = FEE.map((a) => {
      const checked = state.selected.has(a.id) ? "checked" : "";
      return `
        <tr data-id="${a.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${a.id}" ${checked}></td>
          <td>
            <div class="strong">${a.name || ""}</div>
            <div class="muted">${(a.items || []).length} item(s)</div>
          </td>
          <td>${a.programName || "—"}</td>
          <td>${a.className || "—"}</td>
          <td>${a.intakeName || "—"}</td>
          <td>
            <div class="strong">${a.academicYear || "—"}</div>
            <div class="muted">${a.term || "—"}</div>
          </td>
          <td>${money(a.totalAmount)}</td>
          <td>${pillStatus(a)}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-xs actItems" type="button" title="Items"><i class="fa-solid fa-layer-group"></i></button>
              <button class="btn-xs actActivate" type="button" title="Activate"><i class="fa-solid fa-circle-check"></i></button>
              <button class="btn-xs actArchive" type="button" title="Archive"><i class="fa-solid fa-box-archive"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="9" style="padding:18px;"><div class="muted">No fee structures found.</div></td></tr>';
  }

  function currentItemsSource() {
    return FEE.find((x) => x.id === state.itemsSourceId) || FEE[0] || null;
  }

  function renderItems() {
    const source = currentItemsSource();
    const items = (source && source.items) || [];
    $("resultMeta").textContent = `${items.length} item(s) • ${source?.name || "—"}`;

    $("tbodyItems").innerHTML = items.map((item) => `
      <tr>
        <td><div class="strong">${item.title || ""}</div></td>
        <td><span class="pill info"><i class="fa-solid fa-tag"></i> ${item.category || "Other"}</span></td>
        <td>${money(item.amount || 0)}</td>
        <td>${item.required ? '<span class="pill ok"><i class="fa-solid fa-check"></i> Required</span>' : '<span class="pill warn"><i class="fa-solid fa-minus"></i> Optional</span>'}</td>
        <td class="muted">${item.note || "—"}</td>
      </tr>
    `).join("") || '<tr><td colspan="5" style="padding:18px;"><div class="muted">No items found.</div></td></tr>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "items") renderItems();
    if (state.view === "summary") $("resultMeta").textContent = `${FEE.length} structure(s)`;
  }

  function createItemRow(item) {
    const tr = document.createElement("tr");
    tr.className = "itemRow";
    tr.innerHTML = `
      <td>
        <input class="input item-title" name="itemTitle" placeholder="e.g. Tuition Fee" value="${item?.title || ""}">
      </td>
      <td>
        <select class="select item-category" name="itemCategory">
          <option ${item?.category === "Tuition" ? "selected" : ""}>Tuition</option>
          <option ${item?.category === "Registration" ? "selected" : ""}>Registration</option>
          <option ${item?.category === "Library" ? "selected" : ""}>Library</option>
          <option ${item?.category === "Hostel" ? "selected" : ""}>Hostel</option>
          <option ${item?.category === "Examination" ? "selected" : ""}>Examination</option>
          <option ${item?.category === "Transport" ? "selected" : ""}>Transport</option>
          <option ${item?.category === "Other" ? "selected" : ""}>Other</option>
        </select>
      </td>
      <td>
        <input class="input item-amount calc-input" name="itemAmount" type="number" min="0" step="0.01" value="${item?.amount || 0}">
      </td>
      <td>
        <select class="select item-required" name="itemRequired">
          <option value="true" ${item?.required ? "selected" : ""}>Required</option>
          <option value="false" ${!item?.required ? "selected" : ""}>Optional</option>
        </select>
      </td>
      <td>
        <input class="input" name="itemNote" placeholder="Optional note" value="${item?.note || ""}">
      </td>
      <td>
        <button class="icon-btn removeItemBtn" type="button"><i class="fa-solid fa-trash"></i></button>
      </td>
    `;
    return tr;
  }

  function fillDefaultItemRows(items) {
    const tbody = $("itemsTbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    const rows = Array.isArray(items) && items.length
      ? items
      : [{ title: "", category: "Tuition", amount: 0, required: true, note: "" }];
    rows.forEach((item) => tbody.appendChild(createItemRow(item)));
    syncTotals();
  }

  function syncTotals() {
    const rows = Array.from(document.querySelectorAll("#itemsTbody .itemRow"));
    let total = 0;
    let requiredCount = 0;

    rows.forEach((row) => {
      total += Number(row.querySelector(".item-amount")?.value || 0);
      if ((row.querySelector(".item-required")?.value || "") === "true") requiredCount += 1;
    });

    $("itemsCountPreview").textContent = rows.length;
    $("requiredCountPreview").textContent = requiredCount;
    $("totalPreview").textContent = money(total);
  }

  function openEditor(pref) {
    pref = pref || null;

    $("mTitle").textContent = pref ? "Edit Fee Structure" : "Create Fee Structure";
    const form = $("feeStructureForm");
    form.action = pref ? `/admin/fee-structures/${pref.id}/update` : "/admin/fee-structures";

    $("fName").value = pref ? (pref.name || "") : "";
    $("fProgram").value = pref ? (pref.programId || "") : "";
    $("fClass").value = pref ? (pref.classId || "") : "";
    $("fIntake").value = pref ? (pref.intakeId || "") : "";
    $("fAcademicYear").value = pref ? (pref.academicYear || "") : "";
    $("fTerm").value = pref ? (pref.term || "") : "";
    $("fStatus").value = pref ? (pref.status || "Active") : "Active";
    $("fNotes").value = pref ? (pref.notes || "") : "";

    fillDefaultItemRows(pref ? pref.items : null);
    openModal("mEdit");
  }

  function openViewModal(a) {
    if (!a) return;

    $("vName").textContent = a.name || "—";
    $("vProgram").textContent = a.programName || "—";
    $("vClass").textContent = a.className || "—";
    $("vIntake").textContent = a.intakeName || "—";
    $("vAcademicYear").textContent = a.academicYear || "—";
    $("vTerm").textContent = a.term || "—";
    $("vStatus").textContent = a.status || "—";
    $("vTotal").textContent = money(a.totalAmount || 0);
    $("vNotes").textContent = a.notes || "—";

    $("tbodyModalItems").innerHTML = (a.items || []).map((item) => `
      <tr>
        <td>${item.title || "—"}</td>
        <td>${item.category || "Other"}</td>
        <td>${money(item.amount || 0)}</td>
        <td>${item.required ? "Required" : "Optional"}</td>
        <td>${item.note || "—"}</td>
      </tr>
    `).join("") || '<tr><td colspan="5" style="padding:18px;"><div class="muted">No items found.</div></td></tr>';

    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickNewStructure").addEventListener("click", function () {
    openEditor();
  });

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) FEE.forEach((a) => state.selected.add(a.id));
    else FEE.forEach((a) => state.selected.delete(a.id));
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

    const a = FEE.find((x) => x.id === tr.dataset.id);
    if (!a) return;

    if (e.target.closest(".actView")) return openViewModal(a);
    if (e.target.closest(".actEdit")) return openEditor(a);

    if (e.target.closest(".actItems")) {
      state.itemsSourceId = a.id;
      return setView("items");
    }

    if (e.target.closest(".actActivate")) return submitRowAction(`/admin/fee-structures/${a.id}/activate`);
    if (e.target.closest(".actArchive")) return submitRowAction(`/admin/fee-structures/${a.id}/archive`);

    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete fee structure "${a.name}"?`)) {
        return submitRowAction(`/admin/fee-structures/${a.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one fee structure.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkActivate").addEventListener("click", function () { bulkSubmit("activate"); });
  $("bulkInactive").addEventListener("click", function () { bulkSubmit("inactive"); });
  $("bulkArchive").addEventListener("click", function () { bulkSubmit("archive"); });
  $("bulkDelete").addEventListener("click", function () {
    if (!state.selected.size) return;
    if (window.confirm("Delete selected fee structures?")) bulkSubmit("delete");
  });

  $("addItemBtn").addEventListener("click", function () {
    $("itemsTbody").appendChild(createItemRow({ required: true }));
    syncTotals();
  });

  $("itemsTbody").addEventListener("input", function (e) {
    if (e.target.closest(".itemRow")) syncTotals();
  });

  $("itemsTbody").addEventListener("change", function (e) {
    if (e.target.closest(".itemRow")) syncTotals();
  });

  $("itemsTbody").addEventListener("click", function (e) {
    const btn = e.target.closest(".removeItemBtn");
    if (!btn) return;
    const rows = document.querySelectorAll("#itemsTbody .itemRow");
    if (rows.length <= 1) {
      alert("At least one item is required.");
      return;
    }
    btn.closest(".itemRow")?.remove();
    syncTotals();
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
    alert("Hook fee structures export route later.");
  });

  fillDefaultItemRows(null);
  setView("list");
  render();
})();
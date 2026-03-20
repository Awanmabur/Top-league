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

  const SCH = readJson("scholarshipsData");

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

  function pillStatus(a) {
    if (a.status === "Active") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>';
    if (a.status === "Inactive") return '<span class="pill warn"><i class="fa-solid fa-clock"></i> Inactive</span>';
    if (a.status === "Expired") return '<span class="pill info"><i class="fa-solid fa-calendar-xmark"></i> Expired</span>';
    return '<span class="pill bad"><i class="fa-solid fa-ban"></i> Revoked</span>';
  }

  function valueLabel(s) {
    if (s.type === "Percentage") return `${Number(s.value || 0)}%`;
    if (s.type === "Full") return "100%";
    return money(s.amount || 0);
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
    $("view-awards").style.display = v === "awards" ? "" : "none";
    $("view-summary").style.display = v === "summary" ? "" : "none";

    const titles = {
      list: ["Scholarships", "Manage scholarship records, scope, value and lifecycle status."],
      awards: ["Awards", "Review scholarship targets, sponsors and award values."],
      summary: ["Summary", "Scholarship summary across the current result set."],
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${SCH.length} scholarship(s)`;

    $("checkAll").checked = SCH.length > 0 && SCH.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML =
      SCH.map((a) => {
        const checked = state.selected.has(a.id) ? "checked" : "";
        return `
          <tr data-id="${a.id}">
            <td><input type="checkbox" class="rowCheck" data-id="${a.id}" ${checked}></td>
            <td>
              <div class="strong">${a.name || ""}</div>
              <div class="muted">${a.code || "No code"}</div>
            </td>
            <td>${a.studentName || "—"}</td>
            <td>${a.programName || "—"}</td>
            <td><span class="pill info"><i class="fa-solid fa-shapes"></i> ${a.type || "Fixed Amount"}</span></td>
            <td><div class="strong">${valueLabel(a)}</div></td>
            <td>
              <div class="strong">${a.startDate || "—"}</div>
              <div class="muted">End: ${a.endDate || "—"}</div>
            </td>
            <td>${pillStatus(a)}</td>
            <td>
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actActivate" type="button" title="Activate"><i class="fa-solid fa-circle-check"></i></button>
                <button class="btn-xs actExpire" type="button" title="Expire"><i class="fa-solid fa-calendar-xmark"></i></button>
                <button class="btn-xs actRevoke" type="button" title="Revoke"><i class="fa-solid fa-ban"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      '<tr><td colspan="9" style="padding:18px;"><div class="muted">No scholarships found.</div></td></tr>';
  }

  function renderAwards() {
    $("resultMeta").textContent = `${SCH.length} scholarship(s)`;
    $("tbodyAwards").innerHTML =
      SCH.map((a) => `
        <tr>
          <td><div class="strong">${a.name || ""}</div></td>
          <td>${a.code || "—"}</td>
          <td>${a.sponsor || "—"}</td>
          <td>${a.studentName || "—"}</td>
          <td>${a.programName || "—"}</td>
          <td><span class="pill info"><i class="fa-solid fa-shapes"></i> ${a.type || "Fixed Amount"}</span></td>
          <td><div class="strong">${valueLabel(a)}</div></td>
          <td>${pillStatus(a)}</td>
        </tr>
      `).join("") ||
      '<tr><td colspan="8" style="padding:18px;"><div class="muted">No award data found.</div></td></tr>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "awards") renderAwards();
    if (state.view === "summary") $("resultMeta").textContent = `${SCH.length} scholarship(s)`;
  }

  function syncTypeFields() {
    const type = $("sType").value;

    $("typePreview").textContent = type;

    if (type === "Percentage") {
      $("valueField").style.display = "";
      $("amountField").style.display = "none";
      $("valuePreview").textContent = `${Number($("sValue").value || 0)}%`;
      return;
    }

    if (type === "Fixed Amount") {
      $("valueField").style.display = "none";
      $("amountField").style.display = "";
      $("valuePreview").textContent = money($("sAmount").value || 0);
      return;
    }

    $("valueField").style.display = "none";
    $("amountField").style.display = "none";
    $("valuePreview").textContent = "100%";
  }

  function openEditor(pref) {
    pref = pref || null;

    $("mTitle").textContent = pref ? "Edit Scholarship" : "Create Scholarship";
    const form = $("scholarshipForm");
    form.action = pref ? `/admin/scholarships/${pref.id}/update` : "/admin/scholarships";

    $("sName").value = pref ? (pref.name || "") : "";
    $("sCode").value = pref ? (pref.code || "") : "";
    $("sStudent").value = pref ? (pref.studentId || "") : "";
    $("sProgram").value = pref ? (pref.programId || "") : "";
    $("sType").value = pref ? (pref.type || "Fixed Amount") : "Fixed Amount";
    $("sValue").value = pref ? Number(pref.value || 0) : 0;
    $("sAmount").value = pref ? Number(pref.amount || 0) : 0;
    $("sSponsor").value = pref ? (pref.sponsor || "") : "";
    $("sStartDate").value = pref ? (pref.startDate || "") : "";
    $("sEndDate").value = pref ? (pref.endDate || "") : "";
    $("sStatus").value = pref ? (pref.status || "Active") : "Active";
    $("sNotes").value = pref ? (pref.notes || "") : "";

    syncTypeFields();
    openModal("mEdit");
  }

  function openViewModal(a) {
    if (!a) return;

    $("vName").textContent = a.name || "—";
    $("vCode").textContent = a.code || "—";
    $("vStudent").textContent = a.studentName || "—";
    $("vProgram").textContent = a.programName || "—";
    $("vType").textContent = a.type || "—";
    $("vValue").textContent = valueLabel(a);
    $("vSponsor").textContent = a.sponsor || "—";
    $("vStatus").textContent = a.status || "—";
    $("vStartDate").textContent = a.startDate || "—";
    $("vEndDate").textContent = a.endDate || "—";
    $("vNotes").textContent = a.notes || "—";

    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickNewScholarship").addEventListener("click", function () {
    openEditor();
  });

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) SCH.forEach((a) => state.selected.add(a.id));
    else SCH.forEach((a) => state.selected.delete(a.id));
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

    const a = SCH.find((x) => x.id === tr.dataset.id);
    if (!a) return;

    if (e.target.closest(".actView")) return openViewModal(a);
    if (e.target.closest(".actEdit")) return openEditor(a);
    if (e.target.closest(".actActivate")) return submitRowAction(`/admin/scholarships/${a.id}/activate`);
    if (e.target.closest(".actExpire")) return submitRowAction(`/admin/scholarships/${a.id}/expire`);
    if (e.target.closest(".actRevoke")) return submitRowAction(`/admin/scholarships/${a.id}/revoke`);

    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete scholarship "${a.name}"?`)) {
        return submitRowAction(`/admin/scholarships/${a.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one scholarship.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkActivate").addEventListener("click", function () { bulkSubmit("activate"); });
  $("bulkInactive").addEventListener("click", function () { bulkSubmit("inactive"); });
  $("bulkExpire").addEventListener("click", function () { bulkSubmit("expire"); });
  $("bulkRevoke").addEventListener("click", function () { bulkSubmit("revoke"); });
  $("bulkDelete").addEventListener("click", function () {
    if (!state.selected.size) return;
    if (window.confirm("Delete selected scholarships?")) bulkSubmit("delete");
  });

  $("sType").addEventListener("change", syncTypeFields);
  $("sValue").addEventListener("input", syncTypeFields);
  $("sAmount").addEventListener("input", syncTypeFields);

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
    alert("Hook scholarships export route later.");
  });

  syncTypeFields();
  setView("list");
  render();
})();
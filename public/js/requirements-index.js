(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function readJsonTextArea(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.value || "null") ?? fallback;
    } catch (err) {
      console.error(`Failed to parse ${id}:`, err);
      return fallback;
    }
  }

  const REQUIREMENTS = readJsonTextArea("requirementsData", []);
  const LOOKUPS = readJsonTextArea("lookupData", { programs: [], intakes: [] });

  if (!$("tbodyRequirements")) return;

  const programMap = new Map((LOOKUPS.programs || []).map((x) => [String(x.id), x.name || "Program"]));
  const intakeMap = new Map((LOOKUPS.intakes || []).map((x) => [String(x.id), x.name || "Intake"]));

  const state = {
    selected: new Set(),
    currentViewId: null
  };

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeCode(v) {
    return String(v || "")
      .trim()
      .toUpperCase()
      .replace(/&/g, "AND")
      .replace(/\s+/g, "-")
      .replace(/[^A-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "")
      .slice(0, 80);
  }

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

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function submitRowAction(actionUrl) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    form.submit();
  }

  function statusPill(active) {
    return active
      ? '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>'
      : '<span class="pill bad"><i class="fa-solid fa-circle-xmark"></i> Inactive</span>';
  }

  function mandatoryPill(mandatory) {
    return mandatory
      ? '<span class="pill info"><i class="fa-solid fa-asterisk"></i> Yes</span>'
      : '<span class="pill warn"><i class="fa-solid fa-minus"></i> No</span>';
  }

  function categoryPill(category) {
    const map = {
      document: ["info", "fa-file-lines", "Document"],
      fee: ["warn", "fa-money-bill-wave", "Fee"],
      exam: ["info", "fa-pen-ruler", "Exam"],
      medical: ["ok", "fa-kit-medical", "Medical"],
      other: ["bad", "fa-circle-question", "Other"]
    };
    const cfg = map[category] || map.other;
    return `<span class="pill ${cfg[0]}"><i class="fa-solid ${cfg[1]}"></i> ${cfg[2]}</span>`;
  }

  function namesFromIds(ids, lookupMap) {
    return (Array.isArray(ids) ? ids : []).map((id) => lookupMap.get(String(id)) || String(id));
  }

  function summaryLabel(ids, allFlag, singular) {
    if (allFlag) return "All";
    const count = Array.isArray(ids) ? ids.length : 0;
    if (!count) return "None";
    return `${count} selected`;
  }

  function renderTable() {
    $("tbodyRequirements").innerHTML =
      REQUIREMENTS.map((r) => {
        const checked = state.selected.has(r.id) ? "checked" : "";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(r.id)}">
            <td class="col-check"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(r.id)}" ${checked}></td>
            <td class="col-title">
              <div class="req-main">
                <div class="req-title" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</div>
                <div class="req-sub" title="${escapeHtml(r.code || "—")}">${escapeHtml(r.code || "—")} • ${escapeHtml(r.description || "No description")}</div>
              </div>
            </td>
            <td class="col-category">${categoryPill(r.category)}</td>
            <td class="col-programs"><span class="cell-ellipsis">${escapeHtml(summaryLabel(r.programs, r.appliesToAllPrograms, "program"))}</span></td>
            <td class="col-intakes"><span class="cell-ellipsis">${escapeHtml(summaryLabel(r.intakes, r.appliesToAllIntakes, "intake"))}</span></td>
            <td class="col-mandatory">${mandatoryPill(r.isMandatory)}</td>
            <td class="col-active">${statusPill(r.isActive)}</td>
            <td class="col-sort"><span class="cell-ellipsis">${escapeHtml(String(r.sortOrder || 0))}</span></td>
            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actToggle" type="button" title="Toggle Status"><i class="fa-solid fa-power-off"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
        <tr>
          <td colspan="9" style="padding:18px;"><div class="muted">No requirements found.</div></td>
        </tr>
      `;

    $("checkAll").checked = REQUIREMENTS.length > 0 && REQUIREMENTS.every((r) => state.selected.has(r.id));
    syncBulkbar();
  }

  function fillSelect(select, rows) {
    if (!select) return;
    select.innerHTML = rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join("");
  }

  function setMultiSelect(select, values) {
    if (!select) return;
    const set = new Set((values || []).map(String));
    Array.from(select.options).forEach((opt) => {
      opt.selected = set.has(String(opt.value));
    });
  }

  function getSelectedValues(select) {
    if (!select) return [];
    return Array.from(select.selectedOptions || []).map((opt) => String(opt.value)).filter(Boolean);
  }

  function fillHiddenList(hostId, name, values) {
    const host = $(hostId);
    if (!host) return;
    host.innerHTML = "";
    values.forEach((value) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      host.appendChild(input);
    });
  }

  function updateDescriptionCounter() {
    const el = $("mDescription");
    const out = $("descCount");
    if (!el || !out) return;
    out.textContent = `${el.value.length} / 1200`;
  }

  function syncScopeUI() {
    const allPrograms = $("mAllPrograms").checked;
    const allIntakes = $("mAllIntakes").checked;
    $("mPrograms").disabled = allPrograms;
    $("mIntakes").disabled = allIntakes;
  }

  function openEditor(prefill) {
    const r = prefill || null;

    $("mTitle").textContent = r ? "Edit Requirement" : "Add Requirement";
    $("requirementForm").action = r ? `/admin/admissions/requirements/${encodeURIComponent(r.id)}/update` : "/admin/admissions/requirements";

    $("mReqTitleInput").value = r ? r.title || "" : "";
    $("mCode").value = r ? r.code || "" : "";
    $("mCategory").value = r ? r.category || "document" : "document";
    $("mSortOrder").value = r ? String(r.sortOrder || 0) : "0";
    $("mStatus").value = r ? String(!!r.isActive) : "true";
    $("mMandatory").value = r ? String(!!r.isMandatory) : "true";
    $("mDescription").value = r ? r.description || "" : "";
    $("mAllPrograms").checked = r ? !!r.appliesToAllPrograms : true;
    $("mAllIntakes").checked = r ? !!r.appliesToAllIntakes : true;

    fillSelect($("mPrograms"), LOOKUPS.programs || []);
    fillSelect($("mIntakes"), LOOKUPS.intakes || []);
    setMultiSelect($("mPrograms"), r ? r.programs || [] : []);
    setMultiSelect($("mIntakes"), r ? r.intakes || [] : []);

    $("mProgramsWrap").innerHTML = "";
    $("mIntakesWrap").innerHTML = "";

    syncScopeUI();
    updateDescriptionCounter();
    openModal("mEdit");
  }

  function openViewModal(r) {
    if (!r) return;
    state.currentViewId = r.id;

    $("vTitle").textContent = r.title || "—";
    $("vCode").textContent = r.code || "—";
    $("vCategory").innerHTML = categoryPill(r.category || "document");
    $("vStatus").innerHTML = statusPill(!!r.isActive);
    $("vMandatory").innerHTML = mandatoryPill(!!r.isMandatory);
    $("vSort").textContent = String(r.sortOrder || 0);
    $("vDescription").textContent = r.description || "—";

    const programHost = $("vPrograms");
    const intakeHost = $("vIntakes");
    programHost.innerHTML = "";
    intakeHost.innerHTML = "";

    if (r.appliesToAllPrograms) {
      programHost.innerHTML = '<span class="tag"><i class="fa-solid fa-globe"></i> All Programs</span>';
    } else {
      const names = namesFromIds(r.programs, programMap);
      if (!names.length) programHost.innerHTML = '<span class="muted">No programs selected</span>';
      else names.forEach((name) => {
        const span = document.createElement("span");
        span.className = "tag";
        span.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${escapeHtml(name)}`;
        programHost.appendChild(span);
      });
    }

    if (r.appliesToAllIntakes) {
      intakeHost.innerHTML = '<span class="tag"><i class="fa-solid fa-calendar-days"></i> All Intakes</span>';
    } else {
      const names = namesFromIds(r.intakes, intakeMap);
      if (!names.length) intakeHost.innerHTML = '<span class="muted">No intakes selected</span>';
      else names.forEach((name) => {
        const span = document.createElement("span");
        span.className = "tag";
        span.innerHTML = `<i class="fa-solid fa-calendar"></i> ${escapeHtml(name)}`;
        intakeHost.appendChild(span);
      });
    }

    openModal("mView");
  }

  function saveRequirement() {
    const title = $("mReqTitleInput").value.trim();
    const code = normalizeCode($("mCode").value);

    if (!title) return alert("Title is required.");
    if (!code) return alert("Code is required.");

    $("mCode").value = code;

    const allPrograms = $("mAllPrograms").checked;
    const allIntakes = $("mAllIntakes").checked;
    const programs = allPrograms ? [] : getSelectedValues($("mPrograms"));
    const intakes = allIntakes ? [] : getSelectedValues($("mIntakes"));

    fillHiddenList("mProgramsWrap", "programs", programs);
    fillHiddenList("mIntakesWrap", "intakes", intakes);

    if (!allPrograms && !programs.length) return alert("Select at least one program or enable all programs.");
    if (!allIntakes && !intakes.length) return alert("Select at least one intake or enable all intakes.");

    $("requirementForm").submit();
  }

  function downloadCsv(filename, rows) {
    const esc = (value) => {
      const s = String(value ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const csv = rows.map((row) => row.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportRequirements() {
    const rows = [
      ["Title", "Code", "Category", "Description", "SortOrder", "Mandatory", "Active", "AppliesToAllPrograms", "Programs", "AppliesToAllIntakes", "Intakes"],
      ...REQUIREMENTS.map((r) => [
        r.title || "",
        r.code || "",
        r.category || "",
        r.description || "",
        r.sortOrder || 0,
        r.isMandatory ? "true" : "false",
        r.isActive ? "true" : "false",
        r.appliesToAllPrograms ? "true" : "false",
        namesFromIds(r.programs, programMap).join(" | "),
        r.appliesToAllIntakes ? "true" : "false",
        namesFromIds(r.intakes, intakeMap).join(" | ")
      ])
    ];

    downloadCsv("requirements-export.csv", rows);
  }

  function runBulkAction(action) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one requirement.");

    const messages = {
      activate: `Activate ${ids.length} selected requirement(s)?`,
      deactivate: `Deactivate ${ids.length} selected requirement(s)?`,
      delete: `Delete ${ids.length} selected requirement(s)?`
    };

    if (!window.confirm(messages[action] || "Proceed?")) return;
    $("bulkIds").value = ids.join(",");
    $("bulkAction").value = action;
    $("bulkForm").submit();
  }

  $("btnCreate").addEventListener("click", function () { openEditor(); });
  $("quickDocument").addEventListener("click", function () { openEditor(); $("mCategory").value = "document"; });
  $("quickFee").addEventListener("click", function () { openEditor(); $("mCategory").value = "fee"; });
  $("quickExam").addEventListener("click", function () { openEditor(); $("mCategory").value = "exam"; });

  $("btnImport").addEventListener("click", function () { openModal("mImport"); });
  $("btnExport").addEventListener("click", exportRequirements);
  $("btnPrint").addEventListener("click", function () { window.print(); });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one requirement.");
    $("bulkbar").classList.add("show");
  });

  $("bulkActivate").addEventListener("click", function () { runBulkAction("activate"); });
  $("bulkDeactivate").addEventListener("click", function () { runBulkAction("deactivate"); });
  $("bulkDelete").addEventListener("click", function () { runBulkAction("delete"); });
  $("bulkClear").addEventListener("click", function () { state.selected.clear(); renderTable(); });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) REQUIREMENTS.forEach((r) => state.selected.add(r.id));
    else REQUIREMENTS.forEach((r) => state.selected.delete(r.id));
    renderTable();
  });

  $("tbodyRequirements").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyRequirements").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const r = REQUIREMENTS.find((x) => x.id === tr.dataset.id);
    if (!r) return;

    if (e.target.closest(".rowCheck") || e.target.closest(".actions") || e.target.closest(".btn-xs")) {
      if (e.target.closest(".actView")) return openViewModal(r);
      if (e.target.closest(".actEdit")) return openEditor(r);

      if (e.target.closest(".actToggle")) {
        const action = r.isActive ? "deactivate" : "activate";
        if (!window.confirm(`${r.isActive ? "Deactivate" : "Activate"} "${r.title}"?`)) return;
        $("bulkIds").value = r.id;
        $("bulkAction").value = action;
        return $("bulkForm").submit();
      }

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${r.title}" permanently?`)) return;
        return submitRowAction(`/admin/admissions/requirements/${encodeURIComponent(r.id)}/delete`);
      }

      return;
    }

    openViewModal(r);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const r = REQUIREMENTS.find((x) => x.id === state.currentViewId);
    if (!r) return;
    closeModal("mView");
    openEditor(r);
  });

  $("saveBtn").addEventListener("click", saveRequirement);
  $("mDescription").addEventListener("input", updateDescriptionCounter);
  $("mCode").addEventListener("blur", function () { this.value = normalizeCode(this.value); });
  $("mAllPrograms").addEventListener("change", syncScopeUI);
  $("mAllIntakes").addEventListener("change", syncScopeUI);

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mEdit", "mView", "mImport"].forEach(function (mid) {
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
      document.body.style.overflow = "";
    }
  });

  fillSelect($("mPrograms"), LOOKUPS.programs || []);
  fillSelect($("mIntakes"), LOOKUPS.intakes || []);
  syncScopeUI();
  updateDescriptionCounter();
  renderTable();
})();
(function () {
  const $ = (id) => document.getElementById(id);

  function readProgramsData() {
    const el = $("programsData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse programs data:", err);
      return [];
    }
  }

  const PROGRAMS = readProgramsData();
  if (!$("tbodyPrograms")) return;

  const state = {
    selected: new Set(),
    currentViewId: null,
  };

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function splitComma(text) {
    return String(text || "")
      .split(",")
      .map((x) => x.trim().replace(/\s+/g, " "))
      .filter(Boolean);
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

  function submitRowAction(actionUrl) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    form.submit();
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString();
  }

  function statusPill(status) {
    if (status === "active") {
      return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>';
    }
    if (status === "archived") {
      return '<span class="pill bad"><i class="fa-solid fa-box-archive"></i> Archived</span>';
    }
    return '<span class="pill warn"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
  }

  function renderTable() {
    $("tbodyPrograms").innerHTML =
      PROGRAMS.map((p) => {
        const checked = state.selected.has(p.id) ? "checked" : "";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(p.id)}">
            <td class="col-check">
              <input type="checkbox" class="rowCheck" data-id="${escapeHtml(p.id)}" ${checked}>
            </td>

            <td class="col-program">
              <div class="program-main">
                <div class="program-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
                <div class="program-sub" title="${escapeHtml(p.code || "—")}">${escapeHtml(p.code || "—")}</div>
              </div>
            </td>

            <td class="col-department">
              <span class="cell-ellipsis" title="${escapeHtml(p.departmentName || "—")}">
                ${escapeHtml(p.departmentName || "—")}
              </span>
            </td>

            <td class="col-faculty">
              <span class="cell-ellipsis" title="${escapeHtml(p.faculty || "—")}">
                ${escapeHtml(p.faculty || "—")}
              </span>
            </td>

            <td class="col-level">
              <span class="cell-ellipsis" title="${escapeHtml(p.level || "—")}">
                ${escapeHtml(p.level || "—")}
              </span>
            </td>

            <td class="col-duration">
              <span class="cell-ellipsis">${escapeHtml(String(p.durationYears || 0))} yrs</span>
            </td>

            <td class="col-seats">
              <span class="cell-ellipsis">${escapeHtml(String(p.seats || 0))}</span>
            </td>

            <td class="col-fee">
              <span class="cell-ellipsis" title="${escapeHtml(formatMoney(p.fee || 0))}">
                ${escapeHtml(formatMoney(p.fee || 0))}
              </span>
            </td>

            <td class="col-status">
              ${statusPill(p.status)}
            </td>

            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actArchive" type="button" title="Archive"><i class="fa-solid fa-box-archive"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
      <tr>
        <td colspan="10" style="padding:18px;">
          <div class="muted">No programs found.</div>
        </td>
      </tr>
      `;

    $("checkAll").checked = PROGRAMS.length > 0 && PROGRAMS.every((p) => state.selected.has(p.id));
    syncBulkbar();
  }

  function fillHiddenList(values) {
    const wrap = $("mModulesWrap");
    wrap.innerHTML = "";

    values.forEach((v) => {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = "modules[]";
      inp.value = v;
      wrap.appendChild(inp);
    });
  }

  function updateCounters() {
    $("shortCount").textContent = `${$("mShort").value.length} / 500`;
    $("reqsCount").textContent = `${$("mReqs").value.length} / 1200`;
  }

  function openEditor(prefill) {
    const p = prefill || null;

    $("mTitle").textContent = p ? "Edit Program" : "Add Program";
    $("programForm").action = p ? `/admin/programs/${encodeURIComponent(p.id)}` : "/admin/programs";

    $("mName").value = p ? p.name || "" : "";
    $("mCode").value = p ? p.code || "" : "";
    $("mDepartment").value = p ? p.departmentId || "" : "";
    $("mFaculty").value = p ? p.faculty || "" : "";
    $("mLevel").value = p ? p.level || "" : "";
    $("mDurationYears").value = p ? String(p.durationYears || "") : "";
    $("mSeats").value = p ? String(p.seats || "") : "";
    $("mFee").value = p ? String(p.fee || "") : "";
    $("mStatus").value = p ? p.status || "draft" : "draft";
    $("mShort").value = p ? p.short || "" : "";
    $("mReqs").value = p ? p.reqs || "" : "";
    $("mModules").value = p ? (Array.isArray(p.modules) ? p.modules.join(", ") : "") : "";
    $("mModulesWrap").innerHTML = "";

    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(p) {
    if (!p) return;

    state.currentViewId = p.id;

    $("vName").textContent = p.name || "—";
    $("vCode").textContent = p.code || "—";
    $("vDepartment").textContent = p.departmentName || "—";
    $("vFaculty").textContent = p.faculty || "—";
    $("vLevel").textContent = p.level || "—";
    $("vDuration").textContent = `${Number(p.durationYears || 0)} year(s)`;
    $("vSeats").textContent = String(p.seats || 0);
    $("vFee").textContent = formatMoney(p.fee || 0);
    $("vStatus").innerHTML = statusPill(p.status || "draft");
    $("vShort").textContent = p.short || "—";
    $("vReqs").textContent = p.reqs || "—";

    const host = $("vModules");
    host.innerHTML = "";
    const mods = Array.isArray(p.modules) ? p.modules : [];

    if (!mods.length) {
      host.innerHTML = '<span class="muted">No modules</span>';
    } else {
      mods.forEach((m) => {
        const span = document.createElement("span");
        span.className = "tag";
        span.innerHTML = `<i class="fa-solid fa-book"></i> ${escapeHtml(m)}`;
        host.appendChild(span);
      });
    }

    openModal("mView");
  }

  function saveProgram() {
    const name = $("mName").value.trim();
    const department = $("mDepartment").value.trim();
    const faculty = $("mFaculty").value.trim();
    const level = $("mLevel").value.trim();

    if (!name) return alert("Program name is required.");
    if (!department) return alert("Department is required.");
    if (!faculty) return alert("Faculty is required.");
    if (!level) return alert("Level is required.");

    const modules = splitComma($("mModules").value).slice(0, 80);
    fillHiddenList(modules);
    $("programForm").submit();
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

  function exportPrograms() {
    const rows = [
      ["Name", "Code", "Department", "Faculty", "Level", "DurationYears", "Seats", "Fee", "Status", "Short", "Requirements", "Modules"],
      ...PROGRAMS.map((p) => [
        p.name || "",
        p.code || "",
        p.departmentName || "",
        p.faculty || "",
        p.level || "",
        p.durationYears || 0,
        p.seats || 0,
        p.fee || 0,
        p.status || "",
        p.short || "",
        p.reqs || "",
        (p.modules || []).join(" | "),
      ]),
    ];

    downloadCsv("programs-export.csv", rows);
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickBachelor").addEventListener("click", function () {
    openEditor();
    $("mLevel").value = "Bachelor";
  });

  $("quickDiploma").addEventListener("click", function () {
    openEditor();
    $("mLevel").value = "Diploma";
  });

  $("quickMaster").addEventListener("click", function () {
    openEditor();
    $("mLevel").value = "Master";
  });

  $("btnExport").addEventListener("click", exportPrograms);
  $("btnPrint").addEventListener("click", function () {
    window.print();
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one program.");
    $("bulkbar").classList.add("show");
  });

  $("bulkArchive").addEventListener("click", function () {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one program.");
    if (!window.confirm(`Archive ${ids.length} selected program(s)?`)) return;
    $("bulkIds").value = ids.join(",");
    $("bulkForm").submit();
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    renderTable();
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) PROGRAMS.forEach((p) => state.selected.add(p.id));
    else PROGRAMS.forEach((p) => state.selected.delete(p.id));
    renderTable();
  });

  $("tbodyPrograms").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyPrograms").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const p = PROGRAMS.find((x) => x.id === tr.dataset.id);
    if (!p) return;

    if (
      e.target.closest(".rowCheck") ||
      e.target.closest(".actions") ||
      e.target.closest(".btn-xs")
    ) {
      if (e.target.closest(".actView")) return openViewModal(p);
      if (e.target.closest(".actEdit")) return openEditor(p);

      if (e.target.closest(".actArchive")) {
        if (!window.confirm(`Archive "${p.name}"?`)) return;
        return submitRowAction(`/admin/programs/${encodeURIComponent(p.id)}/archive`);
      }

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${p.name}" permanently?`)) return;
        return submitRowAction(`/admin/programs/${encodeURIComponent(p.id)}/delete`);
      }

      return;
    }

    openViewModal(p);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const p = PROGRAMS.find((x) => x.id === state.currentViewId);
    if (!p) return;
    closeModal("mView");
    openEditor(p);
  });

  $("saveBtn").addEventListener("click", saveProgram);
  $("mShort").addEventListener("input", updateCounters);
  $("mReqs").addEventListener("input", updateCounters);

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
      document.body.style.overflow = "";
    }
  });

  renderTable();
  updateCounters();
})();
(function () {
  const $ = (id) => document.getElementById(id);

  function parseJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.value || JSON.stringify(fallback));
    } catch (err) {
      console.error(`Failed to parse ${id}:`, err);
      return fallback;
    }
  }

  const BACKUPS = parseJson("backupsData", []);
  const STORAGE = parseJson("storageData", []);
  const RESTORES = parseJson("restoreData", []);

  if (!$("tbody")) return;

  const state = {
    view: "list",
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

  function pillStatus(item) {
    if (item.status === "Completed") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Completed</span>';
    if (item.status === "Running") return '<span class="pill info"><i class="fa-solid fa-spinner"></i> Running</span>';
    if (item.status === "Scheduled") return '<span class="pill info"><i class="fa-solid fa-clock"></i> Scheduled</span>';
    if (item.status === "Archived") return '<span class="pill warn"><i class="fa-solid fa-box-archive"></i> Archived</span>';
    return '<span class="pill bad"><i class="fa-solid fa-circle-exclamation"></i> Failed</span>';
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
    $("view-storage").style.display = v === "storage" ? "" : "none";
    $("view-restore").style.display = v === "restore" ? "" : "none";

    const titles = {
      list: ["Backup Jobs", "Manage backup runs, schedule, storage target and restore points."],
      storage: ["Storage", "Review backup distribution and usage across storage targets."],
      restore: ["Restore History", "Inspect restore requests, outcomes and notes."]
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];
    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${BACKUPS.length} backup(s)`;
    $("checkAll").checked = BACKUPS.length > 0 && BACKUPS.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = BACKUPS.map((item) => {
      const checked = state.selected.has(item.id) ? "checked" : "";
      return `
        <tr data-id="${item.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${item.id}" ${checked}></td>
          <td>
            <div class="strong">${item.name || ""}</div>
            <div class="muted">${item.notes || "—"}</div>
          </td>
          <td><span class="pill info"><i class="fa-solid fa-tag"></i> ${item.type || "Manual"}</span></td>
          <td>${item.scope || "Full System"}</td>
          <td>${item.storage || "Local"}</td>
          <td>${item.size || "—"}</td>
          <td>${pillStatus(item)}</td>
          <td class="muted">${item.createdAt || "—"}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actRun" type="button" title="Run"><i class="fa-solid fa-play"></i></button>
              <button class="btn-xs actArchive" type="button" title="Archive"><i class="fa-solid fa-box-archive"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="9" style="padding:18px;"><div class="muted">No backups found.</div></td></tr>';
  }

  function renderStorage() {
    $("resultMeta").textContent = `${STORAGE.length} storage target(s)`;
    $("tbodyEng").innerHTML = STORAGE.map((item) => `
      <tr>
        <td><div class="strong">${item.storage || "—"}</div></td>
        <td><span class="pill info"><i class="fa-solid fa-database"></i> ${item.count || 0}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-hard-drive"></i> ${item.totalSize || "0 GB"}</span></td>
        <td><span class="pill ok"><i class="fa-solid fa-circle-check"></i> ${item.completed || 0}</span></td>
        <td><span class="pill bad"><i class="fa-solid fa-circle-exclamation"></i> ${item.failed || 0}</span></td>
        <td class="muted">${item.latest || "—"}</td>
      </tr>
    `).join("") || '<tr><td colspan="6" style="padding:18px;"><div class="muted">No storage summary found.</div></td></tr>';
  }

  function renderRestore() {
    const q = ($("rSearch").value || "").trim().toLowerCase();
    const f = $("rFilter").value;

    const list = RESTORES.filter((item) => {
      const text = `${item.backupName || ""} ${item.actor || ""} ${item.note || ""}`.toLowerCase();
      const mq = !q || text.includes(q);
      const mf = f === "all" || item.status === f;
      return mq && mf;
    });

    $("resultMeta").textContent = `${list.length} restore record(s)`;
    $("timelineList").innerHTML = list.map((item) => `
      <div class="timeline-item">
        <div class="timeline-head">
          <div class="strong">${item.backupName || "—"}</div>
          <div class="muted">${item.createdAt || "—"}</div>
        </div>
        <div class="timeline-body">
          <div><strong>Actor:</strong> ${item.actor || "—"}</div>
          <div><strong>Status:</strong> ${item.status || "Pending"}</div>
          <div><strong>Scope:</strong> ${item.scope || "—"}</div>
          <div><strong>Note:</strong> ${item.note || "—"}</div>
        </div>
      </div>
    `).join("") || '<div class="note">No restore history found.</div>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "storage") renderStorage();
    if (state.view === "restore") renderRestore();
  }

  function openViewModal(item) {
    if (!item) return;
    $("vName").textContent = item.name || "—";
    $("vType").textContent = item.type || "Manual";
    $("vScope").textContent = item.scope || "Full System";
    $("vStorage").textContent = item.storage || "Local";
    $("vStatus").textContent = item.status || "Scheduled";
    $("vSize").textContent = item.size || "—";
    $("vCreated").textContent = item.createdAt || "—";
    $("vRetention").textContent = item.retentionDays || "—";
    $("vMeta").textContent = item.metaPretty || "{}";
    openModal("mView");
  }

  function openCreateModal(defaultType, defaultScope) {
    $("bName").value = "";
    $("bType").value = defaultType || "Manual";
    $("bScope").value = defaultScope || "Full System";
    $("bStorage").value = "Local";
    $("bRetentionDays").value = 30;
    $("bScheduleAt").value = "";
    $("bNotes").value = "";
    openModal("mCreate");
  }

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("btnCreate").addEventListener("click", function () {
    openCreateModal("Manual", "Full System");
  });

  $("quickFull").addEventListener("click", function () {
    openCreateModal("Full", "Full System");
  });

  $("quickDb").addEventListener("click", function () {
    openCreateModal("Database", "Database Only");
  });

  $("quickLatest").addEventListener("click", function () {
    if (BACKUPS[0]) openViewModal(BACKUPS[0]);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) BACKUPS.forEach((x) => state.selected.add(x.id));
    else BACKUPS.forEach((x) => state.selected.delete(x.id));
    render();
  });

  $("tbody").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
    render();
  });

  $("tbody").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const item = BACKUPS.find((x) => x.id === tr.dataset.id);
    if (!item) return;

    if (e.target.closest(".actView")) return openViewModal(item);
    if (e.target.closest(".actRun")) return submitRowAction(`/admin/backup/${item.id}/run`);
    if (e.target.closest(".actArchive")) return submitRowAction(`/admin/backup/${item.id}/archive`);
    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete "${item.name}"?`)) {
        return submitRowAction(`/admin/backup/${item.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one backup.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkRun").addEventListener("click", function () { bulkSubmit("run"); });
  $("bulkArchive").addEventListener("click", function () { bulkSubmit("archive"); });
  $("bulkExport").addEventListener("click", function () { alert("Hook backup export later."); });

  $("btnRetention").addEventListener("click", function () { alert("Hook retention settings later."); });
  $("btnStorage").addEventListener("click", function () { setView("storage"); });
  $("btnRestoreNow").addEventListener("click", function () { alert("Hook restore action later."); });

  $("rSearch").addEventListener("input", render);
  $("rFilter").addEventListener("change", render);

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mCreate", "mView"].forEach(function (mid) {
    const modal = $(mid);
    if (!modal) return;
    modal.addEventListener("click", function (e) {
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

  setView("list");
  render();
})();
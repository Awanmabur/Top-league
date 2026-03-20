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

  const INTEGRATIONS = parseJson("integrationsData", []);
  const LOGS = parseJson("logsData", []);

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
    if (item.status === "Active") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>';
    if (item.status === "Disabled") return '<span class="pill warn"><i class="fa-solid fa-toggle-off"></i> Disabled</span>';
    return '<span class="pill bad"><i class="fa-solid fa-circle-exclamation"></i> Error</span>';
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
    $("view-usage").style.display = v === "usage" ? "" : "none";
    $("view-logs").style.display = v === "logs" ? "" : "none";

    const titles = {
      list: ["Integrations", "Manage endpoints, auth, provider config and integration status."],
      usage: ["Usage", "Review request counts, success rate and average response time."],
      logs: ["Request Logs", "Inspect integration request activity and failures."]
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];
    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${INTEGRATIONS.length} integration(s)`;
    $("checkAll").checked = INTEGRATIONS.length > 0 && INTEGRATIONS.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = INTEGRATIONS.map((item) => {
      const checked = state.selected.has(item.id) ? "checked" : "";
      return `
        <tr data-id="${item.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${item.id}" ${checked}></td>
          <td>
            <div class="strong">${item.name || ""}</div>
            <div class="muted">${item.notes || "—"}</div>
          </td>
          <td>${item.type || "Custom"}</td>
          <td>${item.provider || "—"}</td>
          <td>${item.baseUrl || "—"}</td>
          <td>${pillStatus(item)}</td>
          <td>${item.authType || "—"}</td>
          <td class="muted">${item.lastTestAt || "—"}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-xs actToggle" type="button" title="Toggle"><i class="fa-solid fa-power-off"></i></button>
              <button class="btn-xs actTest" type="button" title="Test"><i class="fa-solid fa-vial-circle-check"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="9" style="padding:18px;"><div class="muted">No integrations found.</div></td></tr>';
  }

  function renderUsage() {
    $("resultMeta").textContent = `${INTEGRATIONS.length} usage row(s)`;
    $("tbodyEng").innerHTML = INTEGRATIONS.map((item) => `
      <tr>
        <td><div class="strong">${item.name || "—"}</div></td>
        <td><span class="pill info"><i class="fa-solid fa-paper-plane"></i> ${item.metrics?.requests || 0}</span></td>
        <td><span class="pill ok"><i class="fa-solid fa-circle-check"></i> ${item.metrics?.success || 0}</span></td>
        <td><span class="pill bad"><i class="fa-solid fa-circle-exclamation"></i> ${item.metrics?.failures || 0}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-percent"></i> ${item.metrics?.successRate || "0%"}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-gauge-high"></i> ${item.metrics?.avgResponse || "—"}</span></td>
      </tr>
    `).join("") || '<tr><td colspan="6" style="padding:18px;"><div class="muted">No usage data found.</div></td></tr>';
  }

  function renderLogs() {
    const q = ($("rSearch").value || "").trim().toLowerCase();
    const f = $("rFilter").value;

    const list = LOGS.filter((item) => {
      const text = `${item.integrationName || ""} ${item.endpoint || ""} ${item.status || ""}`.toLowerCase();
      const mq = !q || text.includes(q);
      const mf = f === "all" || item.status === f;
      return mq && mf;
    });

    $("resultMeta").textContent = `${list.length} log(s)`;
    $("timelineList").innerHTML = list.map((item) => `
      <div class="timeline-item">
        <div class="timeline-head">
          <div class="strong">${item.integrationName || "—"} • ${item.status || "—"}</div>
          <div class="muted">${item.createdAt || "—"}</div>
        </div>
        <div class="timeline-body">
          <div><strong>Endpoint:</strong> ${item.endpoint || "—"}</div>
          <div><strong>Method:</strong> ${item.method || "GET"}</div>
          <div><strong>Response:</strong> ${item.responseTime || "—"}</div>
          <div><strong>Message:</strong> ${item.message || "—"}</div>
        </div>
      </div>
    `).join("") || '<div class="note">No request logs found.</div>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "usage") renderUsage();
    if (state.view === "logs") renderLogs();
  }

  function openViewModal(item) {
    if (!item) return;
    $("vName").textContent = item.name || "—";
    $("vType").textContent = item.type || "Custom";
    $("vProvider").textContent = item.provider || "—";
    $("vBaseUrl").textContent = item.baseUrl || "—";
    $("vStatus").textContent = item.status || "Disabled";
    $("vAuthType").textContent = item.authType || "—";
    $("vEndpoint").textContent = item.endpoint || "—";
    $("vLastTest").textContent = item.lastTestAt || "—";
    $("vMeta").textContent = item.metaPretty || "{}";
    openModal("mView");
  }

  function openCreateModal(defaultType) {
    $("integrationId").value = "";
    $("iName").value = "";
    $("iType").value = defaultType || "Custom";
    $("iProvider").value = "";
    $("iBaseUrl").value = "";
    $("iAuthType").value = "API Key";
    $("iStatus").value = "Active";
    $("iApiKey").value = "";
    $("iEndpoint").value = "";
    $("iNotes").value = "";
    openModal("mCreate");
  }

  function openEditModal(item) {
    $("integrationId").value = item.id || "";
    $("iName").value = item.name || "";
    $("iType").value = item.type || "Custom";
    $("iProvider").value = item.provider || "";
    $("iBaseUrl").value = item.baseUrl || "";
    $("iAuthType").value = item.authType || "API Key";
    $("iStatus").value = item.status || "Active";
    $("iApiKey").value = item.apiKeyMasked ? "" : "";
    $("iEndpoint").value = item.endpoint || "";
    $("iNotes").value = item.notes || "";
    openModal("mCreate");
  }

  $("btnCreate").addEventListener("click", function () {
    openCreateModal("Custom");
  });

  $("quickPayments").addEventListener("click", function () {
    openCreateModal("Payments");
  });

  $("quickMessaging").addEventListener("click", function () {
    openCreateModal("Messaging");
  });

  $("quickLatest").addEventListener("click", function () {
    if (INTEGRATIONS[0]) openViewModal(INTEGRATIONS[0]);
  });

  $("btnDocs").addEventListener("click", function () {
    alert("Hook API integration docs later.");
  });

  $("btnRefresh").addEventListener("click", function () {
    window.location.reload();
  });

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) INTEGRATIONS.forEach((x) => state.selected.add(x.id));
    else INTEGRATIONS.forEach((x) => state.selected.delete(x.id));
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
    const item = INTEGRATIONS.find((x) => x.id === tr.dataset.id);
    if (!item) return;

    if (e.target.closest(".actView")) return openViewModal(item);
    if (e.target.closest(".actEdit")) return openEditModal(item);
    if (e.target.closest(".actToggle")) return submitRowAction(`/admin/api-integrations/${item.id}/toggle`);
    if (e.target.closest(".actTest")) return submitRowAction(`/admin/api-integrations/${item.id}/test`);
    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete "${item.name}"?`)) {
        return submitRowAction(`/admin/api-integrations/${item.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one integration.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkEnable").addEventListener("click", function () { bulkSubmit("enable"); });
  $("bulkDisable").addEventListener("click", function () { bulkSubmit("disable"); });
  $("bulkTest").addEventListener("click", function () { bulkSubmit("test"); });
  $("btnLogExport").addEventListener("click", function () { alert("Hook request log export later."); });

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
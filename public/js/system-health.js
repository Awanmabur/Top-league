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

  const SERVICES = parseJson("healthData", []);
  const INCIDENTS = parseJson("incidentData", []);

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
    if (item.status === "Healthy") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Healthy</span>';
    if (item.status === "Warning") return '<span class="pill warn"><i class="fa-solid fa-triangle-exclamation"></i> Warning</span>';
    if (item.status === "Maintenance") return '<span class="pill info"><i class="fa-solid fa-screwdriver-wrench"></i> Maintenance</span>';
    return '<span class="pill bad"><i class="fa-solid fa-circle-exclamation"></i> Critical</span>';
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
    $("view-metrics").style.display = v === "metrics" ? "" : "none";
    $("view-incidents").style.display = v === "incidents" ? "" : "none";

    const titles = {
      list: ["Services", "Inspect service availability, health and resource status."],
      metrics: ["Metrics", "Review uptime, latency, error rate and resource usage."],
      incidents: ["Incidents", "Track active and past incidents / maintenance records."]
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];
    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${SERVICES.length} service(s)`;
    $("checkAll").checked = SERVICES.length > 0 && SERVICES.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = SERVICES.map((item) => {
      const checked = state.selected.has(item.id) ? "checked" : "";
      return `
        <tr data-id="${item.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${item.id}" ${checked}></td>
          <td>
            <div class="strong">${item.serviceName || ""}</div>
            <div class="muted">${item.host || "—"}</div>
          </td>
          <td>${item.type || "Application"}</td>
          <td>${item.region || "—"}</td>
          <td>${pillStatus(item)}</td>
          <td>${item.uptime || "—"}</td>
          <td>${item.latency || "—"}</td>
          <td>${item.load || "—"}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actHealthy" type="button" title="Healthy"><i class="fa-solid fa-circle-check"></i></button>
              <button class="btn-xs actMaintenance" type="button" title="Maintenance"><i class="fa-solid fa-screwdriver-wrench"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="9" style="padding:18px;"><div class="muted">No services found.</div></td></tr>';
  }

  function renderMetrics() {
    $("resultMeta").textContent = `${SERVICES.length} metric row(s)`;
    $("tbodyEng").innerHTML = SERVICES.map((item) => `
      <tr>
        <td><div class="strong">${item.serviceName || "—"}</div></td>
        <td><span class="pill info"><i class="fa-solid fa-chart-line"></i> ${item.uptime || "—"}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-gauge-high"></i> ${item.latency || "—"}</span></td>
        <td><span class="pill ${item.errorRate && item.errorRate !== "0%" ? "warn" : "ok"}"><i class="fa-solid fa-bug"></i> ${item.errorRate || "0%"}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-microchip"></i> ${item.cpu || "—"}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-memory"></i> ${item.memory || "—"}</span></td>
      </tr>
    `).join("") || '<tr><td colspan="6" style="padding:18px;"><div class="muted">No metrics found.</div></td></tr>';
  }

  function renderIncidents() {
    const q = ($("rSearch").value || "").trim().toLowerCase();
    const f = $("rFilter").value;

    const list = INCIDENTS.filter((item) => {
      const text = `${item.serviceName || ""} ${item.actor || ""} ${item.note || ""}`.toLowerCase();
      const mq = !q || text.includes(q);
      const mf = f === "all" || item.status === f;
      return mq && mf;
    });

    $("resultMeta").textContent = `${list.length} incident(s)`;
    $("timelineList").innerHTML = list.map((item) => `
      <div class="timeline-item">
        <div class="timeline-head">
          <div class="strong">${item.serviceName || "—"} • ${item.status || "Open"}</div>
          <div class="muted">${item.createdAt || "—"}</div>
        </div>
        <div class="timeline-body">
          <div><strong>Actor:</strong> ${item.actor || "System"}</div>
          <div><strong>Type:</strong> ${item.type || "Incident"}</div>
          <div><strong>Note:</strong> ${item.note || "—"}</div>
        </div>
      </div>
    `).join("") || '<div class="note">No incidents found.</div>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "metrics") renderMetrics();
    if (state.view === "incidents") renderIncidents();
  }

  function openViewModal(item) {
    if (!item) return;
    $("vName").textContent = item.serviceName || "—";
    $("vType").textContent = item.type || "Application";
    $("vRegion").textContent = item.region || "—";
    $("vStatus").textContent = item.status || "Healthy";
    $("vUptime").textContent = item.uptime || "—";
    $("vLatency").textContent = item.latency || "—";
    $("vLoad").textContent = item.load || "—";
    $("vChecked").textContent = item.lastCheckedAt || "—";
    $("vMeta").textContent = item.metaPretty || "{}";
    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () {
    $("sName").value = "";
    $("sType").value = "Application";
    $("sRegion").value = "";
    $("sStatus").value = "Warning";
    $("sUptime").value = "";
    $("sLatency").value = "";
    $("sNote").value = "";
    openModal("mCreate");
  });

  $("btnMaintenance").addEventListener("click", function () {
    $("sStatus").value = "Maintenance";
    openModal("mCreate");
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
    if (e.target.checked) SERVICES.forEach((x) => state.selected.add(x.id));
    else SERVICES.forEach((x) => state.selected.delete(x.id));
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
    const item = SERVICES.find((x) => x.id === tr.dataset.id);
    if (!item) return;

    if (e.target.closest(".actView")) return openViewModal(item);
    if (e.target.closest(".actHealthy")) return submitRowAction(`/admin/system-health/${item.id}/healthy`);
    if (e.target.closest(".actMaintenance")) return submitRowAction(`/admin/system-health/${item.id}/maintenance`);
  });

  $("quickCritical").addEventListener("click", function () {
    $("rFilter").value = "Open";
    setView("incidents");
    render();
  });

  $("quickIncidents").addEventListener("click", function () {
    setView("incidents");
  });

  $("quickLatest").addEventListener("click", function () {
    if (SERVICES[0]) openViewModal(SERVICES[0]);
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one service.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkHealthy").addEventListener("click", function () { bulkSubmit("healthy"); });
  $("bulkMaintenance").addEventListener("click", function () { bulkSubmit("maintenance"); });
  $("bulkExport").addEventListener("click", function () { alert("Hook health export later."); });
  $("btnIncidentExport").addEventListener("click", function () { alert("Hook incident export later."); });

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
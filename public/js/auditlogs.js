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

  const LOGS = parseJson("logsData", []);
  const ANALYTICS = parseJson("analyticsData", []);

  if (!$("tbody")) return;

  const state = {
    view: "list",
    selected: new Set(),
    actorSource: LOGS[0]?.actor || ""
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

  function pillSeverity(log) {
    if (log.severity === "Critical") return '<span class="pill bad"><i class="fa-solid fa-shield-halved"></i> Critical</span>';
    if (log.severity === "Warning") return '<span class="pill warn"><i class="fa-solid fa-triangle-exclamation"></i> Warning</span>';
    return '<span class="pill info"><i class="fa-solid fa-circle-info"></i> Info</span>';
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
    $("view-analytics").style.display = v === "analytics" ? "" : "none";
    $("view-actors").style.display = v === "actors" ? "" : "none";

    const titles = {
      list: ["Audit Logs", "Inspect system activity, changes, actors and metadata."],
      analytics: ["Analytics", "Module activity, severity distribution and latest actions."],
      actors: ["Actors", "Review a selected actor's activity timeline."]
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${LOGS.length} log(s)`;
    $("checkAll").checked = LOGS.length > 0 && LOGS.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = LOGS.map((log) => {
      const checked = state.selected.has(log.id) ? "checked" : "";
      return `
        <tr data-id="${log.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${log.id}" ${checked}></td>
          <td>
            <div class="strong">${log.actor || "System"}</div>
            <div class="muted">${log.actorEmail || "—"}</div>
          </td>
          <td><span class="pill info"><i class="fa-solid fa-bolt"></i> ${log.action || "—"}</span></td>
          <td>${log.module || "—"}</td>
          <td>
            <div class="strong">${log.entityType || "—"}</div>
            <div class="muted">${log.entityLabel || "—"}</div>
          </td>
          <td>${pillSeverity(log)}</td>
          <td class="muted">${log.createdAt || "—"}</td>
          <td>
            <div class="strong">${log.ipAddress || "—"}</div>
            <div class="muted">${log.source || "—"}</div>
          </td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actActor" type="button" title="Actor Timeline"><i class="fa-solid fa-user-clock"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="9" style="padding:18px;"><div class="muted">No audit logs found.</div></td></tr>';
  }

  function renderAnalytics() {
    $("resultMeta").textContent = `${ANALYTICS.length} module row(s)`;
    $("tbodyEng").innerHTML = ANALYTICS.map((item) => `
      <tr>
        <td><div class="strong">${item.module || "—"}</div></td>
        <td><span class="pill info"><i class="fa-solid fa-list"></i> ${item.total || 0}</span></td>
        <td><span class="pill bad"><i class="fa-solid fa-shield-halved"></i> ${item.critical || 0}</span></td>
        <td><span class="pill warn"><i class="fa-solid fa-triangle-exclamation"></i> ${item.warnings || 0}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-users"></i> ${item.actors || 0}</span></td>
        <td class="muted">${item.latest || "—"}</td>
      </tr>
    `).join("") || '<tr><td colspan="6" style="padding:18px;"><div class="muted">No analytics found.</div></td></tr>';
  }

  function getActorLogs() {
    const q = ($("rSearch").value || "").trim().toLowerCase();
    const sev = $("rFilter").value;

    return LOGS.filter((log) => {
      const sameActor = state.actorSource ? log.actor === state.actorSource : true;
      const text = `${log.actor || ""} ${log.actorEmail || ""} ${log.action || ""} ${log.module || ""}`.toLowerCase();
      const mq = !q || text.includes(q);
      const ms = sev === "all" || log.severity === sev;
      return sameActor && mq && ms;
    });
  }

  function renderActors() {
    const list = getActorLogs();
    $("resultMeta").textContent = `${list.length} actor log(s)`;
    $("timelineList").innerHTML = list.map((log) => `
      <div class="timeline-item">
        <div class="timeline-head">
          <div class="strong">${log.action || "—"} • ${log.module || "—"}</div>
          <div class="muted">${log.createdAt || "—"}</div>
        </div>
        <div class="timeline-body">
          <div><strong>Actor:</strong> ${log.actor || "System"}</div>
          <div><strong>Entity:</strong> ${log.entityType || "—"} ${log.entityLabel ? `• ${log.entityLabel}` : ""}</div>
          <div><strong>Severity:</strong> ${log.severity || "Info"}</div>
          <div><strong>Source:</strong> ${log.source || "—"} • ${log.ipAddress || "—"}</div>
        </div>
      </div>
    `).join("") || '<div class="note">No actor activity found.</div>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "analytics") renderAnalytics();
    if (state.view === "actors") renderActors();
  }

  function openViewModal(log) {
    if (!log) return;
    $("vActor").textContent = log.actor || "System";
    $("vAction").textContent = log.action || "—";
    $("vModule").textContent = log.module || "—";
    $("vEntity").textContent = `${log.entityType || "—"}${log.entityLabel ? " • " + log.entityLabel : ""}`;
    $("vSeverity").textContent = log.severity || "Info";
    $("vWhen").textContent = log.createdAt || "—";
    $("vIp").textContent = log.ipAddress || "—";
    $("vSource").textContent = log.source || "—";
    $("vMeta").textContent = log.metadataPretty || "{}";
    $("vDiff").textContent = log.diffPretty || "{}";
    openModal("mView");
  }

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) LOGS.forEach((x) => state.selected.add(x.id));
    else LOGS.forEach((x) => state.selected.delete(x.id));
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

    const item = LOGS.find((x) => x.id === tr.dataset.id);
    if (!item) return;

    if (e.target.closest(".actView")) return openViewModal(item);
    if (e.target.closest(".actActor")) {
      state.actorSource = item.actor || "";
      return setView("actors");
    }
  });

  $("quickCritical").addEventListener("click", function () {
    $("rFilter").value = "Critical";
    setView("actors");
    render();
  });

  $("quickActors").addEventListener("click", function () {
    setView("actors");
  });

  $("quickLatest").addEventListener("click", function () {
    if (LOGS[0]) openViewModal(LOGS[0]);
  });

  $("btnViewLatest").addEventListener("click", function () {
    if (LOGS[0]) openViewModal(LOGS[0]);
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one log entry.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("btnExport").addEventListener("click", function () { alert("Hook audit log export later."); });
  $("btnReviewed").addEventListener("click", function () { alert("Hook mark reviewed later."); });
  $("bulkExport").addEventListener("click", function () { alert("Hook bulk export later."); });
  $("bulkReview").addEventListener("click", function () { alert("Hook bulk review later."); });
  $("btnActorExport").addEventListener("click", function () { alert("Hook actor export later."); });

  $("rSearch").addEventListener("input", render);
  $("rFilter").addEventListener("change", render);

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  const modal = $("mView");
  if (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target.id === "mView") closeModal("mView");
    });
  }

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
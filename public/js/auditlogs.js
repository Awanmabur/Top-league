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

  let LOGS = parseJson("logsData", []);
  const ANALYTICS = parseJson("analyticsData", []);

  if (!$("tbody")) return;

  const state = {
    view: "list",
    selected: new Set(),
    actorSource: LOGS[0]?.actor || "",
  };

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadCsv(rows, filename) {
    const header = [
      "When",
      "Actor",
      "Actor Email",
      "Action",
      "Module",
      "Entity Type",
      "Entity Label",
      "Severity",
      "Reviewed",
      "IP Address",
      "Source",
    ];
    const lines = rows.map((row) => [
      row.createdAt,
      row.actor,
      row.actorEmail,
      row.action,
      row.module,
      row.entityType,
      row.entityLabel,
      row.severity,
      row.reviewed ? "Yes" : "No",
      row.ipAddress,
      row.source,
    ].map(csvCell).join(","));

    const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `audit-logs-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function markReviewed(ids) {
    const body = new URLSearchParams();
    if (ids && ids.length) body.set("ids", ids.join(","));

    const res = await fetch("/admin/auditlogs/reviewed" + window.location.search, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.message || "Could not mark logs reviewed.");

    const selected = new Set(ids && ids.length ? ids : LOGS.map((x) => x.id));
    LOGS = LOGS.map((log) => selected.has(log.id) ? { ...log, reviewed: true } : log);
    state.selected.clear();
    render();
    alert(`Marked ${data.modified || selected.size} log(s) reviewed.`);
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

  function pillSeverity(log) {
    if (log.severity === "Critical") return '<span class="pill bad"><i class="fa-solid fa-shield-halved"></i> Critical</span>';
    if (log.severity === "Warning") return '<span class="pill warn"><i class="fa-solid fa-triangle-exclamation"></i> Warning</span>';
    return '<span class="pill info"><i class="fa-solid fa-circle-info"></i> Info</span>';
  }

  function pillReviewed(log) {
    if (log.reviewed) return '<span class="pill ok"><i class="fa-solid fa-check-double"></i> Reviewed</span>';
    return '<span class="pill warn"><i class="fa-solid fa-hourglass-half"></i> Needs review</span>';
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
      actors: ["Actors", "Review a selected actor's activity timeline."],
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
        <tr data-id="${esc(log.id)}">
          <td><input type="checkbox" class="rowCheck" data-id="${esc(log.id)}" ${checked}></td>
          <td>
            <div class="strong">${esc(log.actor || "System")}</div>
            <div class="muted">${esc(log.actorEmail || "-")}</div>
          </td>
          <td><span class="pill info"><i class="fa-solid fa-bolt"></i> ${esc(log.action || "-")}</span></td>
          <td>${esc(log.module || "-")}</td>
          <td>
            <div class="strong">${esc(log.entityType || "-")}</div>
            <div class="muted">${esc(log.entityLabel || "-")}</div>
          </td>
          <td>${pillSeverity(log)}</td>
          <td>${pillReviewed(log)}</td>
          <td class="muted">${esc(log.createdAt || "-")}</td>
          <td>
            <div class="strong">${esc(log.ipAddress || "-")}</div>
            <div class="muted">${esc(log.source || "-")}</div>
          </td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actActor" type="button" title="Actor Timeline"><i class="fa-solid fa-user-clock"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="10" style="padding:18px;"><div class="muted">No audit logs found.</div></td></tr>';
  }

  function renderAnalytics() {
    $("resultMeta").textContent = `${ANALYTICS.length} module row(s)`;
    $("tbodyEng").innerHTML = ANALYTICS.map((item) => `
      <tr>
        <td><div class="strong">${esc(item.module || "-")}</div></td>
        <td><span class="pill info"><i class="fa-solid fa-list"></i> ${Number(item.total || 0)}</span></td>
        <td><span class="pill bad"><i class="fa-solid fa-shield-halved"></i> ${Number(item.critical || 0)}</span></td>
        <td><span class="pill warn"><i class="fa-solid fa-triangle-exclamation"></i> ${Number(item.warnings || 0)}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-users"></i> ${Number(item.actors || 0)}</span></td>
        <td class="muted">${esc(item.latest || "-")}</td>
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
          <div class="strong">${esc(log.action || "-")} - ${esc(log.module || "-")}</div>
          <div class="muted">${esc(log.createdAt || "-")}</div>
        </div>
        <div class="timeline-body">
          <div><strong>Actor:</strong> ${esc(log.actor || "System")}</div>
          <div><strong>Entity:</strong> ${esc(log.entityType || "-")} ${log.entityLabel ? `- ${esc(log.entityLabel)}` : ""}</div>
          <div><strong>Severity:</strong> ${esc(log.severity || "Info")}</div>
          <div><strong>Source:</strong> ${esc(log.source || "-")} - ${esc(log.ipAddress || "-")}</div>
          <div><strong>Review:</strong> ${log.reviewed ? "Reviewed" : "Needs review"}</div>
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
    $("vAction").textContent = log.action || "-";
    $("vModule").textContent = log.module || "-";
    $("vEntity").textContent = `${log.entityType || "-"}${log.entityLabel ? " - " + log.entityLabel : ""}`;
    $("vSeverity").textContent = `${log.severity || "Info"}${log.reviewed ? " (Reviewed)" : " (Needs review)"}`;
    $("vWhen").textContent = log.createdAt || "-";
    $("vIp").textContent = log.ipAddress || "-";
    $("vSource").textContent = log.source || "-";
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
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
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

  $("btnExport").addEventListener("click", function () {
    window.location.href = "/admin/auditlogs/export.csv" + window.location.search;
  });
  $("btnReviewed").addEventListener("click", function () {
    markReviewed(LOGS.map((x) => x.id)).catch((err) => alert(err.message || "Could not mark reviewed."));
  });
  $("bulkExport").addEventListener("click", function () {
    const ids = [...state.selected];
    downloadCsv(LOGS.filter((x) => ids.includes(x.id)), "selected-audit-logs.csv");
  });
  $("bulkReview").addEventListener("click", function () {
    markReviewed([...state.selected]).catch((err) => alert(err.message || "Could not mark reviewed."));
  });
  $("btnActorExport").addEventListener("click", function () {
    downloadCsv(getActorLogs(), "actor-audit-logs.csv");
  });

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

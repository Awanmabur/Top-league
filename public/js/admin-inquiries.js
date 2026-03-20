(function () {
  const $ = (id) => document.getElementById(id);

  function readData() {
    const el = $("inquiriesData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse inquiries data:", err);
      return [];
    }
  }

  const INQ = readData();
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

  function pillStatus(status) {
    const s = String(status || "new").toLowerCase();
    if (s === "resolved") {
      return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Resolved</span>';
    }
    if (s === "read") {
      return '<span class="pill warn"><i class="fa-solid fa-envelope-open"></i> Read</span>';
    }
    return '<span class="pill info"><i class="fa-solid fa-envelope"></i> New</span>';
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
    $("view-summary").style.display = v === "summary" ? "" : "none";

    const titles = {
      list: ["Inquiries", "Manage incoming contact messages."],
      summary: ["Summary", "Inquiry counts by status."],
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${INQ.length} inquiry(s)`;
    $("checkAll").checked = INQ.length > 0 && INQ.every((x) => state.selected.has(String(x._id)));

    $("tbody").innerHTML = INQ.map((a) => {
      const id = String(a._id || "");
      const checked = state.selected.has(id) ? "checked" : "";
      return `
        <tr data-id="${id}">
          <td><input type="checkbox" class="rowCheck" data-id="${id}" ${checked}></td>
          <td><div class="strong">${a.name || "—"}</div></td>
          <td><div>${a.contact || "—"}</div></td>
          <td><div class="muted">${a.message || "—"}</div></td>
          <td><span class="pill info"><i class="fa-solid fa-school"></i> ${a.schoolCode || "—"}</span></td>
          <td class="muted">${a.createdAtLabel || "—"}</td>
          <td>${pillStatus(a.statusLabel || a.status)}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actRead" type="button" title="Mark Read"><i class="fa-solid fa-envelope-open"></i></button>
              <button class="btn-xs actResolve" type="button" title="Resolve"><i class="fa-solid fa-circle-check"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="8" style="padding:18px;"><div class="muted">No inquiries found.</div></td></tr>';
  }

  function renderSummary() {
    const counts = {
      new: 0,
      read: 0,
      resolved: 0,
    };

    INQ.forEach((x) => {
      const s = String(x.statusLabel || x.status || "new").toLowerCase();
      if (s === "resolved") counts.resolved += 1;
      else if (s === "read") counts.read += 1;
      else counts.new += 1;
    });

    $("resultMeta").textContent = `${INQ.length} inquiry(s)`;

    $("tbodySummary").innerHTML = `
      <tr>
        <td>${pillStatus("new")}</td>
        <td><strong>${counts.new}</strong></td>
        <td class="muted">Fresh messages that still need attention.</td>
      </tr>
      <tr>
        <td>${pillStatus("read")}</td>
        <td><strong>${counts.read}</strong></td>
        <td class="muted">Reviewed inquiries awaiting closure.</td>
      </tr>
      <tr>
        <td>${pillStatus("resolved")}</td>
        <td><strong>${counts.resolved}</strong></td>
        <td class="muted">Completed or closed inquiries.</td>
      </tr>
    `;
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "summary") renderSummary();
  }

  function openViewModal(a) {
    if (!a) return;

    $("vName").textContent = a.name || "—";
    $("vContact").textContent = a.contact || "—";
    $("vSchoolCode").textContent = a.schoolCode || "—";
    $("vStatus").textContent = a.statusLabel || a.status || "—";
    $("vCreated").textContent = a.createdAtLabel || "—";
    $("vUpdated").textContent = a.updatedAtLabel || "—";
    $("vMessage").textContent = a.message || "—";

    openModal("mView");
  }

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) INQ.forEach((a) => state.selected.add(String(a._id)));
    else INQ.forEach((a) => state.selected.delete(String(a._id)));
    render();
  });

  $("tbody").addEventListener("change", function (e) {
    if (!e.target.classList.contains("rowCheck")) return;
    const id = String(e.target.dataset.id || "");
    if (e.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    render();
  });

  $("tbody").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const id = String(tr.dataset.id || "");
    const a = INQ.find((x) => String(x._id) === id);
    if (!a) return;

    if (e.target.closest(".actView")) return openViewModal(a);
    if (e.target.closest(".actRead")) return submitRowAction(`/admin/inquiries/${id}/read`);
    if (e.target.closest(".actResolve")) return submitRowAction(`/admin/inquiries/${id}/resolve`);

    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete inquiry from "${a.name || "this sender"}"?`)) {
        return submitRowAction(`/admin/inquiries/${id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one inquiry.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkRead").addEventListener("click", function () {
    if (!state.selected.size) return;
    alert("Hook bulk mark-read route next.");
  });

  $("bulkResolve").addEventListener("click", function () {
    if (!state.selected.size) return;
    alert("Hook bulk resolve route next.");
  });

  $("bulkDelete").addEventListener("click", function () {
    if (!state.selected.size) return;
    alert("Hook bulk delete route next.");
  });

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mView"].forEach(function (mid) {
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
    alert("Hook export route later.");
  });

  $("btnRefresh").addEventListener("click", function () {
    window.location.reload();
  });

  $("quickNew").addEventListener("click", function () {
    const url = new URL(window.location.href);
    url.searchParams.set("status", "new");
    window.location.href = url.toString();
  });

  $("quickResolved").addEventListener("click", function () {
    const url = new URL(window.location.href);
    url.searchParams.set("status", "resolved");
    window.location.href = url.toString();
  });

  $("quickRefresh").addEventListener("click", function () {
    window.location.reload();
  });

  setView("list");
  render();
})();
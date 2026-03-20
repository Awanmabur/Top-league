(function () {
  const $ = (id) => document.getElementById(id);

  function readAnnouncementsData() {
    const el = $("announcementsData");
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error("Failed to parse announcements data:", err);
      return [];
    }
  }

  const ANN = readAnnouncementsData();

  if (!$("tbody")) return;

  const state = {
    view: "list",
    selected: new Set(),
    receiptsSourceAnnouncementId: ANN[0]?.id || null
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

  function pillStatus(a) {
    if (a.status === "Published") return '<span class="pill ok"><i class="fa-solid fa-globe"></i> Published</span>';
    if (a.status === "Scheduled") return '<span class="pill info"><i class="fa-solid fa-clock"></i> Scheduled</span>';
    if (a.status === "Draft") return '<span class="pill warn"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
    return '<span class="pill bad"><i class="fa-solid fa-eye-slash"></i> Unpublished</span>';
  }

  function pillPinned(a) {
    return a.pinned
      ? '<span class="pill pin"><i class="fa-solid fa-thumbtack"></i> Pinned</span>'
      : '<span class="pill info"><i class="fa-regular fa-circle"></i> Normal</span>';
  }

  function chIcons(ch) {
    const safe = ch || { portal: true, email: false, sms: false, push: false };
    const on = (b) => (b ? "ok" : "info");
    return `
      <span class="pill ${on(safe.portal)}"><i class="fa-solid fa-globe"></i> Portal</span>
      <span class="pill ${on(safe.email)}"><i class="fa-solid fa-envelope"></i> Email</span>
      <span class="pill ${on(safe.sms)}"><i class="fa-solid fa-comment-sms"></i> SMS</span>
      <span class="pill ${on(safe.push)}"><i class="fa-solid fa-bell"></i> Push</span>
    `;
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
    $("view-engagement").style.display = v === "engagement" ? "" : "none";
    $("view-receipts").style.display = v === "receipts" ? "" : "none";

    const titles = {
      list: ["Announcements", "Manage announcements and publishing workflow."],
      engagement: ["Engagement", "Views, opens, clicks and acknowledgements."],
      receipts: ["Read Receipts", "Track who read/acknowledged announcements."]
    };

    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];

    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${ANN.length} announcement(s)`;
    $("checkAll").checked = ANN.length > 0 && ANN.every((x) => state.selected.has(x.id));

    $("tbody").innerHTML = ANN.map((a) => {
      const checked = state.selected.has(a.id) ? "checked" : "";
      const reqAck = a.ack
        ? '<span class="pill bad"><i class="fa-solid fa-user-check"></i> Ack</span>'
        : '<span class="pill info"><i class="fa-regular fa-user"></i> No Ack</span>';

      return `
        <tr data-id="${a.id}">
          <td><input type="checkbox" class="rowCheck" data-id="${a.id}" ${checked}></td>
          <td>
            <div class="strong">${a.title || ""}</div>
            <div class="muted">${pillPinned(a)} ${reqAck}</div>
          </td>
          <td><span class="pill info"><i class="fa-solid fa-tag"></i> ${a.cat || "General"}</span></td>
          <td>
            <div class="strong">${a.audType || "All Students"}</div>
            <div class="muted">${a.audVal || "—"}</div>
          </td>
          <td>${chIcons(a.ch)}</td>
          <td class="muted">${a.schedule || "—"}</td>
          <td>${pillStatus(a)}</td>
          <td>
            <div class="actions">
              <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
              <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-xs actReceipts" type="button" title="Receipts"><i class="fa-solid fa-user-check"></i></button>
              <button class="btn-xs actPublish" type="button" title="Publish"><i class="fa-solid fa-globe"></i></button>
              <button class="btn-xs actUnpub" type="button" title="Unpublish"><i class="fa-solid fa-eye-slash"></i></button>
              <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="8" style="padding:18px;"><div class="muted">No announcements found.</div></td></tr>';
  }

  function renderEng() {
    $("resultMeta").textContent = `${ANN.length} announcement(s)`;
    $("tbodyEng").innerHTML = ANN.map((a) => `
      <tr>
        <td><div class="strong">${a.title || ""}</div><div class="muted">${a.cat || "General"}</div></td>
        <td><span class="pill info"><i class="fa-solid fa-eye"></i> ${(a.stats && a.stats.views) || 0}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-envelope-open"></i> ${(a.stats && a.stats.opens) || 0}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-comment-sms"></i> ${(a.stats && a.stats.sms) || 0}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${(a.stats && a.stats.clicks) || 0}</span></td>
        <td><span class="pill ${a.ack ? "bad" : "info"}"><i class="fa-solid fa-user-check"></i> ${(a.stats && a.stats.ack) || 0}</span></td>
      </tr>
    `).join("") || '<tr><td colspan="6" style="padding:18px;"><div class="muted">No engagement data found.</div></td></tr>';
  }

  function getCurrentReceiptsSource() {
    return ANN.find((x) => x.id === state.receiptsSourceAnnouncementId) || ANN[0] || null;
  }

  function renderReceipts() {
    const source = getCurrentReceiptsSource();
    const q = ($("rSearch").value || "").trim().toLowerCase();
    const f = $("rFilter").value;

    const list = ((source && source.receipts) || []).filter((r) => {
      const text = `${r.user || ""} ${r.email || ""} ${r.role || ""} ${r.status || ""}`.toLowerCase();
      const mq = !q || text.includes(q);
      const mf = f === "all" || r.status === f;
      return mq && mf;
    });

    $("resultMeta").textContent = `${list.length} receipt(s)`;
    $("tbodyRec").innerHTML = list.map((r) => {
      const st = r.status === "Acknowledged" ? "bad" : (r.status === "Read" ? "ok" : "warn");
      return `
        <tr>
          <td><div class="strong">${r.user || "—"}</div><div class="muted">${r.email || "—"}</div></td>
          <td><span class="pill info"><i class="fa-solid fa-id-badge"></i> ${r.role || "—"}</span></td>
          <td><span class="pill ${st}"><i class="fa-solid fa-circle"></i> ${r.status || "Unread"}</span></td>
          <td class="muted">${r.readAt || "—"}</td>
          <td class="muted">${r.ackAt || "—"}</td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="5" style="padding:18px;"><div class="muted">No receipts for this announcement.</div></td></tr>';
  }

  function render() {
    syncBulkbar();
    if (state.view === "list") renderList();
    if (state.view === "engagement") renderEng();
    if (state.view === "receipts") renderReceipts();
  }

  function setSwitchHiddenInputs() {
    $("channelEmail").value = document.querySelector('.switch[data-ch="email"]').classList.contains("on") ? "true" : "false";
    $("channelSms").value = document.querySelector('.switch[data-ch="sms"]').classList.contains("on") ? "true" : "false";
    $("channelPush").value = document.querySelector('.switch[data-ch="push"]').classList.contains("on") ? "true" : "false";
  }

  function openEditor(pref) {
    pref = pref || null;

    $("mTitle").textContent = pref ? "Edit Announcement" : "Create Announcement";
    const form = $("announcementForm");
    form.action = pref ? `/admin/announcements/${pref.id}/update` : "/admin/announcements";

    $("aTitle").value = pref ? (pref.title || "") : "";
    $("aCategory").value = pref ? (pref.cat || "General") : "General";
    $("aPriority").value = pref && pref.pinned ? "Pinned" : "Normal";
    $("aAudienceType").value = pref ? (pref.audType || "All Students") : "All Students";
    $("aAudienceValue").value = pref ? (pref.audVal || "") : "";
    $("aRequireAck").value = pref && pref.ack ? "yes" : "no";
    $("aBody").value = pref ? (pref.body || "") : "";
    $("aPublishMode").value = pref
      ? (pref.status === "Draft" ? "Save as Draft" : (pref.status === "Scheduled" ? "Schedule" : "Publish Now"))
      : "Publish Now";
    $("aSchedule").value = pref && pref.schedule && pref.schedule !== "—"
      ? pref.schedule.replace(" ", "T").slice(0, 16)
      : "";
    $("aExpiry").value = pref ? (pref.expiryDate || "") : "";

    $("charCount").textContent = `${$("aBody").value.length} / 5000`;

    const portal = document.querySelector('.switch[data-ch="portal"]');
    const email = document.querySelector('.switch[data-ch="email"]');
    const sms = document.querySelector('.switch[data-ch="sms"]');
    const push = document.querySelector('.switch[data-ch="push"]');

    portal.classList.add("on");
    email.classList.toggle("on", !!(pref && pref.ch && pref.ch.email));
    sms.classList.toggle("on", !!(pref && pref.ch && pref.ch.sms));
    push.classList.toggle("on", !!(pref && pref.ch && pref.ch.push));

    setSwitchHiddenInputs();
    openModal("mEdit");
  }

  function openViewModal(a) {
    if (!a) return;

    $("vTitle").textContent = a.title || "—";
    $("vCategory").textContent = a.cat || "General";
    $("vAudience").textContent = a.audType || "All Students";
    $("vAudienceValue").textContent = a.audVal || "—";
    $("vStatus").textContent = a.status || "—";
    $("vSchedule").textContent = a.schedule || "—";
    $("vPriority").textContent = a.pinned ? "Pinned" : "Normal";
    $("vAck").textContent = a.ack ? "Yes" : "No";

    const channels = [];
    if (a.ch?.portal) channels.push("Portal");
    if (a.ch?.email) channels.push("Email");
    if (a.ch?.sms) channels.push("SMS");
    if (a.ch?.push) channels.push("Push");
    $("vChannels").textContent = channels.length ? channels.join(", ") : "—";

    $("vBody").textContent = a.body || "—";

    openModal("mView");
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickAcademic").addEventListener("click", function () {
    openEditor();
    $("aCategory").value = "Academic";
    $("aTitle").value = "Academic Notice";
  });

  $("quickFinance").addEventListener("click", function () {
    openEditor();
    $("aCategory").value = "Finance";
    $("aTitle").value = "Finance Reminder";
  });

  $("quickEmergency").addEventListener("click", function () {
    openEditor();
    $("aCategory").value = "Emergency";
    $("aTitle").value = "Emergency Alert";
    $("aPriority").value = "Pinned";
  });

  $("viewChips").addEventListener("click", function (e) {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  $("checkAll").addEventListener("change", function (e) {
    if (e.target.checked) ANN.forEach((a) => state.selected.add(a.id));
    else ANN.forEach((a) => state.selected.delete(a.id));
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

    const a = ANN.find((x) => x.id === tr.dataset.id);
    if (!a) return;

    if (e.target.closest(".actView")) return openViewModal(a);
    if (e.target.closest(".actEdit")) return openEditor(a);

    if (e.target.closest(".actReceipts")) {
      state.receiptsSourceAnnouncementId = a.id;
      return setView("receipts");
    }

    if (e.target.closest(".actPublish")) return submitRowAction(`/admin/announcements/${a.id}/publish`);
    if (e.target.closest(".actUnpub")) return submitRowAction(`/admin/announcements/${a.id}/unpublish`);

    if (e.target.closest(".actDelete")) {
      if (window.confirm(`Delete "${a.title}"?`)) {
        return submitRowAction(`/admin/announcements/${a.id}/delete`);
      }
    }
  });

  $("btnBulk").addEventListener("click", function () {
    if (!state.selected.size) return alert("Select at least one announcement.");
    $("bulkbar").classList.add("show");
  });

  $("bulkClear").addEventListener("click", function () {
    state.selected.clear();
    render();
  });

  $("bulkPublish").addEventListener("click", function () { bulkSubmit("publish"); });
  $("bulkUnpub").addEventListener("click", function () { bulkSubmit("unpublish"); });
  $("bulkPin").addEventListener("click", function () { bulkSubmit("pin"); });
  $("bulkUnpin").addEventListener("click", function () { bulkSubmit("unpin"); });

  $("aBody").addEventListener("input", function () {
    const n = $("aBody").value.length;
    $("charCount").textContent = `${n} / 5000`;
    $("charCount").style.color = n > 5000 ? "#b91c1c" : "";
  });

  document.querySelectorAll(".switch").forEach(function (sw) {
    sw.addEventListener("click", function () {
      if (sw.dataset.ch === "portal") return;
      sw.classList.toggle("on");
      setSwitchHiddenInputs();
    });
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

  $("rSearch").addEventListener("input", render);
  $("rFilter").addEventListener("change", render);

  $("btnExport").addEventListener("click", function () { alert("Hook export route later."); });
  $("btnTemplates").addEventListener("click", function () { alert("Hook templates route later."); });
  $("btnSettings").addEventListener("click", function () { alert("Hook settings route later."); });
  $("btnRemind").addEventListener("click", function () { alert("Hook reminder/send-notification logic later."); });

  setView("list");
  render();
})();
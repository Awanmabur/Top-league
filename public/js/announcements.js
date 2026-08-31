(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  function readJsonData(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try { return JSON.parse(el.value || JSON.stringify(fallback)); }
    catch (err) { console.error(`Failed to parse ${id}:`, err); return fallback; }
  }

  const ANN = readJsonData("announcementsData", []);
  const TEMPLATES = readJsonData("templatesData", []);
  if (!$('tbody')) return;

  const initialView = new URLSearchParams(window.location.search).get("view");
  const state = {
    view: ["list", "engagement", "receipts"].includes(initialView) ? initialView : "list",
    selected: new Set(),
    receiptsSourceAnnouncementId: ANN[0]?.id || null,
  };

  function openModal(id) { const el = $(id); if (el) el.classList.add("show"); }
  function closeModal(id) { const el = $(id); if (el) el.classList.remove("show"); }

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
      receipts: ["Read Receipts", "Track who read/acknowledged announcements."],
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
        <tr data-id="${esc(a.id)}">
          <td><input type="checkbox" class="rowCheck" data-id="${esc(a.id)}" ${checked}></td>
          <td><div class="strong">${esc(a.title)}</div><div class="muted">${pillPinned(a)} ${reqAck}</div></td>
          <td><span class="pill info"><i class="fa-solid fa-tag"></i> ${esc(a.cat || "General")}</span></td>
          <td><div class="strong">${esc(a.audType || "All Students")}</div><div class="muted">${esc(a.audVal || "—")}</div></td>
          <td>${chIcons(a.ch)}</td>
          <td class="muted">${esc(a.schedule || "—")}</td>
          <td>${pillStatus(a)}</td>
          <td><div class="actions">
            <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
            <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-xs actReceipts" type="button" title="Receipts"><i class="fa-solid fa-user-check"></i></button>
            <button class="btn-xs actPublish" type="button" title="Publish"><i class="fa-solid fa-globe"></i></button>
            <button class="btn-xs actUnpub" type="button" title="Unpublish"><i class="fa-solid fa-eye-slash"></i></button>
            <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div></td>
        </tr>`;
    }).join("") || '<tr><td colspan="8" style="padding:18px;"><div class="muted">No announcements found.</div></td></tr>';
  }

  function renderEng() {
    $("resultMeta").textContent = `${ANN.length} announcement(s)`;
    $("tbodyEng").innerHTML = ANN.map((a) => `
      <tr>
        <td><div class="strong">${esc(a.title)}</div><div class="muted">${esc(a.cat || "General")}</div></td>
        <td><span class="pill info"><i class="fa-solid fa-eye"></i> ${Number(a.stats?.views || 0)}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-envelope-open"></i> ${Number(a.stats?.opens || 0)}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-comment-sms"></i> ${Number(a.stats?.sms || 0)}</span></td>
        <td><span class="pill info"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${Number(a.stats?.clicks || 0)}</span></td>
        <td><span class="pill ${a.ack ? "bad" : "info"}"><i class="fa-solid fa-user-check"></i> ${Number(a.stats?.ack || 0)}</span></td>
      </tr>`).join("") || '<tr><td colspan="6" style="padding:18px;"><div class="muted">No engagement data found.</div></td></tr>';
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
      return (!q || text.includes(q)) && (f === "all" || r.status === f);
    });

    $("resultMeta").textContent = source ? `${list.length} receipt(s) • ${source.title}` : "0 receipt(s)";
    $("tbodyRec").innerHTML = list.map((r) => {
      const st = r.status === "Acknowledged" ? "bad" : (r.status === "Read" ? "ok" : "warn");
      return `<tr>
        <td><div class="strong">${esc(r.user || "—")}</div><div class="muted">${esc(r.email || "—")}</div></td>
        <td><span class="pill info"><i class="fa-solid fa-id-badge"></i> ${esc(r.role || "—")}</span></td>
        <td><span class="pill ${st}"><i class="fa-solid fa-circle"></i> ${esc(r.status || "Unread")}</span></td>
        <td class="muted">${esc(r.readAt || "—")}</td><td class="muted">${esc(r.ackAt || "—")}</td>
      </tr>`;
    }).join("") || '<tr><td colspan="5" style="padding:18px;"><div class="muted">No receipts for this announcement.</div></td></tr>';
  }

  function renderTemplates() {
    const body = $("templatesBody");
    if (!body) return;
    body.innerHTML = TEMPLATES.map((t) => `
      <tr data-template-id="${esc(t.id)}">
        <td><div class="strong">${esc(t.name)}</div><div class="muted">${esc(t.title)}</div></td>
        <td><span class="pill info">${esc(t.cat || "General")}</span></td>
        <td><div class="strong">${esc(t.audType || "All Students")}</div><div class="muted">${esc(t.audVal || "—")}</div></td>
        <td><div class="actions">
          <button class="btn-xs useTemplate" type="button" title="Use template"><i class="fa-solid fa-wand-magic-sparkles"></i> Use</button>
          <button class="btn-xs deleteTemplate" type="button" title="Delete template"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`).join("") || '<tr><td colspan="4" style="padding:18px;"><div class="muted">No saved templates yet.</div></td></tr>';
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
    form.action = pref?.id && ANN.some((a) => a.id === pref.id) ? `/admin/announcements/${pref.id}/update` : "/admin/announcements";

    $("aTitle").value = pref?.title || "";
    $("aCategory").value = pref?.cat || "General";
    $("aPriority").value = pref?.pinned ? "Pinned" : "Normal";
    $("aAudienceType").value = pref?.audType || "All Students";
    $("aAudienceValue").value = pref?.audVal && pref.audVal !== "—" ? pref.audVal : "";
    $("aRequireAck").value = pref?.ack ? "yes" : "no";
    $("aBody").value = pref?.body || "";
    $("aPublishMode").value = pref && ANN.some((a) => a.id === pref.id)
      ? (pref.status === "Draft" ? "Save as Draft" : (pref.status === "Scheduled" ? "Schedule" : "Publish Now"))
      : "Publish Now";
    $("aSchedule").value = pref?.schedule && pref.schedule !== "—" ? pref.schedule.replace(" ", "T").slice(0, 16) : "";
    $("aExpiry").value = pref?.expiryDate || "";
    $("charCount").textContent = `${$("aBody").value.length} / 5000`;

    document.querySelector('.switch[data-ch="portal"]').classList.add("on");
    document.querySelector('.switch[data-ch="email"]').classList.toggle("on", !!pref?.ch?.email);
    document.querySelector('.switch[data-ch="sms"]').classList.toggle("on", !!pref?.ch?.sms);
    document.querySelector('.switch[data-ch="push"]').classList.toggle("on", !!pref?.ch?.push);
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

  $("btnCreate").addEventListener("click", () => openEditor());
  $("quickAcademic").addEventListener("click", () => { openEditor(); $("aCategory").value = "Academic"; $("aTitle").value = "Academic Notice"; });
  $("quickFinance").addEventListener("click", () => { openEditor(); $("aCategory").value = "Finance"; $("aTitle").value = "Finance Reminder"; });
  $("quickEmergency").addEventListener("click", () => { openEditor(); $("aCategory").value = "Emergency"; $("aTitle").value = "Emergency Alert"; $("aPriority").value = "Pinned"; });

  $("viewChips").addEventListener("click", (e) => { const btn = e.target.closest(".chip"); if (btn) setView(btn.dataset.view); });
  $("checkAll").addEventListener("change", (e) => { if (e.target.checked) ANN.forEach((a) => state.selected.add(a.id)); else state.selected.clear(); render(); });
  $("tbody").addEventListener("change", (e) => {
    if (!e.target.classList.contains("rowCheck")) return;
    if (e.target.checked) state.selected.add(e.target.dataset.id); else state.selected.delete(e.target.dataset.id);
    render();
  });

  $("tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const a = ANN.find((x) => x.id === tr.dataset.id);
    if (!a) return;
    if (e.target.closest(".actView")) return openViewModal(a);
    if (e.target.closest(".actEdit")) return openEditor(a);
    if (e.target.closest(".actReceipts")) { state.receiptsSourceAnnouncementId = a.id; return setView("receipts"); }
    if (e.target.closest(".actPublish")) return submitRowAction(`/admin/announcements/${a.id}/publish`);
    if (e.target.closest(".actUnpub")) return submitRowAction(`/admin/announcements/${a.id}/unpublish`);
    if (e.target.closest(".actDelete") && window.confirm(`Delete "${a.title}"?`)) return submitRowAction(`/admin/announcements/${a.id}/delete`);
  });

  $("templatesBody")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-template-id]");
    if (!tr) return;
    const template = TEMPLATES.find((t) => t.id === tr.dataset.templateId);
    if (!template) return;
    if (e.target.closest(".useTemplate")) { closeModal("mTemplates"); return openEditor(template); }
    if (e.target.closest(".deleteTemplate") && window.confirm(`Delete template "${template.name}"?`)) {
      return submitRowAction(`/admin/announcements/templates/${template.id}/delete`);
    }
  });

  $("btnBulk").addEventListener("click", () => { if (!state.selected.size) return alert("Select at least one announcement."); $("bulkbar").classList.add("show"); });
  $("bulkClear").addEventListener("click", () => { state.selected.clear(); render(); });
  $("bulkPublish").addEventListener("click", () => bulkSubmit("publish"));
  $("bulkUnpub").addEventListener("click", () => bulkSubmit("unpublish"));
  $("bulkPin").addEventListener("click", () => bulkSubmit("pin"));
  $("bulkUnpin").addEventListener("click", () => bulkSubmit("unpin"));

  $("aBody").addEventListener("input", () => {
    const n = $("aBody").value.length;
    $("charCount").textContent = `${n} / 5000`;
    $("charCount").style.color = n > 5000 ? "#b91c1c" : "";
  });

  document.querySelectorAll(".switch").forEach((sw) => sw.addEventListener("click", () => {
    if (sw.dataset.ch === "portal") return;
    sw.classList.toggle("on");
    setSwitchHiddenInputs();
  }));

  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
  ["mEdit", "mView", "mTemplates"].forEach((mid) => {
    const el = $(mid);
    if (el) el.addEventListener("click", (e) => { if (e.target.id === mid) closeModal(mid); });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show")); });

  $("rSearch").addEventListener("input", render);
  $("rFilter").addEventListener("change", render);

  $("btnExport").addEventListener("click", () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("view");
    const suffix = params.toString() ? `?${params.toString()}` : "";
    window.location.assign(`/admin/announcements/export.csv${suffix}`);
  });
  $("btnTemplates").addEventListener("click", () => { renderTemplates(); openModal("mTemplates"); });
  $("btnSettings").addEventListener("click", () => window.location.assign("/admin/settings?tab=communication"));
  $("btnRemind").addEventListener("click", () => {
    const source = getCurrentReceiptsSource();
    if (!source) return alert("Choose an announcement first.");
    const form = $("reminderForm");
    form.action = `/admin/announcements/${source.id}/remind`;
    form.submit();
  });

  setView(state.view);
})();

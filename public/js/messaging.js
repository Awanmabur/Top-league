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

  const MESSAGES = readJsonData("messagesData", []);
  const TEMPLATES = readJsonData("templatesData", []);
  if (!$('tbody')) return;

  const params = new URLSearchParams(window.location.search);
  const initialView = params.get("view");
  const requestedMessage = params.get("message");
  const state = {
    view: ["list", "delivery", "recipients"].includes(initialView) ? initialView : "list",
    selected: new Set(),
    recipientsSourceMessageId: MESSAGES.some((x) => x.id === requestedMessage) ? requestedMessage : (MESSAGES[0]?.id || null),
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

  function pillStatus(m) {
    if (m.status === "Sent") return '<span class="pill ok"><i class="fa-solid fa-paper-plane"></i> Sent</span>';
    if (m.status === "Scheduled") return '<span class="pill info"><i class="fa-solid fa-clock"></i> Scheduled</span>';
    if (m.status === "Draft") return '<span class="pill warn"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
    if (m.status === "Archived") return '<span class="pill info"><i class="fa-solid fa-box-archive"></i> Archived</span>';
    return '<span class="pill bad"><i class="fa-solid fa-circle-exclamation"></i> Failed</span>';
  }

  function pillPriority(m) {
    return m.important
      ? '<span class="pill pin"><i class="fa-solid fa-star"></i> Important</span>'
      : '<span class="pill info"><i class="fa-regular fa-star"></i> Normal</span>';
  }

  function chIcons(ch) {
    const safe = ch || { portal: true, email: false, sms: false, push: false };
    const on = (b) => (b ? "ok" : "info");
    return `
      <span class="pill ${on(safe.portal)}"><i class="fa-solid fa-globe"></i> Portal</span>
      <span class="pill ${on(safe.email)}"><i class="fa-solid fa-envelope"></i> Email</span>
      <span class="pill ${on(safe.sms)}"><i class="fa-solid fa-comment-sms"></i> SMS</span>
      <span class="pill ${on(safe.push)}"><i class="fa-solid fa-bell"></i> Push</span>`;
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
    $("view-delivery").style.display = v === "delivery" ? "" : "none";
    $("view-recipients").style.display = v === "recipients" ? "" : "none";
    const titles = {
      list: ["Messages", "Manage messages, schedules and delivery workflow."],
      delivery: ["Delivery", "Recipients, delivered, opened and failed metrics."],
      recipients: ["Recipients", "Track message delivery and opens per recipient."],
    };
    $("panelTitle").textContent = titles[v][0];
    $("panelSub").textContent = titles[v][1];
    syncBulkbar();
    render();
  }

  function renderList() {
    $("resultMeta").textContent = `${MESSAGES.length} message(s)`;
    $("checkAll").checked = MESSAGES.length > 0 && MESSAGES.every((x) => state.selected.has(x.id));
    $("tbody").innerHTML = MESSAGES.map((m) => {
      const checked = state.selected.has(m.id) ? "checked" : "";
      return `
        <tr data-id="${esc(m.id)}">
          <td><input type="checkbox" class="rowCheck" data-id="${esc(m.id)}" ${checked}></td>
          <td><div class="strong">${esc(m.subject)}</div><div class="muted">${pillPriority(m)}</div></td>
          <td><span class="pill info"><i class="fa-solid fa-tag"></i> ${esc(m.type || "General")}</span></td>
          <td><div class="strong">${esc(m.audType || "All Students")}</div><div class="muted">${esc(m.audVal || "—")}</div></td>
          <td>${chIcons(m.ch)}</td>
          <td class="muted">${esc(m.schedule || "—")}</td>
          <td>${pillStatus(m)}</td>
          <td><div class="actions">
            <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
            <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-xs actRecipients" type="button" title="Recipients"><i class="fa-solid fa-user-check"></i></button>
            <button class="btn-xs actSend" type="button" title="Send"><i class="fa-solid fa-paper-plane"></i></button>
            <button class="btn-xs actArchive" type="button" title="Archive"><i class="fa-solid fa-box-archive"></i></button>
            <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div></td>
        </tr>`;
    }).join("") || '<tr><td colspan="8" style="padding:18px;"><div class="muted">No messages found.</div></td></tr>';
  }

  function renderDelivery() {
    $("resultMeta").textContent = `${MESSAGES.length} message(s)`;
    $("tbodyEng").innerHTML = MESSAGES.map((m) => {
      const recipients = Number(m.stats?.recipients || 0);
      const delivered = Number(m.stats?.delivered || 0);
      const opened = Number(m.stats?.opened || 0);
      const failed = Number(m.stats?.failed || 0);
      const pct = recipients > 0 ? Math.round((delivered / recipients) * 100) : 0;
      return `
        <tr>
          <td><div class="strong">${esc(m.subject)}</div><div class="muted">${esc(m.type || "General")}</div></td>
          <td><span class="pill info"><i class="fa-solid fa-users"></i> ${recipients}</span></td>
          <td><span class="pill ok"><i class="fa-solid fa-paper-plane"></i> ${delivered}</span></td>
          <td><span class="pill info"><i class="fa-solid fa-envelope-open"></i> ${opened}</span></td>
          <td><span class="pill ${failed > 0 ? "bad" : "info"}"><i class="fa-solid fa-circle-exclamation"></i> ${failed}</span></td>
          <td><span class="pill ${pct >= 50 ? "ok" : "warn"}"><i class="fa-solid fa-chart-pie"></i> ${pct}%</span></td>
        </tr>`;
    }).join("") || '<tr><td colspan="6" style="padding:18px;"><div class="muted">No delivery data found.</div></td></tr>';
  }

  function getCurrentRecipientsSource() {
    return MESSAGES.find((x) => x.id === state.recipientsSourceMessageId) || MESSAGES[0] || null;
  }

  function renderRecipients() {
    const source = getCurrentRecipientsSource();
    const q = ($("rSearch").value || "").trim().toLowerCase();
    const f = $("rFilter").value;
    const list = ((source && source.recipients) || []).filter((r) => {
      const text = `${r.user || ""} ${r.email || ""} ${r.role || ""} ${r.status || ""}`.toLowerCase();
      return (!q || text.includes(q)) && (f === "all" || r.status === f);
    });
    $("resultMeta").textContent = source ? `${list.length} recipient(s) • ${source.subject}` : "0 recipient(s)";
    $("tbodyRec").innerHTML = list.map((r) => {
      const st = r.status === "Opened" ? "ok" : (r.status === "Delivered" ? "info" : (r.status === "Failed" ? "bad" : "warn"));
      return `<tr>
        <td><div class="strong">${esc(r.user || "—")}</div><div class="muted">${esc(r.email || "—")}</div></td>
        <td><span class="pill info"><i class="fa-solid fa-id-badge"></i> ${esc(r.role || "—")}</span></td>
        <td><span class="pill ${st}"><i class="fa-solid fa-circle"></i> ${esc(r.status || "Pending")}</span></td>
        <td class="muted">${esc(r.deliveredAt || "—")}</td>
        <td class="muted">${esc(r.openedAt || "—")}</td>
      </tr>`;
    }).join("") || '<tr><td colspan="5" style="padding:18px;"><div class="muted">No recipient records for this message.</div></td></tr>';
  }

  function renderTemplates() {
    const body = $("templatesBody");
    if (!body) return;
    body.innerHTML = TEMPLATES.map((t) => `
      <tr data-template-id="${esc(t.id)}">
        <td><div class="strong">${esc(t.name)}</div><div class="muted">${esc(t.subject)}</div></td>
        <td><span class="pill info">${esc(t.type || "General")}</span></td>
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
    if (state.view === "delivery") renderDelivery();
    if (state.view === "recipients") renderRecipients();
  }

  function setChannelHiddenInputs() {
    $("channelPortal").value = document.querySelector('.switch[data-ch="portal"]').classList.contains("on") ? "true" : "false";
    $("channelEmail").value = document.querySelector('.switch[data-ch="email"]').classList.contains("on") ? "true" : "false";
    $("channelSms").value = document.querySelector('.switch[data-ch="sms"]').classList.contains("on") ? "true" : "false";
    $("channelPush").value = document.querySelector('.switch[data-ch="push"]').classList.contains("on") ? "true" : "false";
  }

  function openEditor(pref) {
    pref = pref || null;
    $("mTitle").textContent = pref && pref.id ? "Edit Message" : "New Message";
    const form = $("messageForm");
    form.action = pref && pref.id ? `/admin/messaging/${encodeURIComponent(pref.id)}/update` : "/admin/messaging";
    $("mSubject").value = pref ? (pref.subject || "") : "";
    $("mType").value = pref ? (pref.type || "General") : "General";
    $("mPriority").value = pref && pref.important ? "Important" : "Normal";
    $("mAudienceType").value = pref ? (pref.audType || "All Students") : "All Students";
    $("mAudienceValue").value = pref ? (pref.audVal === "—" ? "" : (pref.audVal || "")) : "";
    $("mSenderName").value = pref ? (pref.senderName || "") : "";
    $("mBody").value = pref ? (pref.body || "") : "";
    $("mSendMode").value = pref && pref.id
      ? (pref.status === "Draft" ? "Save as Draft" : (pref.status === "Scheduled" ? "Schedule" : "Send Now"))
      : "Send Now";
    $("mScheduleAt").value = pref && pref.scheduleAtRaw ? pref.scheduleAtRaw : "";
    $("mReplyTo").value = pref ? (pref.replyTo || "") : "";
    const defaults = pref?.ch || { portal: true, email: false, sms: false, push: false };
    ["portal", "email", "sms", "push"].forEach((channel) => {
      const sw = document.querySelector(`.switch[data-ch="${channel}"]`);
      if (sw) sw.classList.toggle("on", !!defaults[channel]);
    });
    setChannelHiddenInputs();
    $("charCount").textContent = `${$("mBody").value.length} / 5000`;
    openModal("mEdit");
  }

  function openViewModal(m) {
    if (!m) return;
    $("vSubject").textContent = m.subject || "—";
    $("vType").textContent = m.type || "General";
    $("vAudience").textContent = m.audType || "All Students";
    $("vAudienceValue").textContent = m.audVal || "—";
    $("vStatus").textContent = m.status || "—";
    $("vPriority").textContent = m.important ? "Important" : "Normal";
    const channels = [];
    if (m.ch?.portal) channels.push("Portal");
    if (m.ch?.email) channels.push("Email");
    if (m.ch?.sms) channels.push("SMS");
    if (m.ch?.push) channels.push("Push");
    $("vChannels").textContent = channels.length ? channels.join(", ") : "—";
    $("vSchedule").textContent = m.schedule || "—";
    $("vBody").textContent = m.body || "—";
    openModal("mView");
  }

  $("btnCreate").addEventListener("click", () => openEditor());
  $("quickNotice").addEventListener("click", () => { openEditor(); $("mType").value = "Notice"; $("mSubject").value = "General Notice"; });
  $("quickReminder").addEventListener("click", () => { openEditor(); $("mType").value = "Reminder"; $("mSubject").value = "Payment Reminder"; });
  $("quickAlert").addEventListener("click", () => { openEditor(); $("mType").value = "Alert"; $("mSubject").value = "Urgent Alert"; $("mPriority").value = "Important"; });

  $("viewChips").addEventListener("click", (e) => { const btn = e.target.closest(".chip"); if (btn) setView(btn.dataset.view); });
  $("checkAll").addEventListener("change", (e) => { if (e.target.checked) MESSAGES.forEach((x) => state.selected.add(x.id)); else state.selected.clear(); render(); });
  $("tbody").addEventListener("change", (e) => { if (!e.target.classList.contains("rowCheck")) return; const id = e.target.dataset.id; if (e.target.checked) state.selected.add(id); else state.selected.delete(id); render(); });
  $("tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const item = MESSAGES.find((x) => x.id === tr.dataset.id);
    if (!item) return;
    if (e.target.closest(".actView")) return openViewModal(item);
    if (e.target.closest(".actEdit")) return openEditor(item);
    if (e.target.closest(".actRecipients")) { state.recipientsSourceMessageId = item.id; return setView("recipients"); }
    if (e.target.closest(".actSend")) return submitRowAction(`/admin/messaging/${encodeURIComponent(item.id)}/send`);
    if (e.target.closest(".actArchive")) return submitRowAction(`/admin/messaging/${encodeURIComponent(item.id)}/archive`);
    if (e.target.closest(".actDelete") && window.confirm(`Delete "${item.subject}"?`)) return submitRowAction(`/admin/messaging/${encodeURIComponent(item.id)}/delete`);
  });

  $("templatesBody")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-template-id]");
    if (!tr) return;
    const template = TEMPLATES.find((x) => x.id === tr.dataset.templateId);
    if (!template) return;
    if (e.target.closest(".useTemplate")) { closeModal("mTemplates"); return openEditor(template); }
    if (e.target.closest(".deleteTemplate") && window.confirm(`Delete template "${template.name}"?`)) {
      return submitRowAction(`/admin/messaging/templates/${encodeURIComponent(template.id)}/delete`);
    }
  });

  $("btnBulk").addEventListener("click", () => { if (!state.selected.size) return alert("Select at least one message."); $("bulkbar").classList.add("show"); });
  $("bulkClear").addEventListener("click", () => { state.selected.clear(); render(); });
  $("bulkSend").addEventListener("click", () => bulkSubmit("send"));
  $("bulkArchive").addEventListener("click", () => bulkSubmit("archive"));
  $("bulkDraft").addEventListener("click", () => bulkSubmit("draft"));

  $("mBody").addEventListener("input", () => { const n = $("mBody").value.length; $("charCount").textContent = `${n} / 5000`; $("charCount").style.color = n > 5000 ? "#b91c1c" : ""; });
  document.querySelectorAll(".switch").forEach((sw) => sw.addEventListener("click", () => { sw.classList.toggle("on"); setChannelHiddenInputs(); }));
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
  ["mEdit", "mView", "mTemplates"].forEach((mid) => { const el = $(mid); if (el) el.addEventListener("click", (e) => { if (e.target.id === mid) closeModal(mid); }); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show")); });
  $("rSearch").addEventListener("input", render);
  $("rFilter").addEventListener("change", render);

  $("btnExport").addEventListener("click", () => {
    const q = new URLSearchParams(window.location.search);
    q.delete("view"); q.delete("message");
    window.location.assign(`/admin/messaging/export.csv${q.toString() ? `?${q}` : ""}`);
  });
  $("btnTemplates").addEventListener("click", () => { renderTemplates(); openModal("mTemplates"); });
  $("btnSettings").addEventListener("click", () => window.location.assign("/admin/settings?tab=communication"));
  $("btnRemind").addEventListener("click", () => {
    const source = getCurrentRecipientsSource();
    if (!source) return alert("Choose a message first.");
    const form = $("reminderForm");
    form.action = `/admin/messaging/${encodeURIComponent(source.id)}/remind`;
    form.submit();
  });

  setView(state.view);
})();

(function () {
  const $ = (id) => document.getElementById(id);
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  };
  const icon = (className) => { const i = make("i"); i.className = className; return i; };

  function readJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try { return JSON.parse(el.value || JSON.stringify(fallback)); }
    catch (err) { console.error(`Failed to parse ${id}:`, err); return fallback; }
  }

  const ALL_USERS = readJson("usersData", []);
  if (!$('tbody')) return;
  const state = { selected: new Set(), q: "", status: "all", role: "all" };

  function openModal(id) { const el = $(id); if (el) el.classList.add("show"); }
  function closeModal(id) { const el = $(id); if (el) el.classList.remove("show"); }
  function closeAllModals() { document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show")); }

  function submitRowAction(actionUrl, fields) {
    const form = $("rowActionForm"); if (!form) return;
    form.action = actionUrl;
    form.querySelectorAll(".dyn").forEach((n) => n.remove());
    Object.entries(fields || {}).forEach(([key, value]) => {
      const input = make("input", "dyn"); input.type = "hidden"; input.name = key; input.value = value; form.appendChild(input);
    });
    form.submit();
  }
  function bulkSubmit(action) {
    const ids = Array.from(state.selected); if (!ids.length) return;
    $("bulkIds").value = ids.join(","); $("bulkActionInput").value = action; $("bulkForm").submit();
  }

  function pill(kind, iconClass, text) {
    const span = make("span", `pill ${kind}`); span.append(icon(iconClass), document.createTextNode(` ${text}`)); return span;
  }
  function statusPill(u) {
    if (u.status === "active") return pill("ok", "fa-solid fa-check", "Active");
    if (u.status === "invited") return pill("warn", "fa-solid fa-paper-plane", "Invited");
    return pill("bad", "fa-solid fa-ban", "Suspended");
  }
  function passwordPill(u) { return u.hasPassword ? pill("ok", "fa-solid fa-lock", "Set") : pill("warn", "fa-solid fa-key", "Pending"); }
  function linkedProfile(u) {
    const kind = u.profileKind || (u.staffId ? "Staff" : (u.studentId ? "Student" : "None"));
    if (kind === "Staff") return pill("info", "fa-solid fa-id-badge", "Staff");
    if (kind === "Student") return pill("info", "fa-solid fa-user-graduate", "Student");
    if (kind === "Parent") return pill("info", "fa-solid fa-people-roof", "Parent");
    if (kind === "Missing") return pill("bad", "fa-solid fa-triangle-exclamation", "Missing Link");
    return pill("info", "fa-regular fa-circle", "None");
  }
  function roleBadges(roles) {
    const wrap = make("div", "role-badges");
    const arr = Array.isArray(roles) ? roles : [];
    if (!arr.length) { wrap.appendChild(pill("info", "fa-solid fa-user-shield", "—")); return wrap; }
    arr.forEach((role) => wrap.appendChild(pill("info", "fa-solid fa-user-shield", role)));
    return wrap;
  }
  function actionButton(cls, title, iconClass) {
    const button = make("button", `btn-xs ${cls}`); button.type = "button"; button.title = title; button.appendChild(icon(iconClass)); return button;
  }

  function getFilteredUsers() {
    return ALL_USERS.filter((u) => {
      const hay = [u.fullName,u.firstName,u.lastName,u.email,u.phone,...(u.roles || []),u.status].join(" ").toLowerCase();
      return (!state.q || hay.includes(state.q)) && (state.status === "all" || u.status === state.status) && (state.role === "all" || (u.roles || []).includes(state.role));
    });
  }
  function syncBulkbar(users) {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
    $("resultMeta").textContent = `${users.length} user(s)`;
    $("checkAll").checked = users.length > 0 && users.every((u) => state.selected.has(u.id));
  }

  function render() {
    const users = getFilteredUsers(); const tbody = $("tbody"); tbody.replaceChildren();
    if (!users.length) {
      const tr=make("tr"), td=make("td"); td.colSpan=9; td.style.padding="18px"; td.appendChild(make("div","muted","No users found.")); tr.appendChild(td); tbody.appendChild(tr); syncBulkbar(users); return;
    }
    users.forEach((u) => {
      const tr=make("tr"); tr.dataset.id=String(u.id || "");
      const c1=make("td"), cb=make("input","rowCheck"); cb.type="checkbox"; cb.dataset.id=tr.dataset.id; cb.checked=state.selected.has(tr.dataset.id); c1.appendChild(cb);
      const c2=make("td"); c2.appendChild(make("div","strong",u.fullName || "—"));
      const c3=make("td"); c3.append(make("div","",u.email || "—"), make("div","muted",u.phone || "—"));
      const c4=make("td"); c4.appendChild(roleBadges(u.roles));
      const c5=make("td"); c5.appendChild(passwordPill(u));
      const c6=make("td"); c6.appendChild(statusPill(u));
      const c7=make("td"); c7.appendChild(linkedProfile(u));
      const c8=make("td","muted",u.createdAt || "—");
      const c9=make("td"), actions=make("div","actions");
      actions.append(actionButton("actView","View","fa-solid fa-eye"),actionButton("actResend","Resend Invite","fa-solid fa-paper-plane"),actionButton("actActivate","Activate","fa-solid fa-check"),actionButton("actSuspend","Suspend","fa-solid fa-ban"),actionButton("actDelete","Delete","fa-solid fa-trash")); c9.appendChild(actions);
      tr.append(c1,c2,c3,c4,c5,c6,c7,c8,c9); tbody.appendChild(tr);
    });
    syncBulkbar(users);
  }

  function resetForm() {
    $("mTitle").textContent="Create User"; $("userForm").action="/admin/users";
    ["uFirstName","uLastName","uPhone","uEmail","uRole","uStaffProfileId","uStudentProfileId","uParentProfileId"].forEach((id)=>{ if($(id)) $(id).value=""; });
    toggleRoleFields();
  }
  function toggleRoleFields() {
    const role=$("uRole")?.value || "";
    if($("studentFields")) $("studentFields").style.display=role === "student" ? "" : "none";
    if($("parentFields")) $("parentFields").style.display=role === "parent" ? "" : "none";
    if($("staffProfileWrap")) $("staffProfileWrap").style.display=["staff","lecturer"].includes(role) ? "" : "none";
  }
  function openView(u) {
    $("vName").textContent=u.fullName || "—"; $("vEmail").textContent=u.email || "—"; $("vPhone").textContent=u.phone || "—"; $("vStatus").textContent=u.status || "—"; $("vRoles").textContent=u.rolesText || "—"; $("vPassword").textContent=u.hasPassword ? "Password Set" : "Password Pending"; $("vLinked").textContent = u.profileKind && u.profileKind !== "None" ? `${u.profileKind} Profile` : "None"; $("vCreated").textContent=u.createdAt || "—"; openModal("mView");
  }
  function fallbackCopy(el) { el.focus(); el.select(); el.setSelectionRange(0,999999); document.execCommand("copy"); window.alert("Invite link copied."); }
  function copyInviteLink() {
    const el=$("inviteLinkBox"); if(!el?.value) return;
    if(navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(el.value).then(()=>window.alert("Invite link copied.")).catch(()=>fallbackCopy(el)); return; }
    fallbackCopy(el);
  }

  $("btnCreate")?.addEventListener("click",()=>{resetForm();openModal("mEdit");});
  $("quickStaff")?.addEventListener("click",()=>{resetForm();$("uRole").value="staff";toggleRoleFields();openModal("mEdit");});
  $("quickStudent")?.addEventListener("click",()=>{resetForm();$("uRole").value="student";toggleRoleFields();openModal("mEdit");});
  $("uRole")?.addEventListener("change",toggleRoleFields);
  $("q")?.addEventListener("input",(e)=>{state.q=String(e.target.value||"").trim().toLowerCase();render();});
  $("filterStatus")?.addEventListener("change",(e)=>{state.status=e.target.value||"all";render();});
  $("filterRole")?.addEventListener("change",(e)=>{state.role=e.target.value||"all";render();});
  $("btnResetFilters")?.addEventListener("click",()=>{state.q="";state.status="all";state.role="all";$("q").value="";$("filterStatus").value="all";$("filterRole").value="all";render();});
  $("checkAll")?.addEventListener("change",(e)=>{const users=getFilteredUsers(); if(e.target.checked) users.forEach((u)=>state.selected.add(u.id)); else users.forEach((u)=>state.selected.delete(u.id)); render();});
  $("tbody")?.addEventListener("change",(e)=>{if(!e.target.classList.contains("rowCheck")) return; const id=e.target.dataset.id; e.target.checked ? state.selected.add(id) : state.selected.delete(id); render();});
  $("tbody")?.addEventListener("click",(e)=>{const tr=e.target.closest("tr[data-id]"); if(!tr)return; const u=ALL_USERS.find((x)=>x.id===tr.dataset.id); if(!u)return; if(e.target.closest(".actView"))return openView(u); if(e.target.closest(".actResend"))return submitRowAction(`/admin/users/${encodeURIComponent(u.id)}/resend-invite`); if(e.target.closest(".actActivate"))return submitRowAction(`/admin/users/${encodeURIComponent(u.id)}/status`,{status:"active"}); if(e.target.closest(".actSuspend"))return submitRowAction(`/admin/users/${encodeURIComponent(u.id)}/status`,{status:"suspended"}); if(e.target.closest(".actDelete") && window.confirm(`Delete "${u.fullName}"?`)) return submitRowAction(`/admin/users/${encodeURIComponent(u.id)}/delete`);});
  $("btnBulk")?.addEventListener("click",()=>{if(!state.selected.size)return window.alert("Select at least one user.");$("bulkbar").classList.add("show");});
  $("bulkActivate")?.addEventListener("click",()=>bulkSubmit("activate")); $("bulkSuspend")?.addEventListener("click",()=>bulkSubmit("suspend")); $("bulkDelete")?.addEventListener("click",()=>{if(window.confirm("Delete selected users?"))bulkSubmit("delete");}); $("bulkClear")?.addEventListener("click",()=>{state.selected.clear();render();});
  $("btnCopyInvite")?.addEventListener("click",copyInviteLink);
  document.querySelectorAll("[data-close-modal]").forEach((btn)=>btn.addEventListener("click",()=>closeModal(btn.dataset.closeModal)));
  ["mEdit","mView","mInvite"].forEach((id)=>$(id)?.addEventListener("click",(e)=>{if(e.target.id===id)closeModal(id);}));
  document.addEventListener("keydown",(e)=>{if(e.key==="Escape")closeAllModals();});
  toggleRoleFields(); render();
  const openModalName=readJson("openModalData",null); if(openModalName)openModal(openModalName);
})();

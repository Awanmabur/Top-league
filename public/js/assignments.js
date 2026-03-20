 
(() => {
  const $ = (id) => document.getElementById(id);

  const grid = $("assignmentGrid");
  const modal = $("assignModal");
  const form = $("assignForm");
  const importModal = $("importModal");

  const publishForm = $("publishForm");
  const archiveForm = $("archiveForm");
  const deleteForm = $("deleteForm");
  const bulkForm = $("bulkForm");
  const bulkActionVal = $("bulkActionVal");
  const bulkIdsVal = $("bulkIdsVal");

  const toolsMenu = $("toolsMenu");
  const selectAll = $("selectAll");

  const mTabs = $("mTabs");

  const pv = {
    title: $("pvTitle"),
    course: $("pvCourse"),
    due: $("pvDue"),
    points: $("pvPoints"),
    status: $("pvStatus"),
    instr: $("pvInstr"),
    rubric: $("pvRubric"),
    attach: $("pvAttach"),
  };

  if (!grid || !modal || !form) {
    console.error("Assignments: Missing required DOM elements.");
    return;
  }

  let currentId = null;

  const open = (el) => { el.style.display = "flex"; el.setAttribute("aria-hidden","false"); document.body.style.overflow = "hidden"; };
  const close = (el) => { el.style.display = "none"; el.setAttribute("aria-hidden","true"); document.body.style.overflow = ""; };

  const splitList = (s) => String(s || "").split("||").map(x => x.trim()).filter(Boolean);
  const escape = (s) => String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const closeAllMenus = () => {
    document.querySelectorAll(".menu-panel").forEach(p => p.classList.remove("show"));
  };

  const setTab = (name) => {
    document.querySelectorAll("#mTabs .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    ["basic","rubric","attach"].forEach(k => {
      const el = document.getElementById("tab-" + k);
      if (el) el.style.display = (k === name) ? "" : "none";
    });
  };

  const clearPreview = () => {
    currentId = null;
    document.querySelectorAll(".acard").forEach(c => c.classList.remove("selected"));
    pv.title.textContent = "—";
    pv.course.textContent = "—";
    pv.due.textContent = "—";
    pv.points.textContent = "—";
    pv.status.textContent = "—";
    pv.instr.textContent = "—";
    pv.rubric.textContent = "—";
    pv.attach.textContent = "—";
  };

  const previewCard = (card) => {
    if (!card) return;
    currentId = card.dataset.id;

    document.querySelectorAll(".acard").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");

    pv.title.textContent = card.dataset.title || "—";
    pv.course.textContent = card.dataset.coursename || "—";
    pv.due.textContent = card.dataset.duedate ? card.dataset.duedate.replace("T"," ") : "—";
    pv.points.textContent = String(card.dataset.points || "—");
    pv.status.textContent = card.dataset.status || "—";
    pv.instr.textContent = card.dataset.instructions || "—";
    pv.rubric.textContent = (card.dataset.rubric || "—").replace(/\\n/g,"\n");
    const at = splitList(card.dataset.attachments);
    pv.attach.textContent = at.length ? at.join(", ") : "—";
  };

  const fillHiddenList = (wrapId, inputName, values) => {
    const wrap = $(wrapId);
    if (!wrap) return;
    wrap.innerHTML = "";
    values.forEach(v => {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = inputName; // "attachments[]"
      inp.value = v;
      wrap.appendChild(inp);
    });
  };

  const openForCreate = () => {
    $("assignModalTitle").textContent = "New Assignment";
    form.action = "/admin/assignments";

    $("mTitle").value = "";
    $("mCourse").value = "";
    $("mDue").value = "";
    $("mPoints").value = "100";
    $("mStatus").value = "draft";
    $("mInstr").value = "";
    $("mRubric").value = "";
    $("mAttach").value = "";
    $("mAttachWrap").innerHTML = "";

    setTab("basic");
    open(modal);
  };

  const openForEdit = (card) => {
    if (!card) return;
    $("assignModalTitle").textContent = "Edit Assignment";
    form.action = `/admin/assignments/${encodeURIComponent(card.dataset.id)}`;

    $("mTitle").value = card.dataset.title || "";
    $("mCourse").value = card.dataset.courseid || "";
    $("mDue").value = card.dataset.duedate || "";
    $("mPoints").value = String(card.dataset.points || "100");
    $("mStatus").value = card.dataset.status || "draft";
    $("mInstr").value = card.dataset.instructions || "";
    $("mRubric").value = (card.dataset.rubric || "").replace(/\\n/g,"\n");

    const at = splitList(card.dataset.attachments).join("\n");
    $("mAttach").value = at;
    $("mAttachWrap").innerHTML = "";

    setTab("basic");
    open(modal);
  };

  const saveAssign = () => {
    const title = $("mTitle").value.trim();
    const course = $("mCourse").value.trim();

    if (!title) return alert("Title is required.");
    if (!course) return alert("Course is required.");

    const attachments = $("mAttach").value
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 30);

    fillHiddenList("mAttachWrap", "attachments[]", attachments);
    form.submit();
  };

  const selectedIds = () =>
    Array.from(document.querySelectorAll(".selChk"))
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.id);

  const bulkSubmit = (action) => {
    if (!bulkForm || !bulkActionVal || !bulkIdsVal) return alert("Bulk form missing.");
    const ids = selectedIds();
    if (!ids.length) return alert("Select at least one assignment.");
    if (!confirm(`Apply "${action}" to ${ids.length} selected assignment(s)?`)) return;
    bulkActionVal.value = action;
    bulkIdsVal.value = ids.join(",");
    bulkForm.submit();
  };

  const postAction = (formEl, url, confirmMsg) => {
    if (!formEl) return alert("Action form missing.");
    if (confirmMsg && !confirm(confirmMsg)) return;
    formEl.action = url;
    formEl.submit();
  };

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn) {
      const action = btn.dataset.action;

      if (action !== "toggleRowMenu" && action !== "toggleTools") closeAllMenus();

      if (action === "openAssign") return openForCreate();
      if (action === "closeAssign") return close(modal);
      if (action === "saveAssign") return saveAssign();

      if (action === "clearPreview") return clearPreview();

      if (action === "toggleTools") {
        if (!toolsMenu) return;
        toolsMenu.classList.toggle("show");
        return;
      }
      if (action === "openImport") return open(importModal);
      if (action === "closeImport") return close(importModal);

      if (action === "toggleRowMenu") {
        const id = btn.dataset.id;
        const panel = document.getElementById("rowMenu-" + id);
        if (!panel) return;
        document.querySelectorAll(".menu-panel").forEach(p => { if (p !== panel && p !== toolsMenu) p.classList.remove("show"); });
        panel.classList.toggle("show");
        return;
      }

      if (action === "viewAssign") {
        const card = document.querySelector(`.acard[data-id="${CSS.escape(btn.dataset.id)}"]`);
        return previewCard(card);
      }
      if (action === "editAssign") {
        const card = document.querySelector(`.acard[data-id="${CSS.escape(btn.dataset.id)}"]`);
        return openForEdit(card);
      }

      if (action === "publishAssign") return postAction(publishForm, `/admin/assignments/${encodeURIComponent(btn.dataset.id)}/publish`, "Publish this assignment?");
      if (action === "unpublishAssign") return postAction(publishForm, `/admin/assignments/${encodeURIComponent(btn.dataset.id)}/unpublish`, "Unpublish this assignment?");
      if (action === "archiveAssign") return postAction(archiveForm, `/admin/assignments/${encodeURIComponent(btn.dataset.id)}/archive`, "Archive this assignment?");
      if (action === "deleteAssign") return postAction(deleteForm, `/admin/assignments/${encodeURIComponent(btn.dataset.id)}/delete`, "Delete this assignment permanently?");

      if (action === "editCurrent") {
        if (!currentId) return alert("Select an assignment first.");
        const card = document.querySelector(`.acard[data-id="${CSS.escape(currentId)}"]`);
        return openForEdit(card);
      }
      if (action === "publishCurrent") {
        if (!currentId) return alert("Select an assignment first.");
        return postAction(publishForm, `/admin/assignments/${encodeURIComponent(currentId)}/publish`, "Publish this assignment?");
      }
      if (action === "archiveCurrent") {
        if (!currentId) return alert("Select an assignment first.");
        return postAction(archiveForm, `/admin/assignments/${encodeURIComponent(currentId)}/archive`, "Archive this assignment?");
      }
      if (action === "deleteCurrent") {
        if (!currentId) return alert("Select an assignment first.");
        return postAction(deleteForm, `/admin/assignments/${encodeURIComponent(currentId)}/delete`, "Delete this assignment permanently?");
      }

      if (action === "bulkPublish") return bulkSubmit("publish");
      if (action === "bulkArchive") return bulkSubmit("archive");
    }

    // modal tabs
    const tab = e.target.closest("#mTabs .tab");
    if (tab) return setTab(tab.dataset.tab);

    // clicking card previews it
    const card = e.target.closest(".acard");
    if (card) previewCard(card);

    // click outside menus closes them
    if (!e.target.closest(".menu")) {
      toolsMenu?.classList.remove("show");
      document.querySelectorAll(".menu-panel").forEach(p => p.classList.remove("show"));
    }
  });

  // select all
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      document.querySelectorAll(".selChk").forEach(cb => cb.checked = selectAll.checked);
      $("selCount").textContent = String(selectedIds().length);
    });
  }

  // selection count updates
  document.addEventListener("change", (e) => {
    if (e.target.classList?.contains("selChk")) {
      $("selCount").textContent = String(selectedIds().length);
    }
  });

  // backdrop closes
  modal.addEventListener("click", (e) => { if (e.target === modal) close(modal); });
  importModal.addEventListener("click", (e) => { if (e.target === importModal) close(importModal); });

  // esc closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close(modal); close(importModal);
      toolsMenu?.classList.remove("show");
      closeAllMenus();
    }
  });

  // preview first
  const first = document.querySelector(".acard");
  if (first) previewCard(first);
  else clearPreview();
})();

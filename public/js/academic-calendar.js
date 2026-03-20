(() => {
  const $ = (id) => document.getElementById(id);

  const grid = $("eventGrid");
  const modal = $("eventModal");
  const form = $("eventForm");

  const importModal = $("importModal");

  const archiveForm = $("archiveForm");
  const deleteForm = $("deleteForm");
  const bulkForm = $("bulkForm");
  const bulkIdsVal = $("bulkIdsVal");

  const toolsMenu = $("toolsMenu");

  const selectAll = $("selectAll");

  const pv = {
    title: $("pvTitle"),
    type: $("pvType"),
    yt: $("pvYT"),
    dates: $("pvDates"),
    status: $("pvStatus"),
    location: $("pvLocation"),
    notes: $("pvNotes"),
  };

  if (!grid || !modal || !form) {
    console.error("Academic Calendar: Missing required DOM elements.");
    return;
  }

  let currentId = null;

  const open = (el) => { el.style.display = "flex"; el.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; };
  const close = (el) => { el.style.display = "none"; el.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; };

  const escape = (s) => String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

  const badgeText = (status) => {
    if (status === "active") return "Active";
    if (status === "archived") return "Archived";
    return "Draft";
  };

  const clearPreview = () => {
    currentId = null;
    document.querySelectorAll(".ec").forEach(c => c.classList.remove("selected"));
    pv.title.textContent = "—";
    pv.type.textContent = "—";
    pv.yt.textContent = "—";
    pv.dates.textContent = "—";
    pv.status.textContent = "—";
    pv.location.textContent = "—";
    pv.notes.textContent = "—";
  };

  const previewCard = (card) => {
    if (!card) return;

    currentId = card.dataset.id;

    document.querySelectorAll(".ec").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");

    const title = card.dataset.title || "—";
    const type = card.dataset.type || "—";
    const year = card.dataset.academicyear || "—";
    const term = card.dataset.term || "—";
    const start = card.dataset.start || "—";
    const end = card.dataset.end || "";
    const status = card.dataset.status || "draft";
    const location = card.dataset.location || "—";
    const notes = card.dataset.notes || "—";

    pv.title.textContent = title;
    pv.type.textContent = type;
    pv.yt.textContent = `${year} • ${term}`;
    pv.dates.textContent = end ? `${start} → ${end}` : start;
    pv.status.textContent = badgeText(status);
    pv.location.textContent = location || "—";
    pv.notes.textContent = notes || "—";
  };

  const openForCreate = () => {
    $("eventModalTitle").textContent = "Add Event";
    form.action = "/admin/academic-calendar";

    $("mTitle").value = "";
    $("mType").value = "";
    $("mYear").value = "";
    $("mTerm").value = "";
    $("mStart").value = "";
    $("mEnd").value = "";
    $("mStatus").value = "draft";
    $("mLocation").value = "";
    $("mNotes").value = "";

    open(modal);
  };

  const openForEdit = (card) => {
    if (!card) return;

    $("eventModalTitle").textContent = "Edit Event";
    form.action = `/admin/academic-calendar/${encodeURIComponent(card.dataset.id)}`;

    $("mTitle").value = card.dataset.title || "";
    $("mType").value = card.dataset.type || "";
    $("mYear").value = card.dataset.academicyear || "";
    $("mTerm").value = card.dataset.term || "";
    $("mStart").value = card.dataset.start || "";
    $("mEnd").value = card.dataset.end || "";
    $("mStatus").value = card.dataset.status || "draft";
    $("mLocation").value = card.dataset.location || "";
    $("mNotes").value = card.dataset.notes || "";

    open(modal);
  };

  const archiveEvent = (id) => {
    if (!archiveForm) return alert("Archive form missing.");
    if (!confirm("Archive this event?")) return;
    archiveForm.action = `/admin/academic-calendar/${encodeURIComponent(id)}/archive`;
    archiveForm.submit();
  };

  const deleteEvent = (id) => {
    if (!deleteForm) return alert("Delete form missing.");
    if (!confirm("Delete this event permanently?")) return;
    deleteForm.action = `/admin/academic-calendar/${encodeURIComponent(id)}/delete`;
    deleteForm.submit();
  };

  const saveEvent = () => {
    const title = $("mTitle").value.trim();
    const type = $("mType").value.trim();
    const start = $("mStart").value.trim();

    if (!title) return alert("Title is required.");
    if (!type) return alert("Type is required.");
    if (!start) return alert("Start date is required.");

    form.submit();
  };

  const selectedIds = () =>
    Array.from(document.querySelectorAll(".selChk"))
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.id);

  const bulkArchive = () => {
    if (!bulkForm || !bulkIdsVal) return alert("Bulk form missing.");
    const ids = selectedIds();
    if (!ids.length) return alert("Select at least one event.");
    if (!confirm(`Archive ${ids.length} selected event(s)?`)) return;
    bulkIdsVal.value = ids.join(",");
    bulkForm.submit();
  };

  const closeAllRowMenus = () => {
    document.querySelectorAll(".menu-panel").forEach(m => {
      if (m.id !== "toolsMenu") m.classList.remove("show");
    });
  };

  const toggleToolsMenu = () => {
    if (!toolsMenu) return;
    toolsMenu.classList.toggle("show");
  };

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn) {
      const action = btn.dataset.action;

      if (action !== "toggleRowMenu") closeAllRowMenus();

      if (action === "openEvent") return openForCreate();
      if (action === "closeEvent") return close(modal);
      if (action === "saveEvent") return saveEvent();

      if (action === "clearPreview") return clearPreview();

      if (action === "editCurrent") {
        if (!currentId) return alert("Select an event first.");
        const card = document.querySelector(`.ec[data-id="${CSS.escape(currentId)}"]`);
        return openForEdit(card);
      }
      if (action === "archiveCurrent") {
        if (!currentId) return alert("Select an event first.");
        return archiveEvent(currentId);
      }
      if (action === "deleteCurrent") {
        if (!currentId) return alert("Select an event first.");
        return deleteEvent(currentId);
      }

      if (action === "viewEvent") {
        const card = document.querySelector(`.ec[data-id="${CSS.escape(btn.dataset.id)}"]`);
        return previewCard(card);
      }
      if (action === "editEvent") {
        const card = document.querySelector(`.ec[data-id="${CSS.escape(btn.dataset.id)}"]`);
        return openForEdit(card);
      }

      if (action === "toggleRowMenu") {
        const id = btn.dataset.id;
        const panel = document.getElementById(`rowMenu-${id}`);
        if (!panel) return;
        // close others
        closeAllRowMenus();
        panel.classList.toggle("show");
        return;
      }

      if (action === "archiveEvent") return archiveEvent(btn.dataset.id);
      if (action === "deleteEvent") return deleteEvent(btn.dataset.id);

      if (action === "toggleTools") return toggleToolsMenu();
      if (action === "openImport") { closeAllRowMenus(); close(toolsMenu); open(importModal); return; }
      if (action === "closeImport") return close(importModal);

      if (action === "bulkApply") { closeAllRowMenus(); return bulkArchive(); }
    }

    // click card previews
    const card = e.target.closest(".ec");
    if (card) previewCard(card);

    // click outside menus closes
    if (!e.target.closest(".menu")) {
      closeAllRowMenus();
      toolsMenu?.classList.remove("show");
    }
  });

  // Select all
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      document.querySelectorAll(".selChk").forEach(cb => cb.checked = selectAll.checked);
      $("selCount").textContent = String(selectedIds().length);
    });
  }

  // checkbox count
  document.addEventListener("change", (e) => {
    if (e.target.classList?.contains("selChk")) {
      $("selCount").textContent = String(selectedIds().length);
    }
  });

  // Backdrop click close
  modal.addEventListener("click", (e) => { if (e.target === modal) close(modal); });
  importModal?.addEventListener("click", (e) => { if (e.target === importModal) close(importModal); });

  // ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close(modal);
      if (importModal) close(importModal);
      toolsMenu?.classList.remove("show");
      closeAllRowMenus();
    }
  });

  // Auto preview first card
  const first = document.querySelector(".ec");
  if (first) previewCard(first);
})();

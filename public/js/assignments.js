(() => {
  const $ = (id) => document.getElementById(id);
  const BASE_PATH = "/admin/assignments";

  function readJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.value || el.textContent || JSON.stringify(fallback));
    } catch (err) {
      console.error("Failed to parse JSON:", id, err);
      return fallback;
    }
  }

  const ASSIGNMENTS = readJson("assignmentsData", []);
  if (!$("tbodyAssignments")) return;

  const state = { selected: new Set(), currentViewId: ASSIGNMENTS[0]?.id || null };

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("show");
    if (!document.querySelector(".modal-backdrop.show")) document.body.style.overflow = "";
  }

  function findItem(id) {
    return ASSIGNMENTS.find((x) => x.id === id) || null;
  }

  function statusPill(status) {
    if (status === "published") return '<span class="pill ok"><i class="fa-solid fa-eye"></i> Published</span>';
    if (status === "archived") return '<span class="pill bad"><i class="fa-solid fa-box-archive"></i> Archived</span>';
    if (status === "closed") return '<span class="pill info"><i class="fa-solid fa-lock"></i> Closed</span>';
    return '<span class="pill warn"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function renderTable() {
    $("tbodyAssignments").innerHTML =
      ASSIGNMENTS.map((a) => {
        const checked = state.selected.has(a.id) ? "checked" : "";
        const primaryAction = a.status === "published" ? "unpublish" : "publish";
        const primaryIcon = a.status === "published" ? "fa-eye-slash" : "fa-eye";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(a.id)}">
            <td class="col-check"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(a.id)}" ${checked}></td>
            <td class="col-assignment">
              <div class="item-main">
                <div class="item-title" title="${escapeHtml(a.title || "-")}">${escapeHtml(a.title || "-")}</div>
                <div class="item-sub">${escapeHtml((a.instructions || "").slice(0, 90) || "No instructions")}</div>
              </div>
            </td>
            <td class="col-subject"><span class="cell-ellipsis">${escapeHtml(a.courseName || "-")}</span></td>
            <td class="col-class"><span class="cell-ellipsis">${escapeHtml(a.className || "-")}</span></td>
            <td class="col-section"><span class="cell-ellipsis">${escapeHtml(a.sectionName || "Whole Class")}</span></td>
            <td class="col-stream"><span class="cell-ellipsis">${escapeHtml(a.streamName || "All Streams")}</span></td>
            <td class="col-due"><span class="cell-ellipsis">${escapeHtml(a.dueDisplay || "-")}</span></td>
            <td class="col-points"><span class="cell-ellipsis">${escapeHtml(String(a.totalPoints ?? 100))}</span></td>
            <td class="col-status">${statusPill(a.status)}</td>
            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actPrimary" type="button" title="${escapeHtml(primaryAction)}" data-next="${escapeHtml(primaryAction)}"><i class="fa-solid ${primaryIcon}"></i></button>
                <button class="btn-xs actArchive" type="button" title="Archive"><i class="fa-solid fa-box-archive"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") || `<tr><td colspan="10" style="padding:18px;"><div class="muted">No assignments found.</div></td></tr>`;

    $("checkAll").checked = ASSIGNMENTS.length > 0 && ASSIGNMENTS.every((a) => state.selected.has(a.id));
    syncBulkbar();
  }

  function fillHiddenAttachments(values) {
    const wrap = $("mAttachWrap");
    if (!wrap) return;
    wrap.innerHTML = "";
    values.forEach((value) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "attachments[]";
      input.value = value;
      wrap.appendChild(input);
    });
  }

  function refreshAcademicSelector() {
    window.AcademicSelector?.refresh(document);
  }

  function applyAcademicSelection(item) {
    refreshAcademicSelector();
    $("mClassGroup").value = item?.classId || "";
    refreshAcademicSelector();
    $("mSection").value = item?.sectionId || "";
    $("mStream").value = item?.streamId || "";
    $("mCourse").value = item?.courseId || "";
    refreshAcademicSelector();
  }

  function openEditor(item, statusOverride) {
    const a = item || null;
    $("mTitleBar").textContent = a ? "Edit Assignment" : "Add Assignment";
    $("assignForm").action = a ? `${BASE_PATH}/${encodeURIComponent(a.id)}` : BASE_PATH;

    $("mTitle").value = a?.title || "";
    $("mDue").value = a?.dueDate || "";
    $("mPoints").value = String(a?.totalPoints ?? 100);
    $("mStatus").value = statusOverride || a?.status || "draft";
    $("mInstr").value = a?.instructions || "";
    $("mRubric").value = a?.rubric || "";
    $("mAttach").value = Array.isArray(a?.attachments) ? a.attachments.join("\n") : "";
    fillHiddenAttachments([]);

    applyAcademicSelection(a);
    openModal("mEdit");
  }

  function openView(item) {
    if (!item) return;
    state.currentViewId = item.id;

    $("vTitle").textContent = item.title || "-";
    $("vCourse").textContent = item.courseName || "-";
    $("vClass").textContent = item.className || "-";
    $("vSection").textContent = item.sectionName || "Whole Class";
    $("vStream").textContent = item.streamName || "All Streams";
    $("vDue").textContent = item.dueDisplay || "-";
    $("vPoints").textContent = String(item.totalPoints ?? 100);
    $("vStatus").innerHTML = statusPill(item.status);
    $("vInstr").textContent = item.instructions || "-";
    $("vRubric").textContent = item.rubric || "-";
    $("vAttach").textContent = Array.isArray(item.attachments) && item.attachments.length ? item.attachments.join("\n") : "-";
    $("viewPublishBtn").textContent = item.status === "published" ? "Draft" : "Publish";

    openModal("mView");
  }

  function submitAction(url, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const form = $("rowActionForm");
    form.action = url;
    form.submit();
  }

  function saveAssignment() {
    if (!$("mTitle").value.trim()) return alert("Title is required.");
    if (!$("mCourse").value.trim()) return alert("Subject is required.");

    const attachments = $("mAttach").value
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 30);

    fillHiddenAttachments(attachments);
    $("assignForm").submit();
  }

  function selectedIds() {
    return Array.from(state.selected);
  }

  function submitBulk(action) {
    const ids = selectedIds();
    if (!ids.length) return alert("Select at least one assignment.");
    if (!window.confirm(`Apply ${action} to ${ids.length} assignment(s)?`)) return;
    $("bulkActionField").value = action;
    $("bulkIdsField").value = ids.join(",");
    $("bulkForm").submit();
  }

  $("btnCreate").addEventListener("click", () => openEditor());
  $("quickDraft").addEventListener("click", () => openEditor(null, "draft"));
  $("quickPublished").addEventListener("click", () => openEditor(null, "published"));
  $("btnImport").addEventListener("click", () => openModal("mImport"));
  $("btnPrint").addEventListener("click", () => window.print());
  $("saveBtn").addEventListener("click", saveAssignment);
  $("btnBulk").addEventListener("click", () => {
    if (!state.selected.size) return alert("Select at least one assignment.");
    $("bulkbar").classList.add("show");
  });

  $("bulkPublish").addEventListener("click", () => submitBulk("publish"));
  $("bulkUnpublish").addEventListener("click", () => submitBulk("unpublish"));
  $("bulkClose").addEventListener("click", () => submitBulk("close"));
  $("bulkArchive").addEventListener("click", () => submitBulk("archive"));
  $("bulkClear").addEventListener("click", () => {
    state.selected.clear();
    renderTable();
  });

  $("checkAll").addEventListener("change", (event) => {
    if (event.target.checked) ASSIGNMENTS.forEach((a) => state.selected.add(a.id));
    else ASSIGNMENTS.forEach((a) => state.selected.delete(a.id));
    renderTable();
  });

  $("tbodyAssignments").addEventListener("change", (event) => {
    if (!event.target.classList.contains("rowCheck")) return;
    const id = event.target.dataset.id;
    if (event.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyAssignments").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;
    const item = findItem(row.dataset.id);
    if (!item) return;

    if (event.target.closest(".rowCheck")) return;
    if (event.target.closest(".actView")) return openView(item);
    if (event.target.closest(".actEdit")) return openEditor(item);
    if (event.target.closest(".actPrimary")) {
      const action = event.target.closest(".actPrimary").dataset.next;
      return submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/${action}`, `${action === "publish" ? "Publish" : "Unpublish"} this assignment?`);
    }
    if (event.target.closest(".actArchive")) return submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/archive`, "Archive this assignment?");
    if (event.target.closest(".actDelete")) return submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/delete`, "Delete this assignment?");

    openView(item);
  });

  $("viewEditBtn").addEventListener("click", () => {
    const item = findItem(state.currentViewId);
    if (!item) return;
    closeModal("mView");
    openEditor(item);
  });
  $("viewPublishBtn").addEventListener("click", () => {
    const item = findItem(state.currentViewId);
    if (!item) return;
    const action = item.status === "published" ? "unpublish" : "publish";
    submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/${action}`, `${action === "publish" ? "Publish" : "Unpublish"} this assignment?`);
  });
  $("viewArchiveBtn").addEventListener("click", () => {
    const item = findItem(state.currentViewId);
    if (!item) return;
    submitAction(`${BASE_PATH}/${encodeURIComponent(item.id)}/archive`, "Archive this assignment?");
  });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  ["mEdit", "mView", "mImport"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("click", (event) => {
      if (event.target.id === id) closeModal(id);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show"));
      document.body.style.overflow = "";
    }
  });

  renderTable();
})();

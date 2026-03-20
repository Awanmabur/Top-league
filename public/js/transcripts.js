(function () {
  const $ = (id) => document.getElementById(id);

  const trModal = $("trModal");
  const trModalTitle = $("trModalTitle");
  const trForm = $("trForm");

  const mId = $("mId");
  const mStatus = $("mStatus");
  const mStudent = $("mStudent");
  const mKind = $("mKind");
  const mAYFrom = $("mAYFrom");
  const mAYTo = $("mAYTo");
  const mSemFrom = $("mSemFrom");
  const mSemTo = $("mSemTo");
  const mIncludeDraft = $("mIncludeDraft");
  const mNotes = $("mNotes");

  const issueForm = $("issueForm");
  const revokeForm = $("revokeForm");
  const deleteForm = $("deleteForm");

  const selectAll = $("selectAll");
  const bulkAction = $("bulkAction");
  const bulkForm = $("bulkForm");
  const bulkActionVal = $("bulkActionVal");
  const bulkIdsVal = $("bulkIdsVal");

  if (!trModal || !trForm) return;

  const open = (el) => {
    el.classList.add("show");
    el.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };

  const close = (el) => {
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };

  function resetModal() {
    mId.value = "";
    mStatus.value = "";
    trForm.action = "/admin/transcripts";
    mStudent.value = "";
    mKind.value = "official";
    mAYFrom.value = "";
    mAYTo.value = "";
    mSemFrom.value = 0;
    mSemTo.value = 6;
    mIncludeDraft.checked = false;
    mNotes.value = "";
  }

  function openCreate() {
    trModalTitle.textContent = "New Transcript";
    resetModal();
    open(trModal);
  }

  function openEditFromBtn(btn) {
    const status = btn.dataset.status || "draft";
    if (status === "issued") {
      alert("Issued transcripts cannot be edited. Use Clone instead.");
      return;
    }

    trModalTitle.textContent = "Edit Transcript";
    resetModal();

    const id = btn.dataset.id;
    mId.value = id;
    mStatus.value = status;
    trForm.action = `/admin/transcripts/${encodeURIComponent(id)}`;

    mStudent.value = btn.dataset.student || "";
    mKind.value = btn.dataset.kind || "official";
    mAYFrom.value = btn.dataset.ayfrom || "";
    mAYTo.value = btn.dataset.ayto || "";
    mSemFrom.value = btn.dataset.semfrom || 0;
    mSemTo.value = btn.dataset.semto || 6;
    mIncludeDraft.checked = btn.dataset.incdraft === "1";
    mNotes.value = btn.dataset.notes || "";

    open(trModal);
  }

  function saveTranscript() {
    if (!mStudent.value) return alert("Student is required.");
    const sf = Number(mSemFrom.value || 0);
    const st = Number(mSemTo.value || 6);
    if (sf > st) return alert("Semester From cannot be greater than Semester To.");
    trForm.submit();
  }

  function issue(id) {
    if (!window.confirm("Issue this transcript? It will be snapshotted and cannot be edited.")) return;
    issueForm.action = `/admin/transcripts/${encodeURIComponent(id)}/issue`;
    issueForm.submit();
  }

  function revoke(id) {
    const reason = (window.prompt("Revoke reason (optional):") || "").trim().slice(0, 200);
    if (!window.confirm("Revoke this transcript?")) return;

    revokeForm.action = `/admin/transcripts/${encodeURIComponent(id)}/revoke`;

    let inp = revokeForm.querySelector('input[name="reason"]');
    if (!inp) {
      inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = "reason";
      revokeForm.appendChild(inp);
    }
    inp.value = reason;
    revokeForm.submit();
  }

  function del(id) {
    if (!window.confirm("Delete this transcript permanently?")) return;
    deleteForm.action = `/admin/transcripts/${encodeURIComponent(id)}/delete`;
    deleteForm.submit();
  }

  function selectedIds() {
    return Array.from(document.querySelectorAll(".selChk"))
      .filter((cb) => cb.checked)
      .map((cb) => cb.dataset.id);
  }

  function bulkApply() {
    const action = String(bulkAction?.value || "").trim();
    const ids = selectedIds();

    if (!action || !ids.length) {
      alert("Choose a bulk action and select at least one transcript.");
      return;
    }

    if (action === "delete" && !window.confirm(`Delete ${ids.length} transcript(s)?`)) return;
    if (action === "revoke" && !window.confirm(`Revoke ${ids.length} transcript(s)?`)) return;

    bulkActionVal.value = action;
    bulkIdsVal.value = ids.join(",");
    bulkForm.submit();
  }

  document.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;

    if (action === "openCreate") return openCreate();
    if (action === "closeModal") return close(trModal);
    if (action === "saveTranscript") return saveTranscript();
    if (action === "openEdit") return openEditFromBtn(btn);
    if (action === "issue") return issue(btn.dataset.id);
    if (action === "revoke") return revoke(btn.dataset.id);
    if (action === "delete") return del(btn.dataset.id);
    if (action === "bulkApply") return bulkApply();
  });

  if (selectAll) {
    selectAll.addEventListener("change", function () {
      document.querySelectorAll(".selChk").forEach((cb) => {
        cb.checked = selectAll.checked;
      });
    });
  }

  trModal.addEventListener("click", function (e) {
    if (e.target === trModal) close(trModal);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close(trModal);
  });
})();
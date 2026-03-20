(() => {
  const form = document.getElementById("applyForm");
  if (!form) return;

  const btnDraft = document.getElementById("btnDraft");
  const btnReset = document.getElementById("btnReset");

  // Quick drop zone = extra docs only
  const dropZone = document.getElementById("dropZone");
  const quickFiles = document.getElementById("quickFiles");
  const pickQuick = document.getElementById("pickQuick");
  const fileList = document.getElementById("fileList");

  // This is the REAL file input that will be submitted
  const otherDocsInput = form.querySelector('input[name="otherDocs"]');

  const DRAFT_KEY = "campus_apply_draft_v2";

  const humanSize = (bytes) => {
    const units = ["B", "KB", "MB", "GB"];
    let i = 0, n = bytes;
    while (n > 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  };

  // Preview list for “otherDocs”
  const renderOtherDocs = () => {
    if (!fileList) return;
    const files = otherDocsInput?.files ? Array.from(otherDocsInput.files) : [];
    fileList.innerHTML = files.length
      ? files.map((f) => `
          <div class="file">
            <div style="display:flex;gap:10px;align-items:center">
              <i class="fa-solid fa-file"></i>
              <div>
                <div class="name">${escapeHtml(f.name)}</div>
                <div class="muted">${humanSize(f.size)} • ${escapeHtml(f.type || "file")}</div>
              </div>
            </div>
            <span class="badge ok"><i class="fa-solid fa-check"></i> queued</span>
          </div>
        `).join("")
      : `<div class="muted">No extra files selected yet.</div>`;
  };

  // Because we cannot directly push into input.files safely in all browsers,
  // we use DataTransfer to rebuild a new FileList.
  const mergeIntoOtherDocs = (newFiles) => {
    if (!otherDocsInput) return;
    const dt = new DataTransfer();
    const existing = otherDocsInput.files ? Array.from(otherDocsInput.files) : [];
    [...existing, ...newFiles].forEach(f => dt.items.add(f));
    otherDocsInput.files = dt.files;
    renderOtherDocs();
  };

  // Drag & Drop (extra docs)
  if (dropZone && quickFiles && pickQuick) {
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag");
      const list = Array.from(e.dataTransfer.files || []).filter(f => allowed.has(f.type));
      if (list.length) mergeIntoOtherDocs(list);
    });

    pickQuick.addEventListener("click", () => quickFiles.click());
    quickFiles.addEventListener("change", () => {
      const list = Array.from(quickFiles.files || []).filter(f => allowed.has(f.type));
      if (list.length) mergeIntoOtherDocs(list);
      quickFiles.value = "";
    });
  }

  // Draft save/load (text fields + selects)
  const getDraft = () => {
    const data = {};
    new FormData(form).forEach((v, k) => {
      // skip file inputs
      if (v instanceof File) return;
      data[k] = v;
    });
    return data;
  };

  const saveDraft = () => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(getDraft())); } catch (_) {}
  };

  const loadDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);

      Object.keys(data).forEach((k) => {
        const el = form.querySelector(`[name="${CSS.escape(k)}"]`);
        if (!el) return;
        if (el.type === "checkbox") el.checked = data[k] === "1" || data[k] === true;
        else el.value = data[k];
      });
    } catch (_) {}
  };

  btnDraft?.addEventListener("click", () => {
    saveDraft();
    alert("Draft saved on this device.");
  });

  form.addEventListener("input", saveDraft);

  btnReset?.addEventListener("click", () => {
    setTimeout(() => {
      try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
      renderOtherDocs();
    }, 0);
  });

  // Helpers
  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Init
  loadDraft();
  renderOtherDocs();
})();

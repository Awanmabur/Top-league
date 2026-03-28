(() => {
  const form = document.getElementById("applyForm");
  if (!form) return;

  const btnDraft = document.getElementById("btnDraft");
  const btnReset = document.getElementById("btnReset");
  const btnNew = document.getElementById("btnNew");

  const dropZone = document.getElementById("dropZone");
  const quickFiles = document.getElementById("quickFiles");
  const pickQuick = document.getElementById("pickQuick");
  const fileList = document.getElementById("fileList");

  const otherDocsInput = form.querySelector('input[name="otherDocs"]');

  const DRAFT_KEY = "classic_academy_apply_draft_v1";

  const humanSize = (bytes) => {
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let n = bytes;
    while (n > 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  };

  const renderOtherDocs = () => {
    if (!fileList) return;
    const files = otherDocsInput && otherDocsInput.files ? Array.from(otherDocsInput.files) : [];
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

  const mergeIntoOtherDocs = (newFiles) => {
    if (!otherDocsInput) return;
    const dt = new DataTransfer();
    const existing = otherDocsInput.files ? Array.from(otherDocsInput.files) : [];
    [...existing, ...newFiles].forEach((f) => dt.items.add(f));
    otherDocsInput.files = dt.files;
    renderOtherDocs();
  };

  if (dropZone && quickFiles && pickQuick) {
    const allowed = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/jpg",
      "image/webp",
    ]);

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag");
    });

    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag");
      const list = Array.from(e.dataTransfer.files || []).filter((f) => {
        return allowed.has(f.type) || /\.(pdf|jpg|jpeg|png|webp)$/i.test(f.name || "");
      });
      if (list.length) mergeIntoOtherDocs(list);
    });

    pickQuick.addEventListener("click", () => quickFiles.click());

    quickFiles.addEventListener("change", () => {
      const list = Array.from(quickFiles.files || []).filter((f) => {
        return allowed.has(f.type) || /\.(pdf|jpg|jpeg|png|webp)$/i.test(f.name || "");
      });
      if (list.length) mergeIntoOtherDocs(list);
      quickFiles.value = "";
    });
  }

  const getDraft = () => {
    const data = {};
    const fd = new FormData(form);

    fd.forEach((v, k) => {
      if (v instanceof File) return;

      if (data[k] !== undefined) {
        if (!Array.isArray(data[k])) data[k] = [data[k]];
        data[k].push(v);
      } else {
        data[k] = v;
      }
    });

    return data;
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(getDraft()));
    } catch (_) {}
  };

  const loadDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);

      Object.keys(data).forEach((k) => {
        const els = form.querySelectorAll(`[name="${CSS.escape(k)}"]`);
        if (!els.length) return;

        if (els.length > 1 || (els[0] && els[0].multiple)) {
          const values = Array.isArray(data[k]) ? data[k].map(String) : [String(data[k])];
          els.forEach((el) => {
            if (el.tagName === "SELECT" && el.multiple) {
              Array.from(el.options).forEach((opt) => {
                opt.selected = values.indexOf(String(opt.value)) >= 0;
              });
            }
          });
          return;
        }

        const el = els[0];
        if (!el) return;

        if (el.type === "checkbox") {
          el.checked = data[k] === "1" || data[k] === true;
        } else {
          el.value = data[k];
        }
      });
    } catch (_) {}
  };

  btnDraft && btnDraft.addEventListener("click", () => {
    saveDraft();
    alert("Draft saved on this device.");
  });

  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);

  btnReset && btnReset.addEventListener("click", () => {
    setTimeout(() => {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch (_) {}
      renderOtherDocs();
    }, 0);
  });

  btnNew && btnNew.addEventListener("click", () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (_) {}
    window.location.href = "/admissions/apply";
  });

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  loadDraft();
  renderOtherDocs();
})();
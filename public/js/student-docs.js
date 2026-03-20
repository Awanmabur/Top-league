(function () {
  const $ = (id) => document.getElementById(id);

  function readDocsData() {
    const el = $("docsData");
    if (!el) return [];
    try {
      return JSON.parse(el.textContent || "[]");
    } catch (err) {
      console.error("Failed to parse docs data:", err);
      return [];
    }
  }

  const DOCS = readDocsData();
  if (!$("tbodyDocs")) return;

  const state = {
    currentViewId: null,
  };

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
    document.body.style.overflow = "";
  }

  function submitDelete(actionUrl) {
    const form = $("rowDeleteForm");
    if (!form) return;
    form.action = actionUrl;
    form.submit();
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = n;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  }

  function typePill(type) {
    const t = String(type || "other").toLowerCase();
    if (t === "passport") return '<span class="pill info"><i class="fa-solid fa-passport"></i> Passport</span>';
    if (t === "transcript") return '<span class="pill ok"><i class="fa-solid fa-file-lines"></i> Transcript</span>';
    if (t === "certificate") return '<span class="pill warn"><i class="fa-solid fa-certificate"></i> Certificate</span>';
    if (t === "id") return '<span class="pill info"><i class="fa-solid fa-id-card"></i> ID</span>';
    return '<span class="pill bad"><i class="fa-solid fa-file"></i> Other</span>';
  }

  function renderTable() {
    $("tbodyDocs").innerHTML =
      DOCS.map((d) => {
        const fileLabel = d.originalName || "Open file";
        return `
          <tr class="row-clickable" data-id="${escapeHtml(d.id)}">
            <td class="col-student">
              <div class="doc-main">
                <div class="doc-title" title="${escapeHtml(d.studentLabel || "—")}">${escapeHtml(d.studentLabel || "—")}</div>
              </div>
            </td>

            <td class="col-type">
              ${typePill(d.type)}
            </td>

            <td class="col-title">
              <span class="cell-ellipsis" title="${escapeHtml(d.title || "—")}">${escapeHtml(d.title || "—")}</span>
            </td>

            <td class="col-file">
              ${
                d.url
                  ? `<a class="link-inline cell-ellipsis" href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(fileLabel)}">${escapeHtml(fileLabel)}</a>`
                  : `<span class="cell-ellipsis">—</span>`
              }
            </td>

            <td class="col-size">
              <span class="cell-ellipsis">${escapeHtml(formatBytes(d.bytes || 0))}</span>
            </td>

            <td class="col-date">
              <span class="cell-ellipsis" title="${escapeHtml(formatDate(d.uploadedAt))}">
                ${escapeHtml(formatDate(d.uploadedAt))}
              </span>
            </td>

            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
        <tr>
          <td colspan="7" style="padding:18px;">
            <div class="muted">No documents found.</div>
          </td>
        </tr>
      `;
  }

  function resetForm() {
    $("mTitle").textContent = "Upload Document";
    $("docForm").action = "/admin/student-docs";
    $("mStudent").value = "";
    $("mType").value = "other";
    $("mTitleInput").value = "";
    $("mFile").value = "";
    $("mFile").required = true;
    $("currentFileHint").textContent = "Required when creating a new document.";
    $("saveBtn").innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Document';
  }

  function openEditor(prefill) {
    const d = prefill || null;

    if (!d) {
      resetForm();
      openModal("mEdit");
      return;
    }

    $("mTitle").textContent = "Edit Document";
    $("docForm").action = `/admin/student-docs/${encodeURIComponent(d.id)}`;
    $("mStudent").value = d.studentId || "";
    $("mType").value = d.type || "other";
    $("mTitleInput").value = d.title || "";
    $("mFile").value = "";
    $("mFile").required = false;

    if (d.url) {
      $("currentFileHint").innerHTML = `Current file: <a class="link-inline" href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(d.originalName || "Open file")}</a>`;
    } else {
      $("currentFileHint").textContent = "No file attached to this record.";
    }

    $("saveBtn").innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
    openModal("mEdit");
  }

  function openViewModal(d) {
    if (!d) return;

    state.currentViewId = d.id;

    $("vStudent").textContent = d.studentLabel || "—";
    $("vType").innerHTML = typePill(d.type || "other");
    $("vTitle").textContent = d.title || "—";
    $("vUploadedAt").textContent = formatDate(d.uploadedAt);
    $("vBytes").textContent = formatBytes(d.bytes || 0);

    const link = $("vFileLink");
    if (d.url) {
      link.href = d.url;
      link.textContent = d.originalName || "Open file";
      link.style.display = "";
    } else {
      link.removeAttribute("href");
      link.textContent = "No file";
      link.style.display = "none";
    }

    openModal("mView");
  }

  function downloadCsv(filename, rows) {
    const esc = (value) => {
      const s = String(value ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const csv = rows.map((row) => row.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportDocs() {
    const rows = [
      ["Student", "Type", "Title", "OriginalName", "FileUrl", "SizeBytes", "UploadedAt"],
      ...DOCS.map((d) => [
        d.studentLabel || "",
        d.type || "",
        d.title || "",
        d.originalName || "",
        d.url || "",
        d.bytes || 0,
        d.uploadedAt || "",
      ]),
    ];

    downloadCsv("student-docs-export.csv", rows);
  }

  $("btnCreate").addEventListener("click", function () {
    openEditor();
  });

  $("quickPassport").addEventListener("click", function () {
    openEditor();
    $("mType").value = "passport";
  });

  $("quickTranscript").addEventListener("click", function () {
    openEditor();
    $("mType").value = "transcript";
  });

  $("quickCertificate").addEventListener("click", function () {
    openEditor();
    $("mType").value = "certificate";
  });

  $("btnExport").addEventListener("click", exportDocs);
  $("btnPrint").addEventListener("click", function () {
    window.print();
  });

  $("tbodyDocs").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;

    const d = DOCS.find((x) => x.id === tr.dataset.id);
    if (!d) return;

    if (e.target.closest(".actions") || e.target.closest(".btn-xs")) {
      if (e.target.closest(".actView")) return openViewModal(d);
      if (e.target.closest(".actEdit")) return openEditor(d);

      if (e.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${d.title || "this document"}"?`)) return;
        return submitDelete(`/admin/student-docs/${encodeURIComponent(d.id)}/delete`);
      }

      return;
    }

    openViewModal(d);
  });

  $("viewEditBtn").addEventListener("click", function () {
    const d = DOCS.find((x) => x.id === state.currentViewId);
    if (!d) return;
    closeModal("mView");
    openEditor(d);
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
      document.body.style.overflow = "";
    }
  });

  renderTable();
})();
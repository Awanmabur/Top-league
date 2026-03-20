(function () {
  const $ = (id) => document.getElementById(id);

  function readJson(id) {
    const el = $(id);
    if (!el) return [];
    try {
      return JSON.parse(el.value || "[]");
    } catch (err) {
      console.error(`Failed to parse ${id}:`, err);
      return [];
    }
  }

  const ACCEPTED = readJson("acceptedData");
  const LETTERS = readJson("lettersData");

  const state = {
    currentLetterId: null,
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

  function formatDateTime(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  }

  function statusPill(status) {
    if (status === "sent") {
      return '<span class="pill ok"><i class="fa-solid fa-paper-plane"></i> Sent</span>';
    }
    if (status === "void") {
      return '<span class="pill bad"><i class="fa-solid fa-ban"></i> Void</span>';
    }
    return '<span class="pill warn"><i class="fa-solid fa-pen"></i> Draft</span>';
  }

  function renderAccepted() {
    const host = $("tbodyAccepted");
    if (!host) return;

    host.innerHTML =
      ACCEPTED.map((a) => {
        return `
          <tr>
            <td class="col-candidate">
              <div class="item-title" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</div>
              <div class="item-sub" title="${escapeHtml((a.applicationId || "—") + " • " + (a.email || "—") + " • " + (a.phone || "—"))}">
                ${escapeHtml(a.applicationId || "—")} • ${escapeHtml(a.email || "—")} • ${escapeHtml(a.phone || "—")}
              </div>
            </td>
            <td class="col-program">
              <span class="cell-ellipsis" title="${escapeHtml(a.programLabel || "—")}">${escapeHtml(a.programLabel || "—")}</span>
            </td>
            <td class="col-intake">
              <span class="cell-ellipsis">${escapeHtml(a.intake || "—")}</span>
            </td>
            <td class="col-latest">
              ${
                a.latestLetterId
                  ? `<div class="item-title">${escapeHtml(a.latestLetterNo || "—")}</div>
                     <div class="item-sub">${statusPill(a.latestLetterStatus)} • ${escapeHtml(formatDateTime(a.latestLetterIssuedAt))}</div>`
                  : `<span class="muted">No letter yet</span>`
              }
            </td>
            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actGenerate" type="button" data-id="${escapeHtml(a.id)}" title="Generate Draft">
                  <i class="fa-solid fa-wand-magic-sparkles"></i>
                </button>
                ${
                  a.latestLetterId
                    ? `<button class="btn-xs actPreview" type="button" data-letter-id="${escapeHtml(a.latestLetterId)}" title="Preview">
                        <i class="fa-solid fa-eye"></i>
                      </button>`
                    : ""
                }
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
      <tr>
        <td colspan="5" style="padding:18px;">
          <div class="muted">No accepted applicants found.</div>
        </td>
      </tr>
      `;
  }

  function renderLetters() {
    const host = $("tbodyLetters");
    if (!host) return;

    host.innerHTML =
      LETTERS.map((l) => {
        return `
          <tr>
            <td><span class="item-title">${escapeHtml(l.letterNo || "—")}</span></td>
            <td>
              <div class="item-title">${escapeHtml(l.applicantName || "—")}</div>
              <div class="item-sub">${escapeHtml(l.sentToEmail || l.applicantEmail || "—")}</div>
            </td>
            <td><span class="cell-ellipsis" title="${escapeHtml(l.programLabel || "—")}">${escapeHtml(l.programLabel || "—")}</span></td>
            <td><span class="cell-ellipsis">${escapeHtml(l.intakeLabel || "—")}</span></td>
            <td>${statusPill(l.status)}</td>
            <td>
              <div class="actions">
                <button class="btn-xs actPreview" type="button" data-letter-id="${escapeHtml(l.id)}" title="Preview">
                  <i class="fa-solid fa-eye"></i>
                </button>
                <button class="btn-xs actSend" type="button" data-letter-id="${escapeHtml(l.id)}" title="Send">
                  <i class="fa-solid fa-paper-plane"></i>
                </button>
                <button class="btn-xs actVoid" type="button" data-letter-id="${escapeHtml(l.id)}" title="Void">
                  <i class="fa-solid fa-ban"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `
      <tr>
        <td colspan="6" style="padding:18px;">
          <div class="muted">No letters found.</div>
        </td>
      </tr>
      `;
  }

  function getLetterById(id) {
    return LETTERS.find((x) => x.id === id) || null;
  }

  function writePreviewFrame(html) {
    const frame = $("previewFrame");
    if (!frame) return;
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff;">${html || ""}</body></html>`);
    doc.close();
  }

  function openPreview(letterId) {
    const l = getLetterById(letterId);
    if (!l) return;

    state.currentLetterId = l.id;

    $("pvLetterNo").textContent = l.letterNo || "—";
    $("pvRecipient").textContent = l.sentToEmail || l.applicantEmail || "—";
    $("pvStatus").innerHTML = statusPill(l.status || "draft");
    $("previewMeta").textContent = `${l.applicantName || "—"} • ${l.programLabel || "—"} • ${l.intakeLabel || "—"}`;

    writePreviewFrame(l.bodyHtml || "");
    openModal("mPreview");
  }

  function openSend(letterId) {
    const l = getLetterById(letterId);
    if (!l) return;

    state.currentLetterId = l.id;
    $("sendForm").action = `/admin/admissions/offer-letters/${encodeURIComponent(l.id)}/send`;
    $("sendTo").value = l.sentToEmail || l.applicantEmail || "";
    openModal("mSend");
  }

  function openVoid(letterId) {
    const l = getLetterById(letterId);
    if (!l) return;

    state.currentLetterId = l.id;
    $("voidForm").action = `/admin/admissions/offer-letters/${encodeURIComponent(l.id)}/void`;
    openModal("mVoid");
  }

  $("btnEditTemplate")?.addEventListener("click", function () {
    openModal("mTemplate");
  });

  $("btnShowTokens")?.addEventListener("click", function () {
    openModal("mTokens");
  });

  $("tbodyAccepted")?.addEventListener("click", function (e) {
    const gen = e.target.closest(".actGenerate");
    if (gen) {
      $("generateApplicantId").value = gen.dataset.id || "";
      $("generateForm").submit();
      return;
    }

    const prev = e.target.closest(".actPreview");
    if (prev) {
      openPreview(prev.dataset.letterId || "");
    }
  });

  $("tbodyLetters")?.addEventListener("click", function (e) {
    const prev = e.target.closest(".actPreview");
    if (prev) return openPreview(prev.dataset.letterId || "");

    const send = e.target.closest(".actSend");
    if (send) return openSend(send.dataset.letterId || "");

    const v = e.target.closest(".actVoid");
    if (v) return openVoid(v.dataset.letterId || "");
  });

  $("btnOpenSend")?.addEventListener("click", function () {
    if (!state.currentLetterId) return;
    closeModal("mPreview");
    openSend(state.currentLetterId);
  });

  $("btnOpenVoid")?.addEventListener("click", function () {
    if (!state.currentLetterId) return;
    closeModal("mPreview");
    openVoid(state.currentLetterId);
  });

  $("btnPrintPreview")?.addEventListener("click", function () {
    try {
      const frame = $("previewFrame");
      if (frame && frame.contentWindow) {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        return;
      }
    } catch (_) {}
    window.print();
  });

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mPreview", "mSend", "mVoid", "mTemplate", "mTokens"].forEach(function (mid) {
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

  renderAccepted();
  renderLetters();
})();
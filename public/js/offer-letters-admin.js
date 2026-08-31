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

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
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
    const value = status === "sent" ? "Sent" : status === "void" ? "Void" : "Draft";
    const tone = status === "sent" ? "ok" : status === "void" ? "bad" : "warn";
    const icon = status === "sent" ? "fa-paper-plane" : status === "void" ? "fa-ban" : "fa-pen";
    const pill = make("span", `pill ${tone}`);
    pill.append(make("i", `fa-solid ${icon}`), document.createTextNode(` ${value}`));
    return pill;
  }

  function iconButton(className, title, iconClass, data = {}) {
    const button = make("button", `btn-xs ${className}`);
    button.type = "button";
    button.title = title;
    Object.entries(data).forEach(([key, value]) => { button.dataset[key] = String(value || ""); });
    button.appendChild(make("i", `fa-solid ${iconClass}`));
    return button;
  }

  function renderAccepted() {
    const host = $("tbodyAccepted");
    if (!host) return;
    host.replaceChildren();

    if (!ACCEPTED.length) {
      const tr = make("tr");
      const td = make("td");
      td.colSpan = 5;
      td.style.padding = "18px";
      td.appendChild(make("div", "muted", "No accepted applicants found."));
      tr.appendChild(td);
      host.appendChild(tr);
      return;
    }

    ACCEPTED.forEach((a) => {
      const tr = make("tr");
      const candidateTd = make("td", "col-candidate");
      const title = make("div", "item-title", a.name || "—");
      title.title = String(a.name || "");
      const subText = `${a.applicationId || "—"} • ${a.email || "—"} • ${a.phone || "—"}`;
      const sub = make("div", "item-sub", subText);
      sub.title = subText;
      candidateTd.append(title, sub);

      const programTd = make("td", "col-program");
      const program = make("span", "cell-ellipsis", a.programLabel || "—");
      program.title = String(a.programLabel || "—");
      programTd.appendChild(program);
      const intakeTd = make("td", "col-intake");
      intakeTd.appendChild(make("span", "cell-ellipsis", a.intake || "—"));

      const latestTd = make("td", "col-latest");
      if (a.latestLetterId) {
        latestTd.appendChild(make("div", "item-title", a.latestLetterNo || "—"));
        const meta = make("div", "item-sub");
        meta.append(statusPill(a.latestLetterStatus), document.createTextNode(` • ${formatDateTime(a.latestLetterIssuedAt)}`));
        latestTd.appendChild(meta);
      } else {
        latestTd.appendChild(make("span", "muted", "No letter yet"));
      }

      const actionsTd = make("td", "col-actions");
      const actions = make("div", "actions");
      actions.appendChild(iconButton("actGenerate", "Generate Draft", "fa-wand-magic-sparkles", { id: a.id }));
      if (a.latestLetterId) actions.appendChild(iconButton("actPreview", "Preview", "fa-eye", { letterId: a.latestLetterId }));
      actionsTd.appendChild(actions);

      tr.append(candidateTd, programTd, intakeTd, latestTd, actionsTd);
      host.appendChild(tr);
    });
  }

  function renderLetters() {
    const host = $("tbodyLetters");
    if (!host) return;
    host.replaceChildren();

    if (!LETTERS.length) {
      const tr = make("tr");
      const td = make("td");
      td.colSpan = 6;
      td.style.padding = "18px";
      td.appendChild(make("div", "muted", "No letters found."));
      tr.appendChild(td);
      host.appendChild(tr);
      return;
    }

    LETTERS.forEach((l) => {
      const tr = make("tr");
      const noTd = make("td");
      noTd.appendChild(make("span", "item-title", l.letterNo || "—"));
      const applicantTd = make("td");
      applicantTd.append(make("div", "item-title", l.applicantName || "—"), make("div", "item-sub", l.sentToEmail || l.applicantEmail || "—"));
      const programTd = make("td");
      const program = make("span", "cell-ellipsis", l.programLabel || "—");
      program.title = String(l.programLabel || "—");
      programTd.appendChild(program);
      const intakeTd = make("td");
      intakeTd.appendChild(make("span", "cell-ellipsis", l.intakeLabel || "—"));
      const statusTd = make("td");
      statusTd.appendChild(statusPill(l.status));
      const actionsTd = make("td");
      const actions = make("div", "actions");
      actions.appendChild(iconButton("actPreview", "Preview", "fa-eye", { letterId: l.id }));
      if (l.status === "draft" && l.deliveryStatus !== "sending") {
        actions.appendChild(iconButton("actSend", "Send", "fa-paper-plane", { letterId: l.id }));
      }
      if (l.status !== "void" && l.deliveryStatus !== "sending") {
        actions.appendChild(iconButton("actVoid", "Void", "fa-ban", { letterId: l.id }));
      }
      actionsTd.appendChild(actions);
      tr.append(noTd, applicantTd, programTd, intakeTd, statusTd, actionsTd);
      host.appendChild(tr);
    });
  }

  function getLetterById(id) {
    return LETTERS.find((x) => x.id === id) || null;
  }

  function writePreviewFrame(html) {
    const frame = $("previewFrame");
    if (!frame) return;
    frame.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff;">${String(html || "")}</body></html>`;
  }

  function openPreview(letterId) {
    const l = getLetterById(letterId);
    if (!l) return;

    state.currentLetterId = l.id;

    $("pvLetterNo").textContent = l.letterNo || "—";
    $("pvRecipient").textContent = l.sentToEmail || l.applicantEmail || "—";
    $("pvStatus").replaceChildren(statusPill(l.status || "draft"));
    $("previewMeta").textContent = `${l.applicantName || "—"} • ${l.programLabel || "—"} • ${l.intakeLabel || "—"}`;

    writePreviewFrame(l.bodyHtml || "");
    openModal("mPreview");
  }

  function openSend(letterId) {
    const l = getLetterById(letterId);
    if (!l) return;

    state.currentLetterId = l.id;
    if (l.status !== "draft" || l.deliveryStatus === "sending") return;
    $("sendForm").action = `/admin/admissions/offer-letters/${encodeURIComponent(l.id)}/send`;
    $("sendRevision").value = String(l.revision || 1);
    $("sendTo").value = l.sentToEmail || l.applicantEmail || "";
    openModal("mSend");
  }

  function openVoid(letterId) {
    const l = getLetterById(letterId);
    if (!l) return;

    state.currentLetterId = l.id;
    if (l.status === "void" || l.deliveryStatus === "sending") return;
    $("voidForm").action = `/admin/admissions/offer-letters/${encodeURIComponent(l.id)}/void`;
    $("voidRevision").value = String(l.revision || 1);
    $("voidReason").value = "";
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
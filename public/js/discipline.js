(function () {
  "use strict";

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function readJson(id) {
    const el = qs("#" + id);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || "{}");
    } catch {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function openModal(id) {
    const el = qs("#" + id);
    if (!el) return;
    el.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const el = qs("#" + id);
    if (!el) return;
    el.classList.remove("show");
    if (!qs(".modal-backdrop.show")) {
      document.body.style.overflow = "";
    }
  }

  function wireModalBasics() {
    qsa("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close")));
    });

    qsa(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeModal(backdrop.id);
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        qsa(".modal-backdrop.show").forEach((m) => m.classList.remove("show"));
        document.body.style.overflow = "";
      }
    });
  }

  const data = readJson("disciplineData") || {};
  const routes = data.routes || {};
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const students = Array.isArray(data.students) ? data.students : [];
  const statusLabels = {
    open: "Open",
    investigating: "Investigating",
    hearing: "Hearing",
    resolved: "Resolved",
    dismissed: "Dismissed",
  };
  let currentCaseId = "";

  const mTitle = qs("#mTitle");
  const caseForm = qs("#caseForm");
  const caseId = qs("#caseId");
  const caseMainFields = qs("#caseMainFields");
  const caseSaveBtn = qs("#caseSaveBtn");

  const fStudent = qs("#fStudent");
  const fIncidentDate = qs("#fIncidentDate");
  const fCategory = qs("#fCategory");
  const fDescription = qs("#fDescription");
  const fStatus = qs("#fStatus");
  const fNote = qs("#fNote");

  const editOnly = qs("#editOnly");
  const statementForm = qs("#statementForm");
  const attachForm = qs("#attachForm");
  const fileSummary = qs("#fileSummary");

  const aAction = qs("#aAction");
  const aDetails = qs("#aDetails");
  const btnAddAction = qs("#btnAddAction");

  const delName = qs("#delName");
  const delForm = qs("#delForm");
  const viewEditBtn = qs("#viewEditBtn");
  const viewMoreBtn = qs("#viewMoreBtn");

  function findCase(id) {
    return cases.find((row) => row._id === id) || null;
  }

  function formatDate(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString();
  }

  function studentLabel(id) {
    const row = students.find((student) => student._id === id);
    if (!row) return "-";
    const reg = row.regNo ? `${row.regNo} - ` : "";
    const email = row.email ? ` (${row.email})` : "";
    return `${reg}${row.name || "Student"}${email}`;
  }

  function setCaseShell(mode) {
    const more = mode === "more";
    if (caseMainFields) caseMainFields.style.display = more ? "none" : "grid";
    if (editOnly) editOnly.style.display = more ? "block" : "none";
    if (caseSaveBtn) caseSaveBtn.style.display = more ? "none" : "";
  }

  function resetCaseFields() {
    if (fStudent) fStudent.value = "";
    if (fIncidentDate) fIncidentDate.value = "";
    if (fCategory) fCategory.value = "";
    if (fDescription) fDescription.value = "";
    if (fStatus) fStatus.value = "open";
    if (fNote) fNote.value = "";
    if (aAction) aAction.value = "";
    if (aDetails) aDetails.value = "";
    if (fileSummary) fileSummary.textContent = "-";
  }

  function prepareCaseForms(id, row) {
    if (caseId) caseId.value = id || "";

    if (fStudent) fStudent.value = row?.student || "";
    if (fIncidentDate) fIncidentDate.value = row?.incidentDate || "";
    if (fCategory) fCategory.value = row?.category || "";
    if (fDescription) fDescription.value = row?.description || "";
    if (fStatus) fStatus.value = row?.status || "open";
    if (fNote) fNote.value = row?.note || "";

    if (statementForm && id) {
      statementForm.action = (routes.statement || "/admin/discipline/{id}/statement").replace("{id}", encodeURIComponent(id));
    }

    if (attachForm && id) {
      attachForm.action = (routes.attachments || "/admin/discipline/{id}/attachments").replace("{id}", encodeURIComponent(id));
    }

    const statementText = row?.studentStatement
      ? `Statement: Yes (${row.studentStatement.originalName || "file"})`
      : "Statement: No";
    const attachmentText = `Attachments: ${Array.isArray(row?.attachments) ? row.attachments.length : 0}`;
    const actionText = `Actions: ${Array.isArray(row?.actions) ? row.actions.length : 0}`;

    if (fileSummary) fileSummary.textContent = `${statementText} - ${attachmentText} - ${actionText}`;
    if (aAction) aAction.value = "";
    if (aDetails) aDetails.value = "";
  }

  function fillCreate() {
    currentCaseId = "";
    if (mTitle) mTitle.innerHTML = '<i class="fa-solid fa-plus"></i> Open Discipline Case';
    if (caseForm) caseForm.action = routes.create || "/admin/discipline";
    if (caseId) caseId.value = "";
    resetCaseFields();
    setCaseShell("edit");
  }

  function fillEdit(id) {
    const row = findCase(id);
    if (!row) return false;

    currentCaseId = id;
    if (mTitle) mTitle.innerHTML = `<i class="fa-solid fa-pen"></i> Edit Case - ${escapeHtml(row.caseNo || "")}`;
    if (caseForm) caseForm.action = (routes.update || "/admin/discipline/{id}").replace("{id}", encodeURIComponent(id));
    prepareCaseForms(id, row);
    setCaseShell("edit");
    return true;
  }

  function fillMore(id) {
    const row = findCase(id);
    if (!row) return false;

    currentCaseId = id;
    if (mTitle) mTitle.innerHTML = `<i class="fa-solid fa-ellipsis"></i> More - ${escapeHtml(row.caseNo || "")}`;
    if (caseForm) caseForm.action = (routes.update || "/admin/discipline/{id}").replace("{id}", encodeURIComponent(id));
    prepareCaseForms(id, row);
    setCaseShell("more");
    return true;
  }

  function openViewModal(id) {
    const row = findCase(id);
    if (!row) return;

    currentCaseId = id;

    const vCaseNo = qs("#vCaseNo");
    const vStatus = qs("#vStatus");
    const vStudent = qs("#vStudent");
    const vIncidentDate = qs("#vIncidentDate");
    const vCategory = qs("#vCategory");
    const vDescription = qs("#vDescription");
    const vNote = qs("#vNote");
    const vFiles = qs("#vFiles");
    const vActions = qs("#vActions");

    if (vCaseNo) vCaseNo.textContent = row.caseNo || "-";
    if (vStatus) vStatus.textContent = statusLabels[row.status || "open"] || row.status || "Open";
    if (vStudent) vStudent.textContent = studentLabel(row.student);
    if (vIncidentDate) vIncidentDate.textContent = formatDate(row.incidentDate);
    if (vCategory) vCategory.textContent = row.category || "-";
    if (vDescription) vDescription.textContent = row.description || "-";
    if (vNote) vNote.textContent = row.note || "-";

    if (vFiles) {
      const bits = [];
      if (row.studentStatement?.url) {
        bits.push(
          `<a class="link-inline" href="${escapeHtml(row.studentStatement.url)}" target="_blank" rel="noreferrer noopener">Statement: ${escapeHtml(row.studentStatement.originalName || "Open file")}</a>`
        );
      } else {
        bits.push("Statement: No");
      }

      const attachments = Array.isArray(row.attachments) ? row.attachments : [];
      if (attachments.length) {
        attachments.forEach((a, index) => {
          if (!a.url) return;
          bits.push(
            `<a class="link-inline" href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer noopener">Attachment ${index + 1}: ${escapeHtml(a.originalName || "Open file")}</a>`
          );
        });
      } else {
        bits.push("Attachments: 0");
      }

      vFiles.innerHTML = bits.join("<br>");
    }

    if (vActions) {
      const actions = Array.isArray(row.actions) ? row.actions : [];
      vActions.innerHTML = actions.length
        ? actions
            .map((a) => {
              const date = a.date ? formatDate(a.date) : "";
              const detail = [a.details || "", date].filter(Boolean).join(" - ");
              return `<div class="mini-item"><div class="strong">${escapeHtml(a.action || "Action")}</div><div class="muted">${escapeHtml(detail)}</div></div>`;
            })
            .join("")
        : '<div class="muted">No actions recorded.</div>';
    }

    openModal("mView");
  }

  function postAction(id, action, details) {
    const url = (routes.addAction || "/admin/discipline/{id}/action").replace("{id}", encodeURIComponent(id));
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;

    const csrf = data.csrf || "";

    function add(name, value) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }

    add("_csrf", csrf);
    add("action", action);
    add("details", details || "");

    document.body.appendChild(form);
    form.submit();
  }

  function wireOpenButtons() {
    qsa('[data-open="mCase"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-mode") || "create";
        const id = btn.getAttribute("data-id") || "";
        if (mode === "edit") fillEdit(id);
        else if (mode === "more") fillMore(id);
        else fillCreate();
        openModal("mCase");
      });
    });
  }

  function wireCaseActionButtons() {
    qsa("[data-case-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-case-action") || "";
        const id = btn.getAttribute("data-id") || currentCaseId;

        if (action === "view") {
          openViewModal(id);
          return;
        }

        if (action === "more" && fillMore(id)) {
          closeModal("mView");
          openModal("mCase");
        }
      });
    });

    if (viewEditBtn) {
      viewEditBtn.addEventListener("click", () => {
        if (!currentCaseId) return;
        closeModal("mView");
        if (fillEdit(currentCaseId)) openModal("mCase");
      });
    }

    if (viewMoreBtn) {
      viewMoreBtn.addEventListener("click", () => {
        if (!currentCaseId) return;
        closeModal("mView");
        if (fillMore(currentCaseId)) openModal("mCase");
      });
    }
  }

  function wireDeleteButtons() {
    qsa('[data-open="mDelete"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id") || "";
        const name = btn.getAttribute("data-name") || "Case";
        if (delName) delName.textContent = name;
        if (delForm) {
          delForm.action = (routes.delete || "/admin/discipline/{id}/delete").replace("{id}", encodeURIComponent(id));
        }
        openModal("mDelete");
      });
    });
  }

  function wireActionButton() {
    if (!btnAddAction) return;

    btnAddAction.addEventListener("click", () => {
      const id = caseId ? caseId.value : "";
      if (!id) {
        window.alert("Open this case first.");
        return;
      }

      const act = (aAction?.value || "").trim();
      const det = (aDetails?.value || "").trim();

      if (!act) {
        window.alert("Action is required.");
        return;
      }

      postAction(id, act, det);
    });
  }

  wireModalBasics();
  wireOpenButtons();
  wireCaseActionButtons();
  wireDeleteButtons();
  wireActionButton();
})();

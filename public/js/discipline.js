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
        if (e.target === backdrop) {
          backdrop.classList.remove("show");
          if (!qs(".modal-backdrop.show")) {
            document.body.style.overflow = "";
          }
        }
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

  const mTitle = qs("#mTitle");
  const caseForm = qs("#caseForm");
  const caseId = qs("#caseId");

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

  function fillCreate() {
    if (mTitle) mTitle.innerHTML = '<i class="fa-solid fa-plus"></i> Open Discipline Case';
    if (caseForm) caseForm.action = routes.create || "/admin/discipline";
    if (caseId) caseId.value = "";
    if (editOnly) editOnly.style.display = "none";

    if (fStudent) fStudent.value = "";
    if (fIncidentDate) fIncidentDate.value = "";
    if (fCategory) fCategory.value = "";
    if (fDescription) fDescription.value = "";
    if (fStatus) fStatus.value = "open";
    if (fNote) fNote.value = "";
  }

  function fillEdit(id) {
    const row = cases.find((x) => x._id === id);
    if (!row) return;

    if (mTitle) mTitle.innerHTML = `<i class="fa-solid fa-pen"></i> Manage Case — ${row.caseNo || ""}`;
    if (caseForm) caseForm.action = (routes.update || "/admin/discipline/{id}").replace("{id}", encodeURIComponent(id));
    if (caseId) caseId.value = id;
    if (editOnly) editOnly.style.display = "block";

    if (fStudent) fStudent.value = row.student || "";
    if (fIncidentDate) fIncidentDate.value = row.incidentDate || "";
    if (fCategory) fCategory.value = row.category || "";
    if (fDescription) fDescription.value = row.description || "";
    if (fStatus) fStatus.value = row.status || "open";
    if (fNote) fNote.value = row.note || "";

    if (statementForm) {
      statementForm.action = (routes.statement || "/admin/discipline/{id}/statement").replace("{id}", encodeURIComponent(id));
    }

    if (attachForm) {
      attachForm.action = (routes.attachments || "/admin/discipline/{id}/attachments").replace("{id}", encodeURIComponent(id));
    }

    const statementText = row.studentStatement
      ? `Statement: Yes (${row.studentStatement.originalName || "file"})`
      : "Statement: No";
    const attachmentText = `Attachments: ${Array.isArray(row.attachments) ? row.attachments.length : 0}`;

    if (fileSummary) fileSummary.textContent = `${statementText} • ${attachmentText}`;
  }

  function postAction(id, action, details) {
    const url = (routes.addAction || "/admin/discipline/{id}/action").replace("{id}", encodeURIComponent(id));
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;

    const csrf = data.csrf || "";

    function add(name, value) {
      const i = document.createElement("input");
      i.type = "hidden";
      i.name = name;
      i.value = value;
      form.appendChild(i);
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
        else fillCreate();
        openModal("mCase");
      });
    });
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
        window.alert("Open this case in edit mode first.");
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
  wireDeleteButtons();
  wireActionButton();
})();
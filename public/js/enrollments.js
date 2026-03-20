(function () {
  "use strict";

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function readJson(id) {
    const el = qs("#" + id);
    if (!el) return null;
    try { return JSON.parse(el.textContent || "{}"); } catch { return null; }
  }

  function openModal(id) {
    const b = qs("#" + id);
    if (!b) return;
    b.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const b = qs("#" + id);
    if (!b) return;
    b.classList.remove("show");
    if (!document.querySelector(".modal-backdrop.show")) {
      document.body.style.overflow = "";
    }
  }

  const data = readJson("enrollData") || {};
  const enrollments = Array.isArray(data.enrollments) ? data.enrollments : [];
  const routes = data.routes || {};

  const checkAll = qs("#checkAll");
  const selCount = qs("#selCount");
  const bulkIds = qs("#bulkIds");
  const bulkCount = qs("#bulkCount");

  const formMain = qs("#formMain");
  const mTitle = qs("#mFormTitle");
  const rowId = qs("#rowId");

  const fStudent = qs("#fStudent");
  const fAY = qs("#fAY");
  const fSem = qs("#fSem");
  const fProg = qs("#fProg");
  const fClass = qs("#fClass");
  const fStatus = qs("#fStatus");
  const fIntake = qs("#fIntake");
  const fNote = qs("#fNote");

  const delName = qs("#delName");
  const delForm = qs("#delForm");

  function rowChks() {
    return qsa(".rowChk");
  }

  function selectedIds() {
    return rowChks().filter((x) => x.checked).map((x) => x.value);
  }

  function syncSelectedUI() {
    const ids = selectedIds();

    if (selCount) selCount.textContent = String(ids.length);
    if (bulkIds) bulkIds.value = ids.join(",");
    if (bulkCount) bulkCount.textContent = String(ids.length);

    if (checkAll) {
      const all = rowChks();
      checkAll.checked = all.length > 0 && ids.length === all.length;
      checkAll.indeterminate = ids.length > 0 && ids.length < all.length;
    }
  }

  function resetForm() {
    if (!formMain) return;

    formMain.reset();

    if (rowId) rowId.value = "";
    if (fSem) fSem.value = "1";
    if (fStatus) fStatus.value = "enrolled";
  }

  function setFormMode(mode, id) {
    if (!formMain) return;

    if (mode === "edit") {
      const row = enrollments.find((x) => x._id === id);
      if (!row) return;

      if (mTitle) mTitle.innerHTML = '<i class="fa-solid fa-pen"></i> Edit Enrollment';
      formMain.action = (routes.update || "/admin/enrollments/{id}").replace("{id}", encodeURIComponent(id));
      if (rowId) rowId.value = id;

      if (fStudent) fStudent.value = row.student || "";
      if (fAY) fAY.value = row.academicYear || "";
      if (fSem) fSem.value = String(row.semester || 1);
      if (fProg) fProg.value = row.program || "";
      if (fClass) fClass.value = row.classGroup || "";
      if (fStatus) fStatus.value = row.status || "enrolled";
      if (fIntake) fIntake.value = row.intake || "";
      if (fNote) fNote.value = row.note || "";
    } else {
      if (mTitle) mTitle.innerHTML = '<i class="fa-solid fa-plus"></i> Enroll Student';
      formMain.action = routes.create || "/admin/enrollments";
      resetForm();
    }
  }

  function wireModalButtons() {
    qsa("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-open");
        if (!target) return;

        if (target === "mForm") {
          const mode = btn.getAttribute("data-mode") || "create";
          const id = btn.getAttribute("data-id") || "";
          setFormMode(mode, id);
        }

        if (target === "mDelete") {
          const id = btn.getAttribute("data-id") || "";
          const name = btn.getAttribute("data-name") || "Enrollment";
          if (delName) delName.textContent = name;
          if (delForm) {
            delForm.action = (routes.delete || "/admin/enrollments/{id}/delete").replace("{id}", encodeURIComponent(id));
          }
        }

        if (target === "mBulk") {
          const ids = selectedIds();
          if (ids.length === 0) {
            alert("Select at least one enrollment first.");
            return;
          }
          syncSelectedUI();
        }

        openModal(target);
      });
    });

    qsa("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close")));
    });

    qsa(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) {
          backdrop.classList.remove("show");
          if (!document.querySelector(".modal-backdrop.show")) {
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

  function wireSelection() {
    if (checkAll) {
      checkAll.addEventListener("change", () => {
        rowChks().forEach((x) => {
          x.checked = checkAll.checked;
        });
        syncSelectedUI();
      });
    }

    rowChks().forEach((x) => x.addEventListener("change", syncSelectedUI));
    syncSelectedUI();
  }

  function wireToolbar() {
    const btnPrint = qs("#btnPrint");
    const btnExport = qs("#btnExport");

    if (btnPrint) {
      btnPrint.addEventListener("click", () => window.print());
    }

    if (btnExport) {
      btnExport.addEventListener("click", () => {
        window.location.href = routes.export || "/admin/enrollments/export.csv";
      });
    }
  }

  wireModalButtons();
  wireSelection();
  wireToolbar();
})();
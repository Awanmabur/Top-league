(function () {
  "use strict";

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
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

  const checkAll = qs("#checkAll");
  const selCount = qs("#selCount");
  const idsInput = qs("#ids");
  const promoCount = qs("#promoCount");

  function rowChks() {
    return qsa(".rowChk");
  }

  function selectedIds() {
    return rowChks()
      .filter((x) => x.checked)
      .map((x) => x.value)
      .filter(Boolean);
  }

  function sync() {
    const ids = selectedIds();

    if (selCount) selCount.textContent = String(ids.length);
    if (idsInput) idsInput.value = ids.join(",");
    if (promoCount) promoCount.textContent = String(ids.length);

    if (checkAll) {
      const all = rowChks();
      checkAll.checked = all.length > 0 && ids.length === all.length;
      checkAll.indeterminate = ids.length > 0 && ids.length < all.length;
    }
  }

  if (checkAll) {
    checkAll.addEventListener("change", () => {
      rowChks().forEach((x) => {
        x.checked = checkAll.checked;
      });
      sync();
    });
  }

  rowChks().forEach((x) => {
    x.addEventListener("change", sync);
  });

  qsa('[data-open="mPromote"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const ids = selectedIds();
      if (!ids.length) {
        window.alert("Select at least one student first.");
        return;
      }
      sync();
      openModal("mPromote");
    });
  });

  const promoForm = qs("#promoForm");
  if (promoForm) {
    promoForm.addEventListener("submit", (e) => {
      const ids = selectedIds();
      if (!ids.length) {
        e.preventDefault();
        window.alert("Select at least one student first.");
        return;
      }

      const toAcademicYear = qs('[name="toAcademicYear"]', promoForm)?.value?.trim();
      const toClassId = qs('[name="toClassId"]', promoForm)?.value?.trim();

      if (!toAcademicYear || !toClassId) {
        e.preventDefault();
        window.alert("Destination academic year and class are required.");
        return;
      }

      if (!window.confirm(`Promote ${ids.length} selected student(s)?`)) {
        e.preventDefault();
      }
    });
  }

  sync();
})();

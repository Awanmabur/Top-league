(function () {
  const $ = (id) => document.getElementById(id);

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("show");
  }

  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("show");
  }

  const btnNewInvoice = $("btnNewInvoice");
  const btnRecordPay = $("btnRecordPay");
  const quickInvoice = $("quickInvoice");
  const quickPayment = $("quickPayment");

  if (btnNewInvoice) {
    btnNewInvoice.addEventListener("click", function () {
      openModal("mInvoice");
    });
  }

  if (btnRecordPay) {
    btnRecordPay.addEventListener("click", function () {
      openModal("mPay");
    });
  }

  if (quickInvoice) {
    quickInvoice.addEventListener("click", function () {
      openModal("mInvoice");
    });
  }

  if (quickPayment) {
    quickPayment.addEventListener("click", function () {
      openModal("mPay");
    });
  }

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mInvoice", "mPay"].forEach(function (mid) {
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
    }
  });

  const fYear = $("fAcademicYear");
  const fSem = $("fSemester");
  const fType = $("fFeeType");
  const fProg = $("fProgram");

  function applyFilters() {
    const params = [];
    if (fYear && fYear.value) params.push("academicYear=" + encodeURIComponent(fYear.value));
    if (fSem && fSem.value) params.push("semester=" + encodeURIComponent(fSem.value));
    if (fType && fType.value) params.push("feeType=" + encodeURIComponent(fType.value));
    if (fProg && fProg.value) params.push("program=" + encodeURIComponent(fProg.value));

    const qs = params.length ? "?" + params.join("&") : "";
    window.location.href = "/admin/finance" + qs;
  }

  [fYear, fSem, fType, fProg].forEach(function (el) {
    if (!el) return;
    el.addEventListener("change", applyFilters);
  });
})();
(function () {
  const $ = (id) => document.getElementById(id);

  function openModal(id) {
    const el = $(id);
    if (el) {
      el.classList.add("show");
      document.body.style.overflow = "hidden";
    }
  }

  function closeModal(id) {
    const el = $(id);
    if (el) el.classList.remove("show");
    const stillOpen = document.querySelector(".modal-backdrop.show");
    if (!stillOpen) document.body.style.overflow = "";
  }

  document.querySelectorAll(".js-close-modal").forEach((btn) => {
    btn.addEventListener("click", function () {
      closeModal(this.dataset.modal);
    });
  });

  ["mRecord"].forEach((id) => {
    const modal = $(id);
    if (!modal) return;
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal(id);
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show"));
      document.body.style.overflow = "";
    }
  });

  const viewInput = $("viewInput");
  document.querySelectorAll("#viewChips .chip").forEach((btn) => {
    btn.addEventListener("click", function () {
      if (!viewInput) return;
      viewInput.value = this.dataset.view;
      const form = this.closest("form");
      if (form) form.submit();
    });
  });

  function showRecord(type) {
    document.querySelectorAll(".record-pane").forEach((pane) => {
      pane.style.display = "none";
    });

    const pane = $("record-" + type);
    if (pane) pane.style.display = "";

    const form = $("recordForm");
    if (!form) return;

    if (type === "invoice") {
      $("mRecordTitle").textContent = "New Invoice";
      form.action = "/admin/finance/invoices";
    } else if (type === "payment") {
      $("mRecordTitle").textContent = "Record Payment";
      form.action = "/admin/finance/payments";
    } else if (type === "fee") {
      $("mRecordTitle").textContent = "New Fee Structure";
      form.action = "/admin/finance/fee-structures";
    } else if (type === "expense") {
      $("mRecordTitle").textContent = "New Expense";
      form.action = "/admin/finance/expenses";
    } else if (type === "payroll") {
      $("mRecordTitle").textContent = "New Payroll Summary";
      form.action = "/admin/finance/payroll-summaries";
    }

    openModal("mRecord");
  }

  $("btnAddRecord")?.addEventListener("click", function () {
    showRecord("invoice");
  });

  document.querySelectorAll(".js-open-record").forEach((btn) => {
    btn.addEventListener("click", function () {
      showRecord(this.dataset.type);
    });
  });

  $("btnExport")?.addEventListener("click", function () {
    alert("Export finance report can be wired next.");
  });

  $("btnReports")?.addEventListener("click", function () {
    alert("Finance reports page can be added next.");
  });

  $("btnSettings")?.addEventListener("click", function () {
    alert("Finance settings page/modal can be added next.");
  });
})();
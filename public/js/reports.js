(function () {
  const $ = (id) => document.getElementById(id);

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

  function activatePane(id) {
    document.querySelectorAll(".tabbtn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.pane === id);
    });

    document.querySelectorAll(".pane").forEach((pane) => {
      pane.classList.toggle("active", pane.id === id);
    });
  }

  function setTodayRangeAndType(type) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const value = `${yyyy}-${mm}-${dd}`;

    const typeEl = document.querySelector('select[name="type"]');
    const fromEl = document.querySelector('input[name="from"]');
    const toEl = document.querySelector('input[name="to"]');

    if (typeEl) typeEl.value = type;
    if (fromEl) fromEl.value = value;
    if (toEl) toEl.value = value;

    const form = typeEl?.closest("form");
    if (form) form.submit();
  }

  function setTypeAndSubmit(type) {
    const typeEl = document.querySelector('select[name="type"]');
    const form = typeEl?.closest("form");
    if (typeEl) typeEl.value = type;
    if (form) form.submit();
  }

  document.querySelectorAll(".tabbtn").forEach((btn) => {
    btn.addEventListener("click", function () {
      activatePane(btn.dataset.pane);
    });
  });

  const btnPrint = $("btnPrint");
  if (btnPrint) {
    btnPrint.addEventListener("click", function () {
      window.print();
    });
  }

  const btnImport = $("btnImport");
  if (btnImport) {
    btnImport.addEventListener("click", function () {
      openModal("mImport");
    });
  }

  const importFile = $("importFile");
  const importFileName = $("importFileName");
  if (importFile && importFileName) {
    importFile.addEventListener("change", function () {
      const file = importFile.files && importFile.files[0];
      importFileName.textContent = file ? `${file.name} • ${Math.round(file.size / 1024)} KB` : "No file selected";
    });
  }

  const importForm = $("importForm");
  if (importForm) {
    importForm.addEventListener("submit", function (e) {
      const file = importFile?.files?.[0];
      if (!file) {
        e.preventDefault();
        alert("Please choose a CSV file.");
        return;
      }

      if (!/\.csv$/i.test(file.name)) {
        e.preventDefault();
        alert("Only CSV files are allowed.");
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        e.preventDefault();
        alert("CSV file is too large. Maximum allowed size is 5 MB.");
      }
    });
  }

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  ["mImport"].forEach(function (mid) {
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

  const quickFinanceToday = $("quickFinanceToday");
  if (quickFinanceToday) {
    quickFinanceToday.addEventListener("click", function () {
      setTodayRangeAndType("finance_summary");
    });
  }

  const quickInvoices = $("quickInvoices");
  if (quickInvoices) {
    quickInvoices.addEventListener("click", function () {
      setTypeAndSubmit("invoices");
    });
  }

  const quickOutstanding = $("quickOutstanding");
  if (quickOutstanding) {
    quickOutstanding.addEventListener("click", function () {
      setTypeAndSubmit("students_outstanding");
    });
  }
})();
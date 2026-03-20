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

  ["mBook", "mViewBook", "mAction", "mBulk"].forEach((mid) => {
    const modal = $(mid);
    if (!modal) return;
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(mid);
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

  const selected = new Set();

  function syncBulkbar() {
    const selCount = $("selCount");
    const bulkbar = $("bulkbar");
    const currentView = viewInput ? viewInput.value : "catalog";
    if (selCount) selCount.textContent = selected.size;
    if (bulkbar) bulkbar.classList.toggle("show", selected.size > 0 && currentView === "catalog");
  }

  $("btnAddBook")?.addEventListener("click", function () {
    $("mBookTitle").textContent = "Add Book";
    $("bookForm").action = "/admin/library/books";

    $("bTitle").value = "";
    $("bAuthor").value = "";
    $("bIsbn").value = "";
    $("bCategory").value = "Computer Science";
    $("bPublisher").value = "";
    $("bYear").value = 2020;
    $("bCopies").value = 1;
    $("bAvailable").value = 1;
    $("bStatus").value = "Available";
    $("bShelf").value = "";
    $("bNotes").value = "";

    openModal("mBook");
  });

  document.querySelectorAll(".actEdit").forEach((btn) => {
    btn.addEventListener("click", function () {
      const book = JSON.parse(this.dataset.book || "{}");
      $("mBookTitle").textContent = "Edit Book";
      $("bookForm").action = "/admin/library/books/" + book._id + "/update";

      $("bTitle").value = book.title || "";
      $("bAuthor").value = book.author || "";
      $("bIsbn").value = book.isbn || "";
      $("bCategory").value = book.category || "Other";
      $("bPublisher").value = book.publisher || "";
      $("bYear").value = book.year || 2020;
      $("bCopies").value = book.copies || 1;
      $("bAvailable").value = book.available || 0;
      $("bStatus").value = book.status || "Available";
      $("bShelf").value = book.shelf || "";
      $("bNotes").value = book.notes || "";

      openModal("mBook");
    });
  });

  document.querySelectorAll(".actView").forEach((btn) => {
    btn.addEventListener("click", function () {
      const book = JSON.parse(this.dataset.book || "{}");
      $("vTitle").textContent = book.title || "—";
      $("vAuthor").textContent = book.author || "—";
      $("vIsbn").textContent = book.isbn || "—";
      $("vCategory").textContent = book.category || "—";
      $("vPublisher").textContent = book.publisher || "—";
      $("vYear").textContent = book.year || "—";
      $("vCopies").textContent = book.copies ?? "—";
      $("vAvailable").textContent = book.available ?? "—";
      $("vStatus").textContent = book.status || "—";
      $("vShelf").textContent = book.shelf || "—";
      $("vNotes").textContent = book.notes || "No notes";
      openModal("mViewBook");
    });
  });

  document.querySelectorAll(".rowCheck").forEach((box) => {
    box.addEventListener("change", function () {
      const id = this.dataset.id;
      if (this.checked) selected.add(id);
      else selected.delete(id);
      syncBulkbar();
    });
  });

  $("checkAll")?.addEventListener("change", function () {
    const rowChecks = document.querySelectorAll(".rowCheck");
    rowChecks.forEach((box) => {
      box.checked = this.checked;
      if (this.checked) selected.add(box.dataset.id);
      else selected.delete(box.dataset.id);
    });
    syncBulkbar();
  });

  $("bulkClear")?.addEventListener("click", function () {
    selected.clear();
    document.querySelectorAll(".rowCheck, #checkAll").forEach((el) => (el.checked = false));
    syncBulkbar();
  });

  $("btnBulk")?.addEventListener("click", function () {
    openModal("mBulk");
  });

  $("bulkCategory")?.addEventListener("click", function () {
    openModal("mBulk");
  });

  $("bulkMarkDamaged")?.addEventListener("click", function () {
    alert("Bulk damaged action UI is ready. Connect it to a bulk backend route next.");
  });

  $("bulkArchive")?.addEventListener("click", function () {
    alert("Bulk archive UI is ready. Connect it to a bulk backend route next.");
  });

  $("applyBulkBtn")?.addEventListener("click", function () {
    alert("Bulk apply is ready. Next step is wiring one bulk endpoint for selected book ids.");
    closeModal("mBulk");
  });

  $("btnImport")?.addEventListener("click", function () {
    alert("Import UI is ready. Next step is backend CSV/Excel upload.");
  });

  $("btnExport")?.addEventListener("click", function () {
    window.location.href = "/admin/library";
  });

  $("btnReports")?.addEventListener("click", function () {
    alert("Reports page/modal can be added next.");
  });

  $("btnQuickReturn")?.addEventListener("click", function () {
    if (viewInput) {
      viewInput.value = "borrow";
      const form = viewInput.closest("form");
      if (form) form.submit();
    }
  });

  $("btnAddCopy")?.addEventListener("click", function () {
    alert("Use the + button in the catalog table for the exact book you want.");
  });

  $("btnCreateFine")?.addEventListener("click", function () {
    $("mActionTitle").textContent = "Create Fine";
    $("actionForm").action = "";
    $("aMode").value = "fine";
    $("aStudent").value = "";
    $("aReg").value = "";
    $("aRef").value = "";
    $("aAmount").value = 0;
    $("aStatus").value = "Pending";
    $("aType").value = "Library Hold";
    $("aNote").value = "";
    openModal("mAction");
  });

  $("btnPlaceHold")?.addEventListener("click", function () {
    $("mActionTitle").textContent = "Place Hold";
    $("actionForm").action = "";
    $("aMode").value = "hold";
    $("aStudent").value = "";
    $("aReg").value = "";
    $("aRef").value = "";
    $("aAmount").value = 0;
    $("aStatus").value = "Active Hold";
    $("aType").value = "Library Hold";
    $("aNote").value = "";
    openModal("mAction");
  });

  $("btnRecordPay")?.addEventListener("click", function () {
    alert("Use the Pay button in the fines table for a specific fine.");
  });

  $("btnSetRate")?.addEventListener("click", function () {
    alert("Fine-rate settings page/modal can be added next.");
  });

  document.querySelectorAll(".brFine").forEach((btn) => {
    btn.addEventListener("click", function () {
      $("mActionTitle").textContent = "Create Fine";
      $("aMode").value = "fine";
      $("actionForm").action = "/admin/library/books/" + this.dataset.bookId + "/fines";

      $("aStudent").value = this.dataset.student || "";
      $("aReg").value = this.dataset.reg || "";
      $("aRef").value = this.dataset.ref || "";
      $("aAmount").value = 5000;
      $("aStatus").value = "Pending";
      $("aType").value = "Library Hold";
      $("aNote").value = "";

      openModal("mAction");
    });
  });

  document.querySelectorAll(".fineHold").forEach((btn) => {
    btn.addEventListener("click", function () {
      $("mActionTitle").textContent = "Place Hold";
      $("aMode").value = "hold";
      $("actionForm").action = "/admin/library/books/" + this.dataset.bookId + "/holds";

      $("aStudent").value = this.dataset.student || "";
      $("aReg").value = this.dataset.reg || "";
      $("aRef").value = this.dataset.ref || "";
      $("aAmount").value = 0;
      $("aStatus").value = "Active Hold";
      $("aType").value = "Library Hold";
      $("aNote").value = "";

      openModal("mAction");
    });
  });

  document.querySelectorAll(".holdEdit").forEach((btn) => {
    btn.addEventListener("click", function () {
      $("mActionTitle").textContent = "Create Hold";
      $("aMode").value = "hold";
      $("actionForm").action = "/admin/library/books/" + this.dataset.bookId + "/holds";

      $("aStudent").value = this.dataset.student || "";
      $("aReg").value = this.dataset.reg || "";
      $("aRef").value = this.dataset.ref || "";
      $("aAmount").value = 0;
      $("aStatus").value = this.dataset.status || "Active Hold";
      $("aType").value = "Library Hold";
      $("aNote").value = "";

      openModal("mAction");
    });
  });

  $("actionForm")?.addEventListener("submit", function (e) {
    const mode = $("aMode").value;

    if (!this.action) {
      e.preventDefault();
      alert(
        mode === "fine"
          ? "Open this from a specific borrow/fine context, or wire a generic fine endpoint."
          : "Open this from a specific book/fine context, or wire a generic hold endpoint."
      );
    }
  });

  syncBulkbar();
})();
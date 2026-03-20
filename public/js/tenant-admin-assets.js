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

  ["mAsset", "mViewAsset", "mAssign", "mMaint"].forEach((id) => {
    const modal = $(id);
    if (!modal) return;
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal(id);
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach((el) => {
        el.classList.remove("show");
      });
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

  $("btnAddAsset")?.addEventListener("click", function () {
    $("mAssetTitle").textContent = "Add Asset";
    $("assetForm").action = "/admin/assets";
    $("aTag").value = "";
    $("aName").value = "";
    $("aCategory").value = "Other";
    $("aBrand").value = "";
    $("aModel").value = "";
    $("aSerial").value = "";
    $("aQuantity").value = 1;
    $("aUnitCost").value = 0;
    $("aPurchaseDate").value = "";
    $("aSupplier").value = "";
    $("aLocation").value = "";
    $("aCondition").value = "Good";
    $("aStatus").value = "Available";
    $("aNotes").value = "";
    openModal("mAsset");
  });

  document.querySelectorAll(".js-edit-asset").forEach((btn) => {
    btn.addEventListener("click", function () {
      const asset = JSON.parse(this.dataset.asset || "{}");
      $("mAssetTitle").textContent = "Edit Asset";
      $("assetForm").action = "/admin/assets/" + asset._id + "/update";
      $("aTag").value = asset.assetTag || "";
      $("aName").value = asset.name || "";
      $("aCategory").value = asset.category || "Other";
      $("aBrand").value = asset.brand || "";
      $("aModel").value = asset.model || "";
      $("aSerial").value = asset.serialNumber || "";
      $("aQuantity").value = asset.quantity || 1;
      $("aUnitCost").value = asset.unitCost || 0;
      $("aPurchaseDate").value = asset.purchaseDate ? String(asset.purchaseDate).slice(0, 10) : "";
      $("aSupplier").value = asset.supplier || "";
      $("aLocation").value = asset.location || "";
      $("aCondition").value = asset.condition || "Good";
      $("aStatus").value = asset.status || "Available";
      $("aNotes").value = asset.notes || "";
      openModal("mAsset");
    });
  });

  document.querySelectorAll(".js-view-asset").forEach((btn) => {
    btn.addEventListener("click", function () {
      const asset = JSON.parse(this.dataset.asset || "{}");
      $("vTag").textContent = asset.assetTag || "—";
      $("vName").textContent = asset.name || "—";
      $("vCategory").textContent = asset.category || "—";
      $("vBrand").textContent = asset.brand || "—";
      $("vModel").textContent = asset.model || "—";
      $("vSerial").textContent = asset.serialNumber || "—";
      $("vQty").textContent = asset.quantity ?? "—";
      $("vCost").textContent = "UGX " + Number(asset.unitCost || 0).toLocaleString();
      $("vLocation").textContent = asset.location || "—";
      $("vCondition").textContent = asset.condition || "—";
      $("vStatus").textContent = asset.status || "—";
      $("vSupplier").textContent = asset.supplier || "—";
      $("vPurchaseDate").textContent = asset.purchaseDate ? String(asset.purchaseDate).slice(0, 10) : "—";
      $("vNotes").textContent = asset.notes || "No notes";
      $("vAssignments").textContent = (asset.assignments || []).length;
      $("vMaintenance").textContent = (asset.maintenanceLogs || []).length;
      $("vMovements").textContent = (asset.movements || []).length;
      openModal("mViewAsset");
    });
  });

  document.querySelectorAll(".js-assign-asset").forEach((btn) => {
    btn.addEventListener("click", function () {
      const id = this.dataset.id;
      const tag = this.dataset.tag;
      $("assignForm").action = "/admin/assets/" + id + "/assign";
      $("assignAssetTag").textContent = tag || "—";
      openModal("mAssign");
    });
  });

  document.querySelectorAll(".js-maint-asset").forEach((btn) => {
    btn.addEventListener("click", function () {
      const id = this.dataset.id;
      const tag = this.dataset.tag;
      $("maintForm").action = "/admin/assets/" + id + "/maintenance";
      $("maintAssetTag").textContent = tag || "—";
      openModal("mMaint");
    });
  });
})();
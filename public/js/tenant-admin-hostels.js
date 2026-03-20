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
    if (el) {
      el.classList.remove("show");
    }

    const stillOpen = document.querySelector(".modal-backdrop.show");
    if (!stillOpen) {
      document.body.style.overflow = "";
    }
  }

  document.querySelectorAll(".js-close-modal").forEach((btn) => {
    btn.addEventListener("click", function () {
      closeModal(this.dataset.modal);
    });
  });

  ["mRoom", "mViewRoom", "mAssign", "mMaint"].forEach((id) => {
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

  $("btnAddRoom")?.addEventListener("click", function () {
    $("mRoomTitle").textContent = "Add Room";
    $("roomForm").action = "/admin/hostels/rooms";
    $("rBlock").value = "";
    $("rCode").value = "";
    $("rGender").value = "Male";
    $("rType").value = "Standard";
    $("rBeds").value = 4;
    $("rPrice").value = 250000;
    $("rStatus").value = "Available";
    $("rWarden").value = "";
    $("rNotes").value = "";
    openModal("mRoom");
  });

  document.querySelectorAll(".js-edit-room").forEach((btn) => {
    btn.addEventListener("click", function () {
      const room = JSON.parse(this.dataset.room || "{}");
      $("mRoomTitle").textContent = "Edit Room";
      $("roomForm").action = "/admin/hostels/rooms/" + room._id + "/update";
      $("rBlock").value = room.block || "";
      $("rCode").value = room.code || "";
      $("rGender").value = room.gender || "Male";
      $("rType").value = room.type || "Standard";
      $("rBeds").value = room.beds || 1;
      $("rPrice").value = room.pricePerSemester || 0;
      $("rStatus").value = room.status || "Available";
      $("rWarden").value = room.warden || "";
      $("rNotes").value = room.notes || "";
      openModal("mRoom");
    });
  });

  document.querySelectorAll(".js-view-room").forEach((btn) => {
    btn.addEventListener("click", function () {
      const room = JSON.parse(this.dataset.room || "{}");
      $("vCode").textContent = room.code || "—";
      $("vBlock").textContent = room.block || "—";
      $("vGender").textContent = room.gender || "—";
      $("vType").textContent = room.type || "—";
      $("vBeds").textContent = room.beds ?? "—";
      $("vOccupied").textContent = room.occupied ?? "—";
      $("vPrice").textContent = "UGX " + Number(room.pricePerSemester || 0).toLocaleString();
      $("vStatus").textContent = room.status || "—";
      $("vWarden").textContent = room.warden || "—";
      $("vUpdated").textContent = room.updatedAt ? String(room.updatedAt).slice(0, 10) : "—";
      $("vNotes").textContent = room.notes || "No notes";
      $("vApplications").textContent = (room.applications || []).length;
      $("vCheckins").textContent = (room.checkins || []).length;
      $("vMaintenance").textContent = (room.maintenanceTickets || []).length;
      $("vDiscipline").textContent = (room.disciplineCases || []).length;
      $("vFees").textContent = (room.feeReceipts || []).length;
      openModal("mViewRoom");
    });
  });

  document.querySelectorAll(".js-assign-room").forEach((btn) => {
    btn.addEventListener("click", function () {
      const id = this.dataset.id;
      const code = this.dataset.code;
      $("assignForm").action = "/admin/hostels/rooms/" + id + "/allocate";
      $("assignRoomCode").textContent = code || "—";
      openModal("mAssign");
    });
  });

  document.querySelectorAll(".js-maint-room").forEach((btn) => {
    btn.addEventListener("click", function () {
      const id = this.dataset.id;
      const code = this.dataset.code;
      $("maintForm").action = "/admin/hostels/rooms/" + id + "/maintenance";
      $("maintRoomCode").textContent = code || "—";
      openModal("mMaint");
    });
  });

  $("btnExport")?.addEventListener("click", function () {
    alert("Export hostel report can be wired next.");
  });

  $("btnReports")?.addEventListener("click", function () {
    alert("Hostel reports page can be added next.");
  });

  $("btnPolicies")?.addEventListener("click", function () {
    alert("Hostel policies page/modal can be added next.");
  });
})();
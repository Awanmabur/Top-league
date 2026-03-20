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

  ["mStaff", "mViewStaff", "mAttendance", "mLeave"].forEach((id) => {
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

  function resetStaffForm() {
    $("sEmployeeNo").value = "";
    $("sFirstName").value = "";
    $("sLastName").value = "";
    $("sGender").value = "Male";
    $("sEmail").value = "";
    $("sPhone").value = "";
    $("sDepartment").value = "";
    $("sRole").value = "";
    $("sEmploymentType").value = "Permanent";
    $("sStatus").value = "Active";
    $("sDateJoined").value = "";
    $("sBasicSalary").value = "";
    $("sAddress").value = "";
    $("sEmergencyContact").value = "";
    $("sNotes").value = "";
  }

  $("btnAddStaff")?.addEventListener("click", function () {
    $("mStaffTitle").textContent = "Add Staff";
    $("staffForm").action = "/admin/staff/records";
    resetStaffForm();
    openModal("mStaff");
  });

  $("btnAddStaff2")?.addEventListener("click", function () {
    $("btnAddStaff")?.click();
  });

  document.querySelectorAll(".js-edit-staff").forEach((btn) => {
    btn.addEventListener("click", function () {
      const staff = JSON.parse(this.dataset.staff || "{}");
      $("mStaffTitle").textContent = "Edit Staff";
      $("staffForm").action = "/admin/staff/records/" + staff._id + "/update";

      $("sEmployeeNo").value = staff.employeeNo || "";
      $("sFirstName").value = staff.firstName || "";
      $("sLastName").value = staff.lastName || "";
      $("sGender").value = staff.gender || "Male";
      $("sEmail").value = staff.email || "";
      $("sPhone").value = staff.phone || "";
      $("sDepartment").value = staff.department || "";
      $("sRole").value = staff.role || "";
      $("sEmploymentType").value = staff.employmentType || "Permanent";
      $("sStatus").value = staff.status || "Active";
      $("sDateJoined").value = staff.dateJoined ? String(staff.dateJoined).slice(0, 10) : "";
      $("sBasicSalary").value = staff.basicSalary || "";
      $("sAddress").value = staff.address || "";
      $("sEmergencyContact").value = staff.emergencyContact || "";
      $("sNotes").value = staff.notes || "";

      openModal("mStaff");
    });
  });

  document.querySelectorAll(".js-view-staff").forEach((btn) => {
    btn.addEventListener("click", function () {
      const staff = JSON.parse(this.dataset.staff || "{}");
      $("vEmployeeNo").textContent = staff.employeeNo || "—";
      $("vName").textContent = ((staff.firstName || "") + " " + (staff.lastName || "")).trim() || "—";
      $("vDepartment").textContent = staff.department || "—";
      $("vRole").textContent = staff.role || "—";
      $("vEmail").textContent = staff.email || "—";
      $("vPhone").textContent = staff.phone || "—";
      $("vStatus").textContent = staff.status || "—";
      $("vDateJoined").textContent = staff.dateJoined ? String(staff.dateJoined).slice(0, 10) : "—";
      $("vBasicSalary").textContent = "UGX " + Number(staff.basicSalary || 0).toLocaleString();
      $("vEmploymentType").textContent = staff.employmentType || "—";
      $("vNotes").textContent = staff.notes || "No notes";
      openModal("mViewStaff");
    });
  });

  document.querySelectorAll(".js-att-staff").forEach((btn) => {
    btn.addEventListener("click", function () {
      $("attendanceForm").action = "/admin/staff/records/" + this.dataset.id + "/attendance";
      $("attStaffName").textContent = this.dataset.name || "—";
      openModal("mAttendance");
    });
  });

  document.querySelectorAll(".js-leave-staff").forEach((btn) => {
    btn.addEventListener("click", function () {
      $("leaveForm").action = "/admin/staff/records/" + this.dataset.id + "/leave";
      $("leaveStaffName").textContent = this.dataset.name || "—";
      openModal("mLeave");
    });
  });

  $("btnExport")?.addEventListener("click", function () {
    alert("Export staff report can be wired next.");
  });

  $("btnReports")?.addEventListener("click", function () {
    alert("Staff reports page can be added next.");
  });

  $("btnPolicies")?.addEventListener("click", function () {
    alert("HR policies page/modal can be added next.");
  });
})();
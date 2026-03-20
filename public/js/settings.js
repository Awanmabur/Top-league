(function () {
  const $ = (id) => document.getElementById(id);

  function readSettingsData() {
    const el = $("settingsData");
    if (!el) return {};
    try {
      return JSON.parse(el.value || "{}");
    } catch (err) {
      console.error("Failed to parse settings data:", err);
      return {};
    }
  }

  const SETTINGS = readSettingsData();

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

  function setSwitch(el, on) {
    if (!el) return;
    el.classList.toggle("on", !!on);
  }

  function syncHiddenInputs() {
    $("channelPortal").value = $("chPortal").classList.contains("on") ? "true" : "false";
    $("channelEmail").value = $("chEmail").classList.contains("on") ? "true" : "false";
    $("channelSms").value = $("chSms").classList.contains("on") ? "true" : "false";
    $("channelPush").value = $("chPush").classList.contains("on") ? "true" : "false";
    $("portalAllowPublicAdmissions").value = $("pAdmissions").classList.contains("on") ? "true" : "false";
    $("portalRequireStudentLogin").value = $("pLogin").classList.contains("on") ? "true" : "false";
    $("portalMaintenanceMode").value = $("pMaintenance").classList.contains("on") ? "true" : "false";
  }

  function openEditor(section) {
    $("mTitle").textContent = section ? `Edit ${section}` : "Edit Settings";

    $("sSchoolName").value = SETTINGS.schoolName || "";
    $("sSchoolEmail").value = SETTINGS.schoolEmail || "";
    $("sSchoolPhone").value = SETTINGS.schoolPhone || "";
    $("sSchoolAddress").value = SETTINGS.schoolAddress || "";
    $("sPrimaryColor").value = SETTINGS.primaryColor || "#0a6fbf";
    $("sSecondaryColor").value = SETTINGS.secondaryColor || "#0d4060";
    $("sLogoUrl").value = SETTINGS.logoUrl || "";
    $("sDefaultSenderName").value = SETTINGS.defaultSenderName || "";
    $("sReplyToEmail").value = SETTINGS.replyToEmail || "";
    $("sSmtpHost").value = SETTINGS.integrations?.smtpHost || "";
    $("sSmsProvider").value = SETTINGS.integrations?.smsProvider || "";
    $("sCloudStorage").value = SETTINGS.integrations?.cloudStorage || "";

    setSwitch($("chPortal"), SETTINGS.channels?.portal);
    setSwitch($("chEmail"), SETTINGS.channels?.email);
    setSwitch($("chSms"), SETTINGS.channels?.sms);
    setSwitch($("chPush"), SETTINGS.channels?.push);
    setSwitch($("pAdmissions"), SETTINGS.portal?.allowPublicAdmissions);
    setSwitch($("pLogin"), SETTINGS.portal?.requireStudentLogin);
    setSwitch($("pMaintenance"), SETTINGS.portal?.maintenanceMode);

    syncHiddenInputs();
    openModal("mEdit");
  }

  function setTab(tab) {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    document.querySelectorAll(".tab-pane").forEach((pane) => {
      pane.classList.toggle("active", pane.id === `tab-${tab}`);
    });
  }

  $("btnOpenEdit").addEventListener("click", function () {
    openEditor("");
  });

  $("quickGeneral").addEventListener("click", function () {
    setTab("general");
    openEditor("General");
  });

  $("quickBranding").addEventListener("click", function () {
    setTab("branding");
    openEditor("Branding");
  });

  $("quickCommunication").addEventListener("click", function () {
    setTab("communication");
    openEditor("Communication");
  });

  $("btnResetDefaults").addEventListener("click", function () {
    alert("Hook reset defaults route later.");
  });

  $("btnTestConfig").addEventListener("click", function () {
    alert("Hook test configuration actions later.");
  });

  $("sectionTabs").addEventListener("click", function (e) {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    setTab(btn.dataset.tab);
  });

  ["chPortal", "chEmail", "chSms", "chPush", "pAdmissions", "pLogin", "pMaintenance"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("click", function () {
      el.classList.toggle("on");
      syncHiddenInputs();
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeModal(btn.dataset.closeModal);
    });
  });

  const modal = $("mEdit");
  if (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target.id === "mEdit") closeModal("mEdit");
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach(function (el) {
        el.classList.remove("show");
      });
    }
  });

  setTab("general");
})();
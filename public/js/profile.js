(function () {
  const $ = (id) => document.getElementById(id);

  function parseProfile() {
    const el = $("profileData");
    if (!el) return {};
    try {
      return JSON.parse(el.value || "{}");
    } catch (err) {
      console.error("Failed to parse profile data:", err);
      return {};
    }
  }

  const PROFILE = parseProfile();

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

  function setTab(tab) {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    document.querySelectorAll(".tab-pane").forEach((pane) => {
      pane.classList.toggle("active", pane.id === `tab-${tab}`);
    });
  }

  function fillForm(data) {
    $("pSchoolName").value = data.schoolName || "";
    $("pShortName").value = data.shortName || "";
    $("pTagline").value = data.tagline || "";
    $("pCategory").value = data.category || "";
    $("pEmail").value = data.email || "";
    $("pPhone").value = data.phone || "";
    $("pAltPhone").value = data.altPhone || "";
    $("pWebsite").value = data.website || "";
    $("pLogoUrl").value = data.logoUrl || "";
    $("pFaviconUrl").value = data.faviconUrl || "";
    $("pPrimaryColor").value = data.primaryColor || "#0a6fbf";
    $("pSecondaryColor").value = data.secondaryColor || "#0d4060";
    $("pMotto").value = data.motto || "";
    $("pTenantCode").value = data.tenantCode || "";
    $("pPlanName").value = data.planName || "";
    $("pSubscriptionStatus").value = data.subscriptionStatus || "";
    $("pBillingEmail").value = data.billingEmail || "";
    $("pSubdomain").value = data.subdomain || "";
    $("pCustomDomain").value = data.customDomain || "";
    $("pDomainStatus").value = data.domainStatus || "";
    $("pSslStatus").value = data.sslStatus || "";
    $("pAddress").value = data.address || "";
    $("pDescription").value = data.description || "";
  }

  const tabs = $("sectionTabs");
  if (tabs) {
    tabs.addEventListener("click", function (e) {
      const btn = e.target.closest(".tab-btn");
      if (!btn) return;
      setTab(btn.dataset.tab);
    });
  }

  const btnEdit = $("btnEdit");
  if (btnEdit) {
    btnEdit.addEventListener("click", function () {
      fillForm(PROFILE);
      openModal("mEdit");
    });
  }

  const btnPreview = $("btnPreview");
  if (btnPreview) {
    btnPreview.addEventListener("click", function () {
      setTab("overview");
    });
  }

  const btnStatus = $("btnStatus");
  if (btnStatus) {
    btnStatus.addEventListener("click", function () {
      setTab("tenant");
    });
  }

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

  setTab("overview");
})();
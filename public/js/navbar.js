(() => {
  const sidebar = document.getElementById("sidebar");
  const mobileBtn = document.getElementById("mobileMenuBtn");
  const collapseBtn = document.getElementById("sbToggle");

  if (!sidebar) return;

  const firstPath = window.location.pathname.split("/").filter(Boolean)[0] || "tenant";
  const portal = document.body?.dataset?.portal || firstPath;
  const storageKey = `classic_academy_sidebar_${portal}`;
  const isMobile = () => window.matchMedia("(max-width:1100px)").matches;

  function openMobile() {
    sidebar.classList.add("open");
    mobileBtn?.setAttribute("aria-expanded", "true");
  }

  function closeMobile() {
    sidebar.classList.remove("open");
    mobileBtn?.setAttribute("aria-expanded", "false");
  }

  mobileBtn?.setAttribute("aria-expanded", "false");
  mobileBtn?.addEventListener("click", () => {
    sidebar.classList.contains("open") ? closeMobile() : openMobile();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobile();
  });

  document.addEventListener("click", (event) => {
    if (!isMobile() || !sidebar.classList.contains("open")) return;

    const clickedSidebar = sidebar.contains(event.target);
    const clickedToggle = mobileBtn?.contains(event.target);

    if (!clickedSidebar && !clickedToggle) {
      closeMobile();
    }
  });

  window.addEventListener("resize", () => {
    if (!isMobile()) closeMobile();
  });

  sidebar.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (link && isMobile()) closeMobile();
  });

  if (collapseBtn) {
    const icon = collapseBtn.querySelector("i");

    function syncIcon() {
      if (!icon) return;
      icon.className = sidebar.classList.contains("collapsed")
        ? "fa fa-angle-right"
        : "fa fa-angle-left";
    }

    if (localStorage.getItem(storageKey) === "1") {
      sidebar.classList.add("collapsed");
    }
    syncIcon();

    collapseBtn.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
      localStorage.setItem(storageKey, sidebar.classList.contains("collapsed") ? "1" : "0");
      syncIcon();
    });
  }

  (() => {
    const links = document.querySelectorAll(".navbutton[href]");
    const path = window.location.pathname;
    let best = null;

    links.forEach((link) => link.classList.remove("active"));

    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || href === "/" || href === "/logout") return;

      if (path === href || path.startsWith(`${href}/`)) {
        if (!best || href.length > best.getAttribute("href").length) {
          best = link;
        }
      }
    });

    best?.classList.add("active");
  })();

  (() => {
    let tip = document.querySelector(".cc-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "cc-tooltip";
      document.body.appendChild(tip);
    }

    function showTip(text, x, y) {
      tip.textContent = text || "";
      tip.style.left = `${x + 12}px`;
      tip.style.top = `${y}px`;
      tip.style.opacity = "1";
    }

    function hideTip() {
      tip.style.opacity = "0";
    }

    sidebar.querySelectorAll(".navbutton[data-label]").forEach((item) => {
      item.addEventListener("mouseenter", () => {
        if (!sidebar.classList.contains("collapsed")) return;
        const label = item.dataset.label || item.textContent.trim();
        const rect = item.getBoundingClientRect();
        showTip(label, rect.right, rect.top + rect.height / 2);
      });

      item.addEventListener("mousemove", () => {
        if (!sidebar.classList.contains("collapsed")) return;
        const label = item.dataset.label || item.textContent.trim();
        const rect = item.getBoundingClientRect();
        showTip(label, rect.right, rect.top + rect.height / 2);
      });

      item.addEventListener("mouseleave", hideTip);
    });

    window.addEventListener("scroll", hideTip, true);
  })();
})();

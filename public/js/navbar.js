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

  (() => {
    const MOBILE_BREAKPOINT = "(max-width: 640px)";
    const filterLayoutSelector = ".toolbar .left, .toolbar .right, .filters-row";
    const controlSelector =
      'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, .input, .select';

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function clearSizing(control) {
      const layoutParent = control.closest(filterLayoutSelector);
      if (!layoutParent) return;

      let item = control;
      while (item.parentElement && item.parentElement !== layoutParent) {
        item = item.parentElement;
      }

      item.style.removeProperty("flex");
      item.style.removeProperty("width");
      item.style.removeProperty("min-width");
      item.style.removeProperty("grid-column");

      control.style.removeProperty("width");
      control.style.removeProperty("min-width");
      control.style.removeProperty("max-width");
    }

    function baseTextForControl(control) {
      const explicit = (control.dataset.sizeText || "").trim();
      if (explicit) return explicit;

      if (control.matches("select")) {
        const anchorOption = Array.from(control.options || []).find((option) => {
          if ((option.dataset.sizeText || "").trim()) return true;
          if (option.hasAttribute("data-size-anchor")) return true;
          return Boolean((option.textContent || "").trim());
        });

        const anchorText =
          (anchorOption?.dataset.sizeText || "").trim() ||
          (anchorOption?.textContent || "").trim();

        return (
          anchorText ||
          control.getAttribute("placeholder") ||
          control.getAttribute("aria-label") ||
          "Option"
        ).trim();
      }

      const type = (control.getAttribute("type") || "text").toLowerCase();

      if (type === "datetime-local") return "2026-12-31 23:59";
      if (type === "date") return "2026-12-31";
      if (type === "time") return "23:59";
      if (type === "month") return "2026-12";
      if (type === "week") return "2026-W52";
      if (type === "number") return control.getAttribute("placeholder") || "0000";

      const placeholder = (control.getAttribute("placeholder") || "").trim();
      if (placeholder) return placeholder;

      const label = control.closest(".field")?.querySelector("label");
      if (label?.textContent?.trim()) return label.textContent.trim();

      return control.getAttribute("name") || "Field";
    }

    function spanForControl(control) {
      const explicit = Number(control.dataset.sizeSpan || "");
      if (Number.isFinite(explicit) && explicit >= 1) {
        return clamp(Math.round(explicit), 1, 2);
      }

      const isSearch =
        control.matches('input[name="q"]') ||
        control.matches('input[type="search"]') ||
        control.matches('.input[name="q"]');

      if (isSearch) return 2;
      return 1;
    }

    function applyCompactSizing() {
      const isCompact = window.matchMedia(MOBILE_BREAKPOINT).matches;
      document.querySelectorAll(controlSelector).forEach((control) => {
        const layoutParent = control.closest(filterLayoutSelector);
        if (!layoutParent) return;

        if (!isCompact) {
          clearSizing(control);
          return;
        }

        let item = control;
        while (item.parentElement && item.parentElement !== layoutParent) {
          item = item.parentElement;
        }

        const span = spanForControl(control);

        item.style.setProperty("grid-column", `span ${span}`, "important");
        item.style.setProperty("min-width", "0", "important");

        control.style.setProperty("width", "100%", "important");
        control.style.setProperty("min-width", "0", "important");
        control.style.setProperty("max-width", "100%", "important");
      });
    }

    applyCompactSizing();
    window.addEventListener("resize", applyCompactSizing);
    window.addEventListener("pageshow", applyCompactSizing);
  })();
})();

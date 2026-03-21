(() => {
  const navbar = document.querySelector(".header .navbar");
  const menuBtn = document.getElementById("menu-btn");
  const toTopBtn = document.getElementById("toTopBtn");

  const filterForm = document.getElementById("schoolsFilterForm");
  const qInput = document.getElementById("schoolsQ");
  const citySelect = document.getElementById("schoolsCity");
  const typeSelect = document.getElementById("schoolsType");
  const sortSelect = document.getElementById("schoolsSort");
  const verifiedInput = document.getElementById("schoolsVerified");
  const chipInput = document.getElementById("schoolsChipInput");

  function submitFilters() {
    if (!filterForm) return;
    const pageInput = filterForm.querySelector('input[name="page"]');
    if (pageInput) pageInput.value = "1";
    filterForm.submit();
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  const submitFiltersDebounced = debounce(submitFilters, 350);

  setTimeout(() => {
    const loader = document.getElementById("loader");
    if (loader) loader.style.display = "none";
  }, 1200);

  menuBtn?.addEventListener("click", () => {
    const isOpen = navbar?.classList.toggle("active");
    menuBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  document.querySelectorAll(".header .navbar a").forEach((a) => {
    a.addEventListener("click", () => {
      navbar?.classList.remove("active");
      menuBtn?.setAttribute("aria-expanded", "false");
    });
  });

  document.addEventListener(
    "click",
    (e) => {
      const header = document.getElementById("siteHeader");
      if (!header) return;
      if (!header.contains(e.target)) {
        navbar?.classList.remove("active");
        menuBtn?.setAttribute("aria-expanded", "false");
      }
    },
    { passive: true },
  );

  window.addEventListener(
    "scroll",
    () => {
      if (toTopBtn) {
        toTopBtn.style.display = window.scrollY > 300 ? "block" : "none";
      }
    },
    { passive: true },
  );

  toTopBtn?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.querySelectorAll(".school-card").forEach((card) => {
    const url = card.getAttribute("data-url");
    if (!url) return;

    card.addEventListener("click", (e) => {
      const target = e.target;
      if (target.closest("a") || target.closest("button")) return;
      window.location.href = url;
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const active = document.activeElement;
        if (active && (active.tagName === "A" || active.tagName === "BUTTON")) return;
        e.preventDefault();
        window.location.href = url;
      }
    });
  });

  qInput?.addEventListener("input", () => {
    submitFiltersDebounced();
  });

  citySelect?.addEventListener("change", submitFilters);
  typeSelect?.addEventListener("change", submitFilters);
  sortSelect?.addEventListener("change", submitFilters);
  verifiedInput?.addEventListener("change", submitFilters);

  document.querySelectorAll(".schools-chip").forEach((chipBtn) => {
    chipBtn.addEventListener("click", () => {
      const chip = chipBtn.dataset.chip || "all";
      if (chipInput) chipInput.value = chip;
      submitFilters();
    });
  });
})();
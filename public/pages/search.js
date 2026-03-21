(() => {
  const loader = document.getElementById("loader");
  const navbar = document.querySelector(".header .navbar");
  const menuBtn = document.getElementById("menu-btn");
  const toTopBtn = document.getElementById("toTopBtn");

  const quickForm = document.getElementById("quickSearchForm");
  const filtersForm = document.getElementById("filtersForm");
  const sortForm = document.getElementById("sortForm");

  const qInput = document.getElementById("q");
  const quickCategory = document.getElementById("quickCategory");
  const quickCountry = document.getElementById("quickCountry");
  const quickFacilityInput = document.getElementById("quickFacilityInput");

  const sortBy = document.getElementById("sortBy");
  const resetFiltersBtn = document.getElementById("resetFilters");

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function submitQuickForm() {
    if (!quickForm) return;
    quickForm.submit();
  }

  const submitQuickFormDebounced = debounce(submitQuickForm, 350);

  setTimeout(() => {
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
    { passive: true }
  );

  window.addEventListener(
    "scroll",
    () => {
      if (toTopBtn) {
        toTopBtn.style.display = window.scrollY > 300 ? "block" : "none";
      }
    },
    { passive: true }
  );

  toTopBtn?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
      });
    },
    { threshold: 0.12 }
  );

  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  qInput?.addEventListener("input", () => {
    submitQuickFormDebounced();
  });

  quickCategory?.addEventListener("change", submitQuickForm);
  quickCountry?.addEventListener("change", submitQuickForm);

  document.querySelectorAll(".chip[data-fac]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.getAttribute("data-fac") || "all";
      if (quickFacilityInput) quickFacilityInput.value = value;
      submitQuickForm();
    });
  });

  sortBy?.addEventListener("change", () => {
    sortForm?.submit();
  });

  resetFiltersBtn?.addEventListener("click", () => {
    window.location.href = "/search";
  });

  // Optional: submit filters panel on Enter in text/number fields
  filtersForm?.querySelectorAll("input").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        filtersForm.submit();
      }
    });
  });
})();
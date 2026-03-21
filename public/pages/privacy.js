 
    // Loader
    setTimeout(() => {
      const loader = document.getElementById("loader");
      if (loader) loader.style.display = "none";
    }, 1200);

    (() => {
      const navbar = document.getElementById("primaryNav") || document.querySelector(".header .navbar");
      const menuBtn = document.getElementById("menu-btn");

      if (menuBtn && navbar) {
        const setExpanded = (v) => menuBtn.setAttribute("aria-expanded", v ? "true" : "false");
        menuBtn.addEventListener("click", () => {
          const isOpen = navbar.classList.toggle("active");
          setExpanded(isOpen);
        });
        window.addEventListener("scroll", () => {
          if (navbar.classList.contains("active")) navbar.classList.remove("active");
          setExpanded(false);
        }, { passive: true });
      }

      const toTopBtn = document.getElementById("toTopBtn");
      if (toTopBtn) {
        const toggle = () => {
          const y = document.documentElement.scrollTop || document.body.scrollTop || 0;
          toTopBtn.style.display = y > 300 ? "block" : "none";
        };
        window.addEventListener("scroll", toggle, { passive: true });
        toggle();
        toTopBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
      }

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(e => e.isIntersecting && e.target.classList.add("in"));
      }, { threshold: 0.12 });
      document.querySelectorAll(".reveal").forEach(el => observer.observe(el));
    })();
 

 
    // Loader
    setTimeout(() => {
      const loader = document.getElementById("loader");
      if (loader) loader.style.display = "none";
    }, 2000);

    const navbar = document.querySelector('.header .navbar');
    const menuBtn = document.getElementById('menu-btn');
    const toTopBtn = document.getElementById("toTopBtn");

    // Toggle navbar (mobile)
    menuBtn?.addEventListener("click", () => {
      const isOpen = navbar?.classList.toggle('active');
      menuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close navbar when clicking a link (mobile)
    document.querySelectorAll(".header .navbar a").forEach(a => {
      a.addEventListener("click", () => {
        navbar?.classList.remove("active");
        menuBtn?.setAttribute('aria-expanded', 'false');
      });
    });

    // Close menu if tapping outside
    document.addEventListener("click", (e) => {
      const header = document.getElementById("siteHeader");
      if (!header) return;
      if (!header.contains(e.target)) {
        navbar?.classList.remove("active");
        menuBtn?.setAttribute('aria-expanded', 'false');
      }
    }, { passive: true });

    // Scroll to top button
    window.addEventListener('scroll', () => {
      if (toTopBtn) toTopBtn.style.display = (window.scrollY > 300) ? "block" : "none";
    }, { passive: true });

    toTopBtn?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

    // Reveal animations (also supports content injected later)
    const revealIO = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        if (entry.target.classList.contains("feature") || entry.target.classList.contains("hero")) {
          entry.target.classList.add("visible");
        }
        if (entry.target.classList.contains("reveal")) {
          entry.target.classList.add("in");
        }
      });
    }, { threshold: 0.12 });

    window.__observeReveals = () => {
      document.querySelectorAll(".feature:not([data-observed]), .hero:not([data-observed]), .reveal:not([data-observed])")
        .forEach(el => {
          el.dataset.observed = "true";
          revealIO.observe(el);
        });
    };

    window.__observeReveals();
   
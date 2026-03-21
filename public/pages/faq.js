 
    // Loader
    setTimeout(() => {
      const loader = document.getElementById("loader");
      if (loader) loader.style.display = "none";
    }, 1200);

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

    // Scroll to top button show/hide
    window.addEventListener('scroll', () => {
      if (toTopBtn) toTopBtn.style.display = (window.scrollY > 300) ? "block" : "none";
    }, { passive: true });

    toTopBtn?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

    // Reveal animations
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
      });
    }, { threshold: 0.12 });

    document.querySelectorAll(".reveal").forEach(el => io.observe(el));

    // FAQ accordion
    document.querySelectorAll(".faq-card").forEach(card => {
      const q = card.querySelector(".faq-q");
      q?.addEventListener("click", () => {
        const open = document.querySelector(".faq-card.open");
        if (open && open !== card) open.classList.remove("open");
        card.classList.toggle("open");
      });
    });
   
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

    // Duplicate featured cards for seamless loop
    (function duplicateFeatured() {
      const track = document.getElementById("featuredTrack");
      if (!track || track.dataset.duplicated === "true") return;
      const cards = Array.from(track.children);
      cards.forEach(card => track.appendChild(card.cloneNode(true)));
      track.dataset.duplicated = "true";
    })();

    // Swiper for testimonials
    const isMobile = window.matchMedia("(max-width: 700px)").matches;
    new Swiper(".testimonial-wrapper", {
      slidesPerView: 1,
      spaceBetween: 18,
      loop: true,
      speed: 800,
      autoplay: isMobile ? false : { delay: 2800, disableOnInteraction: false },
      pagination: { el: ".swiper-pagination", clickable: true },
      nested: true,
      passiveListeners: true,
      touchStartPreventDefault: false,
      touchMoveStopPropagation: false,
      touchAngle: 35,
      threshold: 8,
      breakpoints: {
        520: { slidesPerView: 2 },
        768: { slidesPerView: 3 }
      }
    });

    // Reveal animations
    const io = new IntersectionObserver((entries) => {
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

    document.querySelectorAll(".feature, .hero, .reveal").forEach(el => io.observe(el));

    // Contact form stub
    document.getElementById("contactSendBtn")?.addEventListener("click", () => {
      alert("Message captured. (Connect this to your backend/email endpoint.)");
    });
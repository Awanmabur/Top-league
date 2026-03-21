
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

    // Scroll to top button
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

    // Jobs filter + search
    const grid = document.getElementById("jobsGrid");
    const cards = Array.from(grid?.querySelectorAll(".jcard") || []);
    const chips = Array.from(document.querySelectorAll(".fchip"));
    const search = document.getElementById("jobSearch");

    let activeFilter = "all";
    let query = "";

    function matches(card) {
      const tags = (card.dataset.tags || "").split(" ").map(t => t.trim()).filter(Boolean);
      const q = query.trim().toLowerCase();
      const text = card.innerText.toLowerCase();

      const passQuery = !q || text.includes(q);
      const passTag = (activeFilter === "all") || tags.includes(activeFilter);

      return passQuery && passTag;
    }

    function applyFilters() {
      cards.forEach(card => {
        card.style.display = matches(card) ? "" : "none";
      });
    }

    chips.forEach(btn => {
      btn.addEventListener("click", () => {
        chips.forEach(x => x.classList.remove("active"));
        btn.classList.add("active");
        activeFilter = btn.dataset.filter || "all";
        applyFilters();
      });
    });

    search?.addEventListener("input", (e) => {
      query = e.target.value || "";
      applyFilters();
    });

    // Apply buttons prefill role
    function setRole(roleName) {
      const sel = document.getElementById("a_role");
      if (!sel) return;
      // Try select matching option; fallback to set value
      const opts = Array.from(sel.options);
      const match = opts.find(o => o.textContent.trim() === roleName);
      if (match) sel.value = match.value;
      else sel.value = roleName;
    }

    document.querySelectorAll("[data-apply]").forEach(btn => {
      btn.addEventListener("click", () => {
        setRole(btn.getAttribute("data-apply") || "");
      });
    });

    // Application stub
    function getVal(id) { return (document.getElementById(id)?.value || "").trim(); }

    document.getElementById("applyBtn")?.addEventListener("click", () => {
      const payload = {
        name: getVal("a_name"),
        email: getVal("a_email"),
        phone: getVal("a_phone"),
        role: getVal("a_role"),
        link: getVal("a_link"),
        message: getVal("a_message"),
        source: "careers-page"
      };

      if (!payload.name || !payload.email || !payload.phone || !payload.role || !payload.message) {
        alert("Please fill in all required fields.");
        return;
      }

      console.log("Application payload:", payload);
      alert("Application captured. (Connect this to your backend/email endpoint.)");
      document.getElementById("applyForm")?.reset();
    });
 
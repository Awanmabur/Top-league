 
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

        // Contact form stub (replace with your backend endpoint)
        function getVal(id) { return (document.getElementById(id)?.value || "").trim(); }

        document.getElementById("contactSendBtn")?.addEventListener("click", () => {
            const payload = {
                name: getVal("contact_name"),
                school: getVal("contact_school"),
                email: getVal("contact_email"),
                phone: getVal("contact_phone"),
                topic: getVal("contact_topic"),
                message: getVal("contact_message"),
                source: "contact-page"
            };

            // Basic validation (HTML required also covers)
            if (!payload.name || !payload.email || !payload.phone || !payload.topic || !payload.message) {
                alert("Please fill in all required fields.");
                return;
            }

            // ✅ Replace this block with fetch('/api/contact', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
            console.log("Contact payload:", payload);
            alert("Message captured. (Connect this to your backend/email endpoint.)");

            // reset
            document.getElementById("contactForm")?.reset();
        });
     
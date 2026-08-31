 
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

        // Feature filter + search
        const grid = document.getElementById("featureGrid");
        const cards = Array.from(grid?.querySelectorAll(".fcard") || []);
        const chips = Array.from(document.querySelectorAll(".fchip"));
        const search = document.getElementById("featureSearch");

        let activeFilter = "all";
        let query = "";

        function matchesFilter(card) {
            const tags = (card.dataset.tags || "").split(" ").map(t => t.trim()).filter(Boolean);
            const q = query.trim().toLowerCase();

            const text = card.innerText.toLowerCase();
            const passQuery = !q || text.includes(q);
            const passTag = (activeFilter === "all") || tags.includes(activeFilter);

            return passQuery && passTag;
        }

        function applyFilters() {
            cards.forEach(card => {
                card.style.display = matchesFilter(card) ? "" : "none";
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

        // Deep dive tabs content
        const tabBtns = Array.from(document.querySelectorAll(".tab"));
        const panelTitle = document.getElementById("panelTitle");
        const panelDesc = document.getElementById("panelDesc");
        const panelBullets = document.getElementById("panelBullets");
        const panelImage = document.getElementById("panelImage");

        const deepData = {
            admissions: {
                title: "Admissions Pipeline",
                desc: "Collect applications online, review faster, and keep parents updated without daily calls.",
                bullets: [
                    "Custom forms per school (fields + requirements)",
                    "Applicant statuses and follow-up workflow",
                    "Export applicant lists for interviews and reporting",
                    "Admit → create student profile automatically (plan-based)"
                ],
                img: "img/hero.png",
                alt: "Admissions workflow preview"
            },
            finance: {
                title: "Fees & Finance",
                desc: "Track invoices, receipts, balances, statements, and improve collections with clean reporting.",
                bullets: [
                    "Fee structures per class/term and optional items",
                    "Post payments and print receipts instantly",
                    "Balances, arrears tracking, and student statements",
                    "Exports for reconciliation and end-of-term reporting"
                ],
                img: "https://picsum.photos/seed/finance-ca/1200/700",
                alt: "Finance dashboard preview"
            },
            academics: {
                title: "Exams, Grading & Results",
                desc: "Setup exams, enter marks, compute grades and publish results with fewer errors.",
                bullets: [
                    "Exam setup per term/class/subject",
                    "Marks entry with validations and grading rules",
                    "Report cards and result summaries",
                    "Publish to portals (plan-based) and export PDFs/Excel"
                ],
                img: "https://picsum.photos/seed/exams-ca/1200/700",
                alt: "Exams and results preview"
            },
            attendance: {
                title: "Attendance Tracking",
                desc: "Simple attendance marking with summaries and optional parent alerts.",
                bullets: [
                    "Daily attendance by class/lesson",
                    "Attendance summaries per student/class",
                    "Spot trends early and follow-up quickly",
                    "Optional alerts via SMS/WhatsApp/Email (add-on)"
                ],
                img: "https://picsum.photos/seed/attendance-ca/1200/700",
                alt: "Attendance preview"
            },
            communication: {
                title: "Messaging & Announcements",
                desc: "Send internal announcements and reach parents fast with optional integrations.",
                bullets: [
                    "Broadcast announcements by class/role/group",
                    "Internal messaging for staff coordination",
                    "Templates for common notices",
                    "Optional SMS/WhatsApp/Email delivery (plan/add-on)"
                ],
                img: "https://picsum.photos/seed/communication-ca/1200/700",
                alt: "Messaging preview"
            },
            portals: {
                title: "Student & Parent Portals",
                desc: "Give students and parents access to results, balances, timetables, and notices.",
                bullets: [
                    "Student portal for results, timetable, notices",
                    "Optional parent portal with secure access",
                    "Download report cards and fee statements (plan-based)",
                    "Mobile-friendly access anywhere"
                ],
                img: "https://picsum.photos/seed/portal-ca/1200/700",
                alt: "Portal preview"
            },
            reports: {
                title: "Reports & Analytics",
                desc: "Dashboards and exports for finance and academics — built for decision making.",
                bullets: [
                    "Fees collection, arrears and payment summaries",
                    "Performance summaries and ranking views (plan-based)",
                    "Attendance insights and trends",
                    "Excel/PDF exports for meetings and audits"
                ],
                img: "https://picsum.photos/seed/reports-ca/1200/700",
                alt: "Reports preview"
            },
            security: {
                title: "Security, Roles & Audits",
                desc: "Control access, reduce mistakes, and track activity across key workflows.",
                bullets: [
                    "Role-based permissions (admin/staff/student/parent)",
                    "Approvals for sensitive actions (plan-based)",
                    "Audit trail for key actions (plan-based)",
                    "Privacy-first approach: you control your school data"
                ],
                img: "https://picsum.photos/seed/security-ca/1200/700",
                alt: "Security preview"
            },
            core: {
                title: "Core School Operations",
                desc: "The foundation: profiles, classes, staff, terms, and clean structure for everything else.",
                bullets: [
                    "Student profiles, guardians, and class placement",
                    "Staff profiles and role assignment",
                    "Term setup and academic structure",
                    "Bulk import templates to onboard fast"
                ],
                img: "https://picsum.photos/seed/core-ca/1200/700",
                alt: "Core operations preview"
            }
        };

        function setActiveTab(key) {
            const data = deepData[key] || deepData.admissions;
            tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === key));
            if (panelTitle) panelTitle.textContent = data.title;
            if (panelDesc) panelDesc.textContent = data.desc;

            if (panelBullets) {
                panelBullets.innerHTML = data.bullets.map(t => (
                    `<li><i class="fa-solid fa-check"></i> ${t}</li>`
                )).join("");
            }

            if (panelImage) {
                panelImage.src = data.img;
                panelImage.alt = data.alt;
            }

            // small accessibility polish: focus title
            panelTitle?.setAttribute("tabindex", "-1");
            panelTitle?.focus({ preventScroll: true });
            panelTitle?.removeAttribute("tabindex");
        }

        tabBtns.forEach(btn => {
            btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
        });

        // "Learn more" buttons open specific tab
        document.querySelectorAll('[data-open]').forEach(a => {
            a.addEventListener("click", (e) => {
                const key = a.getAttribute("data-open");
                if (!key) return;
                setActiveTab(key);
            });
        });

        // initial
        applyFilters();
        setActiveTab("admissions");
    
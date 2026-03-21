 
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
    if (window.Swiper && document.querySelector('.testimonial-wrapper')) {
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
    }

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
   
    const PLAN_ORDER = ["profile", "starter", "standard", "growth", "premium"];
    const PLANS = {
      profile: {
        title: "School Profile Package (Free)",
        badge: { html: "<i class='fa-solid fa-gift'></i> Free", cls: "soft" },
        price: "$0",
        per: "per year",
        subtitle: "Best for schools that only want an online presence — plus admissions basics.",
        bestFor: [
          "Schools creating an online presence quickly",
          "Schools that want credibility + parent trust",
          "Schools that want basic admissions inquiries & applications"
        ],
        features: [
          "School landing page (Home) + About + Contact",
          "Google map + contact quick actions (call/WhatsApp/email)",
          "Photo gallery + campus highlights",
          "News/Announcements section",
          "Programs/Courses overview",
          "Staff/Leadership section",
          "Admissions page (requirements, deadlines, fees overview)",
          "Basic online application + inquiry form",
          "Simple applicant list view (export-ready)",
          "Reviews/Testimonials section",
          "Basic SEO (titles/descriptions) + mobile responsive",
          "Admin content update panel (basic)"
        ],
        security: [
          "HTTPS-ready structure",
          "Basic spam protection patterns for forms (when backend connected)",
          "Privacy-first handling of contact information"
        ],
        integrations: [
          "WhatsApp click-to-chat",
          "Optional: custom domain + SSL (add-on)",
          "Optional: promoted listing (booster)"
        ]
      },

      starter: {
        title: "Starter Package",
        badge: { html: "<i class='fa-solid fa-rocket'></i> Starter", cls: "" },
        price: "$200",
        per: "per term • up to 300 users",
        subtitle: "Everything in School Profile + core school operations to begin digitizing.",
        bestFor: [
          "Schools starting digital operations",
          "Schools needing basic admissions + attendance",
          "Schools that want fast onboarding with minimal setup"
        ],
        features: [
          "Authentication + role access (Admin/Staff/Student)",
          "Students management (profiles, classes, sections)",
          "Staff management (profiles, departments/roles)",
          "Admissions basic pipeline (apply → review → accept)",
          "Attendance (basic) + simple reports",
          "Timetable (basic) for classes",
          "Exams & results entry (basic) + view/print",
          "Fees summary (basic) + balances overview",
          "Announcements + messaging (basic)",
          "Document uploads (basic)",
          "Onboarding support + training checklist"
        ],
        security: [
          "Role-based access controls",
          "Basic audit-friendly activity tracking",
          "Secure session patterns (when backend connected)"
        ],
        integrations: [
          "Export templates (CSV) for bulk imports",
          "Optional: SMS credits (add-on)",
          "Optional: custom domain (add-on)"
        ]
      },

      standard: {
        title: "Standard Package (Most Popular)",
        badge: { html: "<i class='fa-solid fa-star'></i> Most Popular", cls: "hot" },
        price: "$350",
        per: "per term • up to 750 users",
        subtitle: "Everything in Starter + advanced modules for serious control and reporting.",
        bestFor: [
          "Growing schools managing payments & exams",
          "Schools needing full admissions tracking",
          "Schools that want reporting + dashboards"
        ],
        features: [
          "Full admissions pipeline (apply → review → requirements → accept → enroll)",
          "Advanced student management (promotions, discipline, documents tracking)",
          "Exams management (papers, grading workflows, moderation support)",
          "Finance module (invoices, receipts, payment tracking, summaries)",
          "Library module (books, lending, penalties)",
          "Hostel module (rooms, assignments, occupancy)",
          "Events module (school events + calendar)",
          "Reports & exports (PDF/Excel) + dashboards",
          "More granular permissions + audit logs",
          "Parent/guardian contacts + messaging improvements"
        ],
        security: [
          "Improved role granularity",
          "Audit logs for key actions",
          "Data backup patterns (when backend connected)"
        ],
        integrations: [
          "Bulk imports (students/staff) via templates",
          "Optional: parent portal (add-on)",
          "Optional: SMS/Email alerts (add-on)"
        ]
      },

      growth: {
        title: "Growth Package (New)",
        badge: { html: "<i class='fa-solid fa-arrow-trend-up'></i> New", cls: "soft" },
        price: "$425",
        per: "per term • up to 900 users",
        subtitle: "Everything in Standard + approvals, templates, deeper analytics for scaling schools.",
        bestFor: [
          "Schools scaling fast and needing process control",
          "Schools that want deeper analytics + approvals",
          "Schools with large intakes each term"
        ],
        features: [
          "Approval flows (finance approvals + results publishing)",
          "Advanced analytics (cohorts, trends, performance patterns)",
          "Bulk imports + stronger templates + validation checks",
          "Stronger audit logs + access control",
          "Scheduled/recurring reports (when backend connected)",
          "Operational dashboards for leadership",
          "Faster support response + rollout check-ins"
        ],
        security: [
          "Stronger audit coverage",
          "Better access control patterns",
          "Operational safeguards for publishing results"
        ],
        integrations: [
          "Optional: advanced exports + reporting automation",
          "Optional: multi-campus support (add-on)",
          "Optional: OTP/2FA (add-on)"
        ]
      },

      premium: {
        title: "Premium Package",
        badge: { html: "<i class='fa-solid fa-crown'></i> Elite", cls: "" },
        price: "$500+",
        per: "per term • 1000+ users",
        subtitle: "Everything in Growth + enterprise workflows, portals, and integrations.",
        bestFor: [
          "Large schools, multi-campus, high-volume admissions",
          "Schools that want portals + integrations",
          "Schools needing enterprise reporting + rollout support"
        ],
        features: [
          "Full finance workflows (fees structures, balances, receipts, statements)",
          "Advanced reports & analytics dashboards",
          "Student portal + staff portal + optional parent portal",
          "SMS/Email integrations (alerts, reminders, OTP/2FA optional)",
          "Document verification & requirements tracking",
          "Custom modules/pages per school needs (scoped)",
          "Priority training + rollout support"
        ],
        security: [
          "Enterprise permission sets + approvals",
          "Optional OTP/2FA patterns",
          "Backup & recovery strategy (when backend connected)"
        ],
        integrations: [
          "Optional: custom domain + SSL setup",
          "Optional: promoted listing + sponsored placement",
          "Optional: multi-campus/branches (add-on)"
        ]
      }
    };

    const COMPARE_CAPS = [
      { label: "School website/profile", fn: (p) => true },
      { label: "Admissions (online application)", fn: (p) => ["profile", "starter", "standard", "growth", "premium"].includes(p) },
      { label: "Attendance", fn: (p) => ["starter", "standard", "growth", "premium"].includes(p) },
      { label: "Timetable", fn: (p) => ["starter", "standard", "growth", "premium"].includes(p) },
      { label: "Exams & results", fn: (p) => ["starter", "standard", "growth", "premium"].includes(p) },
      { label: "Finance module", fn: (p) => ["standard", "growth", "premium"].includes(p) },
      { label: "Library", fn: (p) => ["standard", "growth", "premium"].includes(p) },
      { label: "Hostel", fn: (p) => ["standard", "growth", "premium"].includes(p) },
      { label: "Analytics dashboards", fn: (p) => ["standard", "growth", "premium"].includes(p) },
      { label: "Approval flows", fn: (p) => ["growth", "premium"].includes(p) },
      { label: "Portals (student/staff/parent)", fn: (p) => ["premium"].includes(p) },
      { label: "SMS/Email integrations", fn: (p) => ["premium"].includes(p) }
    ];

    const $ = (s, r = document) => r.querySelector(s);

    function getPlanKey() {
      const u = new URL(window.location.href);
      const p = (u.searchParams.get("plan") || "standard").toLowerCase();
      return PLANS[p] ? p : "standard";
    }

    function computeInheritedFeatures(planKey) {
      const idx = PLAN_ORDER.indexOf(planKey);
      const chain = PLAN_ORDER.slice(0, idx + 1);
      let all = [];
      chain.forEach(k => { all = all.concat(PLANS[k].features); });
      const seen = new Set();
      const out = [];
      for (const f of all) {
        const key = f.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
      }
      return { chain, features: out };
    }

    function render(planKey) {
      const p = PLANS[planKey];
      const inherit = computeInheritedFeatures(planKey);

      $("#planTitle").textContent = p.title;
      $("#planSubtitle").textContent = p.subtitle;

      const badge = $("#planBadge");
      badge.className = "badge " + (p.badge.cls || "");
      badge.innerHTML = p.badge.html;

      $("#planPrice").textContent = p.price;
      $("#planPer").textContent = p.per;

      // SEO (dynamic)
      document.title = p.title + " — Classic Academy";
      const desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute("content", `${p.title}: ${p.subtitle}`);
      const ld = document.getElementById("ldjsonPlan");
      if (ld) {
        const offer = {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": p.title,
          "description": p.subtitle,
          "brand": { "@type": "Brand", "name": "Classic Academy" },
          "offers": {
            "@type": "Offer",
            "priceCurrency": "USD",
            "price": (String(p.price).replace(/[^0-9.]/g, "") || "0"),
            "url": "/plan?plan=" + planKey
          }
        };
        ld.textContent = JSON.stringify(offer, null, 2);
      }

      if (planKey === "profile") {
        $("#inheritText").textContent = "This package is standalone.";
      } else {
        const parent = PLAN_ORDER[PLAN_ORDER.indexOf(planKey) - 1];
        $("#inheritText").textContent = `Includes everything in ${PLANS[parent].title} (and earlier), plus additional modules below.`;
      }

      const ul = $("#featuresList");
      ul.innerHTML = "";
      inherit.features.forEach(it => {
        const li = document.createElement("li");
        li.innerHTML = `<i class="fa-solid fa-check"></i><span>${it}</span>`;
        ul.appendChild(li);
      });

      const bf = $("#bestFor");
      bf.innerHTML = "";
      p.bestFor.forEach(it => {
        const li = document.createElement("li");
        li.innerHTML = `<i class="fa-solid fa-check"></i><span>${it}</span>`;
        bf.appendChild(li);
      });

      const sec = $("#security");
      sec.innerHTML = "";
      p.security.forEach(it => {
        const li = document.createElement("li");
        li.innerHTML = `<i class="fa-solid fa-check"></i><span>${it}</span>`;
        sec.appendChild(li);
      });

      const integ = $("#integrations");
      integ.innerHTML = "";
      p.integrations.forEach(it => {
        const li = document.createElement("li");
        li.innerHTML = `<i class="fa-solid fa-check"></i><span>${it}</span>`;
        integ.appendChild(li);
      });

      const seg = $("#seg");
      seg.innerHTML = "";
      PLAN_ORDER.forEach(k => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = k === planKey ? "active" : "";
        b.textContent = k === "profile" ? "Profile" : (k.charAt(0).toUpperCase() + k.slice(1));
        b.addEventListener("click", () => {
          const url = new URL(window.location.href);
          url.searchParams.set("plan", k);
          window.location.href = url.toString();
        });
        seg.appendChild(b);
      });

      const tbody = $("#compareBody");
      tbody.innerHTML = "";
      COMPARE_CAPS.forEach(cap => {
        const tr = document.createElement("tr");
        const td0 = document.createElement("td");
        td0.textContent = cap.label;
        tr.appendChild(td0);
        PLAN_ORDER.forEach(k => {
          const td = document.createElement("td");
          td.innerHTML = cap.fn(k) ? `<span class="yes">✔</span>` : `<span class="no">—</span>`;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    render(getPlanKey());
   
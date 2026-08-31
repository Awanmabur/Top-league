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

    // Reveal animations (optional)
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
        });
      }, { threshold: 0.12 });

      document.querySelectorAll(".reveal").forEach(el => io.observe(el));
    } else {
      document.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
    }
 
    const POSTS = [
      {
        slug: "increase-admissions",
        title: "How to Increase Admissions Without Increasing Your Budget",
        subtitle: "A practical playbook for visibility, trust, and faster parent follow-up.",
        cover: "https://picsum.photos/seed/admissions/1200/700",
        category: "Admissions",
        minutes: 6,
        date: "2026-02-25",
        author: "Classic Academy Team",
        content: [
          "Most schools lose potential students because inquiries are slow, information is incomplete, and follow-up is inconsistent.",
          "With Classic Academy, your school profile acts like a fast, clear landing page, while online admissions captures applications and questions immediately.",
          "The key is a simple flow: (1) be visible, (2) build trust, (3) respond fast, (4) track the pipeline until enrollment."
        ],
        takeaways: [
          "Publish clear admissions requirements + fees overview.",
          "Use online inquiry + application forms to capture leads instantly.",
          "Track every applicant status (review → accept → enroll).",
          "Follow up with SMS/WhatsApp reminders when needed."
        ]
      },
      {
        slug: "fees-tracking",
        title: "Fees Tracking That Actually Works: Invoices, Receipts & Balances",
        subtitle: "Reduce disputes, improve collection, and keep finance clean every term.",
        cover: "https://picsum.photos/seed/finance/1200/700",
        category: "Finance",
        minutes: 7,
        date: "2026-02-20",
        author: "Classic Academy Team",
        content: [
          "Many fee disputes come from unclear balances, missing receipts, and manual spreadsheets.",
          "A proper finance module gives you invoices, payment tracking, receipts, and statements — in one place.",
          "Standard and above includes finance workflows; Premium adds deeper reporting and portals."
        ],
        takeaways: [
          "Issue invoices per term and track payments automatically.",
          "Generate receipts and statements to reduce disputes.",
          "Use dashboards to see fee collection trends.",
          "Approve sensitive finance actions with Growth/Premium."
        ]
      },
      {
        slug: "exam-results",
        title: "Exam & Results Management: From Setup to Publishing",
        subtitle: "Clean grading workflows and faster publishing without mistakes.",
        cover: "https://picsum.photos/seed/exams/1200/700",
        category: "Academics",
        minutes: 5,
        date: "2026-02-18",
        author: "Classic Academy Team",
        content: [
          "Results take too long when grading is scattered and approvals are missing.",
          "Classic Academy supports exam setup, grading workflows, and publishing controls (Growth+).",
          "When results are structured, reporting becomes easy."
        ],
        takeaways: [
          "Standard supports structured exam workflows.",
          "Growth adds approvals before publishing results.",
          "Use analytics to spot performance patterns.",
          "Export results quickly when needed."
        ]
      }
    ];

    function getSlug() {
      const u = new URL(window.location.href);
      return (u.searchParams.get("slug") || POSTS[0].slug).toLowerCase();
    }

    function render() {
      const slug = getSlug();
      const post = POSTS.find(p => p.slug === slug) || POSTS[0];

      document.title = post.title + " — Classic Academy";

      // SEO (dynamic)
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) metaDesc.setAttribute("content", post.subtitle);
      const ogTitle = document.getElementById("ogTitle"); if (ogTitle) ogTitle.setAttribute("content", post.title);
      const ogDesc = document.getElementById("ogDesc"); if (ogDesc) ogDesc.setAttribute("content", post.subtitle);
      const ogImage = document.getElementById("ogImage"); if (ogImage) ogImage.setAttribute("content", post.cover);
      const twTitle = document.getElementById("twTitle"); if (twTitle) twTitle.setAttribute("content", post.title);
      const twDesc = document.getElementById("twDesc"); if (twDesc) twDesc.setAttribute("content", post.subtitle);
      const twImage = document.getElementById("twImage"); if (twImage) twImage.setAttribute("content", post.cover);

      const ld = document.getElementById("ldjsonArticle");
      if (ld) {
        const article = {
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": post.title,
          "description": post.subtitle,
          "image": [post.cover],
          "author": { "@type": "Organization", "name": post.author },
          "publisher": { "@type": "Organization", "name": "Classic Academy", "logo": { "@type": "ImageObject", "url": "/img/academylogo.png" } },
          "datePublished": post.date,
          "mainEntityOfPage": { "@type": "WebPage", "@id": "/blog?slug=" + post.slug }
        };
        ld.textContent = JSON.stringify(article, null, 2);
      }

      document.getElementById("title").textContent = post.title;
      document.getElementById("subtitle").textContent = post.subtitle;
      document.getElementById("hero").src = post.cover;

      document.getElementById("meta").innerHTML = `
        <span class="chip"><i class="fa-solid fa-tag"></i>${post.category}</span>
        <span class="chip"><i class="fa-solid fa-clock"></i>${post.minutes} min read</span>
        <span class="chip"><i class="fa-solid fa-calendar"></i>${post.date}</span>
        <span class="chip"><i class="fa-solid fa-user"></i>${post.author}</span>
      `;

      document.getElementById("content").innerHTML =
        post.content.map(p => `<p style="margin:.75rem 0">${p}</p>`).join("");

      document.getElementById("takeaways").innerHTML =
        post.takeaways.map(t => `<li><i class="fa-solid fa-check"></i><span>${t}</span></li>`).join("");

      document.getElementById("more").innerHTML =
        POSTS.filter(p => p.slug !== post.slug).map(p => `
          <a class="sp" href="/blog?slug=${p.slug}">
            <div class="thumb"><img src="${p.cover}" alt=""></div>
            <div>
              <h4>${p.title}</h4>
              <p>${p.category} • ${p.minutes} min</p>
            </div>
          </a>
        `).join("");
    }

    render();
// Classic Campus — shared JS (marketing site)
(() => {
  const root = document.documentElement;

  // Theme toggle + iframe theme bridge
  const themeBtn = document.getElementById("toggleTheme");

  function broadcastTheme(theme){
    try { window.dispatchEvent(new CustomEvent("cc-theme", { detail: { theme } })); } catch (_){}
    document.querySelectorAll("iframe[data-theme-bridge]").forEach(fr => {
      try { fr.contentWindow && fr.contentWindow.postMessage({ type: "cc_theme", theme }, "*"); } catch (_){}
    });
  }

  function setTheme(theme, persist=true){
    root.setAttribute("data-theme", theme);
    if (persist){
      try { localStorage.setItem("cc_theme", theme); } catch (_){}
    }
    broadcastTheme(theme);
    window.setTimeout(() => broadcastTheme(theme), 250); // help late-loading iframes
  }

  // Respond to embedded theme requests
  window.addEventListener("message", (ev) => {
    const d = ev && ev.data;
    if (d && d.type === "cc_theme_request") {
      const theme = root.getAttribute("data-theme") || "light";
      try { ev.source && ev.source.postMessage({ type: "cc_theme", theme }, "*"); } catch (_){}
    }
  });

  try {
    const storedTheme = localStorage.getItem("cc_theme");
    if (storedTheme) setTheme(storedTheme, false);
  } catch (_) {}

  // default if nothing stored
  if (!root.getAttribute("data-theme")) setTheme("light", false);

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      setTheme(next, true);
    });
  }

  // Year
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Mobile menu
  const mobileSheet = document.getElementById("mobileSheet");
  const openMenuBtn = document.getElementById("openMenu");
  const closeMenuBtn = document.getElementById("closeMenu");

  function openMenu() {
    if (!mobileSheet || !openMenuBtn) return;
    mobileSheet.classList.add("open");
    mobileSheet.setAttribute("aria-hidden", "false");
    openMenuBtn.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }
  function closeMenu() {
    if (!mobileSheet || !openMenuBtn) return;
    mobileSheet.classList.remove("open");
    mobileSheet.setAttribute("aria-hidden", "true");
    openMenuBtn.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  if (openMenuBtn && mobileSheet) {
    openMenuBtn.addEventListener("click", () => {
      const expanded = openMenuBtn.getAttribute("aria-expanded") === "true";
      expanded ? closeMenu() : openMenu();
    });
  }
  if (closeMenuBtn) closeMenuBtn.addEventListener("click", closeMenu);
  if (mobileSheet) mobileSheet.addEventListener("click", (e) => { if (e.target === mobileSheet) closeMenu(); });
  document.querySelectorAll(".mLink").forEach(a => a.addEventListener("click", closeMenu));

  // ESC closes mobile sheet
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  // Reveal on scroll
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(ent => {
        if (ent.isIntersecting) {
          ent.target.classList.add("in");
          io.unobserve(ent.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

    document.querySelectorAll(".reveal:not(.in)").forEach(el => io.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
  }

  // Preview switcher (only on index)
  const previewBody = document.getElementById("previewBody");
  const chips = Array.from(document.querySelectorAll(".chip"));
  if (previewBody && chips.length) {
    const views = {
      admin: {
        stats: [["+18%", "Enrollment"], ["2.4s", "Avg page load"], ["97%", "Fee coverage"]],
        cards: [
          { title: "Admissions pipeline", desc: "Applications → review → acceptance → enrollment with documents.", badges: ["Workflows", "Approvals", "Audit-ready"] },
          { title: "Registry accuracy", desc: "Single source of truth for IDs, attendance, and history.", badges: ["Fast search", "Permissions", "Logs"] },
          { title: "Multi-campus control", desc: "Central governance with campus-level access.", badges: ["RBAC", "Tenants", "Exports"] },
          { title: "Analytics", desc: "Enrollment trends, risk flags, and performance views.", badges: ["KPIs", "Realtime", "Exports"] }
        ]
      },
      finance: {
        stats: [["+12%", "Collections"], ["0.8%", "Mismatch rate"], ["24/7", "Receipts"]],
        cards: [
          { title: "Fees & invoicing", desc: "Structures, invoices, adjustments, and statements.", badges: ["Receipts", "Statements", "Roles"] },
          { title: "Reconciliation", desc: "Track payments by sponsor, cohort, or program.", badges: ["Reports", "Audit-ready", "Exports"] },
          { title: "Payroll", desc: "Runs, deductions, approvals, and payslips.", badges: ["Controls", "Approvals", "Logs"] },
          { title: "Procurement", desc: "Requests → approvals → vendors → orders.", badges: ["Budgets", "Approvals", "Audit"] }
        ]
      },
      lms: {
        stats: [["+22%", "Engagement"], ["3x", "Faster grading"], ["1 hub", "Course content"]],
        cards: [
          { title: "Courses & content", desc: "Lessons, resources, weekly structure, mobile-first.", badges: ["Mobile", "Structured", "Fast"] },
          { title: "Assignments & quizzes", desc: "Timed assessments, submissions, grading & feedback.", badges: ["Gradebook", "Auto-grade", "Rubrics"] },
          { title: "Attendance", desc: "Simple roll call and trends per class.", badges: ["Reports", "Alerts", "Trends"] },
          { title: "Results publishing", desc: "Secure results to portals with permissions.", badges: ["Permissions", "Logs", "Exports"] }
        ]
      }
    };

    const badgeClass = (label) => {
      const l = String(label).toLowerCase();
      if (l.includes("audit") || l.includes("controls") || l.includes("budget")) return "warn";
      if (l.includes("mobile") || l.includes("kpi") || l.includes("realtime") || l.includes("fast")) return "blue";
      if (l.includes("approval") || l.includes("workflows") || l.includes("gradebook")) return "ok";
      return "blue";
    };

    function setStats(arr) {
      const ids = [["s1","s1l"],["s2","s2l"],["s3","s3l"]];
      ids.forEach((pair, i) => {
        const a = document.getElementById(pair[0]);
        const b = document.getElementById(pair[1]);
        if (a) a.textContent = arr[i][0];
        if (b) b.textContent = arr[i][1];
      });
    }

    function renderView(key) {
      const v = views[key] || views.admin;
      setStats(v.stats);

      previewBody.style.opacity = "0";
      previewBody.style.transform = "translateY(4px)";

      window.setTimeout(() => {
        previewBody.innerHTML = v.cards.map(it => `
          <div class="miniCard" style="opacity:0; transform: translateY(8px);">
            <h3>${it.title}</h3>
            <p>${it.desc}</p>
            <div class="miniBadges">
              ${it.badges.map(b => `<span class="badge ${badgeClass(b)}">${b}</span>`).join("")}
            </div>
          </div>
        `).join("");

        previewBody.style.opacity = "1";
        previewBody.style.transform = "translateY(0px)";

        const cards = Array.from(previewBody.querySelectorAll(".miniCard"));
        cards.forEach((c, i) => {
          try {
            c.animate(
              [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0px)" }],
              { duration: 360, easing: "cubic-bezier(.2,.9,.2,1)", delay: i * 55, fill: "forwards" }
            );
          } catch (_) {
            c.style.opacity = "1";
            c.style.transform = "translateY(0)";
          }
        });
      }, 140);
    }

    chips.forEach(btn => {
      btn.addEventListener("click", () => {
        chips.forEach(x => x.classList.remove("active"));
        btn.classList.add("active");
        renderView(btn.dataset.view);
      });
    });
    renderView("admin");
  }
})();
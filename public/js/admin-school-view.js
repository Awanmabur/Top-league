// public/js/school-profile-mock-ui.js
(() => {
  // Hamburger
  const hamb = document.getElementById("hamburger");
  const menu = document.getElementById("mobileMenu");
  hamb?.addEventListener("click", () => menu.classList.toggle("show"));

  // Tabs
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");

  function activate(tabId){
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
    panels.forEach(p => p.classList.toggle("active", p.id === tabId));
    window.scrollTo({ top: 360, behavior: "smooth" });
  }
  tabs.forEach(t => t.addEventListener("click", () => activate(t.dataset.tab)));

  // Subject search
  const ps = document.getElementById("subjectSearch") || document.getElementById("programSearch");
  const programRows = document.querySelectorAll(".subject-row, .program-row");
  ps?.addEventListener("input", () => {
    const q = (ps.value || "").trim().toLowerCase();
    programRows.forEach(r => {
      const hay = (r.getAttribute("data-name") || "").toLowerCase();
      r.style.display = hay.includes(q) ? "" : "none";
    });
  });

  // --- Helpers: generate fallback "photo" SVGs (only if no real gallery images) ---
  function svgDataURL(bg1, bg2, label){
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${bg1}"/>
            <stop offset="1" stop-color="${bg2}"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="800" fill="url(#g)"/>
        <circle cx="980" cy="180" r="120" fill="rgba(255,255,255,0.12)"/>
        <circle cx="280" cy="610" r="160" fill="rgba(255,255,255,0.10)"/>
        <text x="60" y="120" fill="rgba(255,255,255,0.92)" font-size="64" font-family="Arial" font-weight="700">${label}</text>
        <text x="60" y="190" fill="rgba(255,255,255,0.70)" font-size="28" font-family="Arial">Classic Academy • School Gallery</text>
      </svg>
    `;
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg.trim());
  }

  // Gallery setup
  const galleryGrid = document.getElementById("galleryGrid");
  const hasReal = galleryGrid?.getAttribute("data-has-real") === "1";

  if (galleryGrid && !hasReal) {
    const g = [
      svgDataURL("#0a3d62", "#0a6fbf", "Laboratory Session"),
      svgDataURL("#083454", "#2d9cdb", "Library Time"),
      svgDataURL("#0a6fbf", "#0a3d62", "Sports Day"),
      svgDataURL("#0b2239", "#0a6fbf", "ICT Classroom"),
      svgDataURL("#0a3d62", "#1d4ed8", "Campus View"),
      svgDataURL("#083454", "#0ea5e9", "Graduation Moment"),
    ];

    const imgIds = ["g1","g2","g3","g4","g5","g6"];
    imgIds.forEach((id, i) => {
      const img = document.getElementById(id);
      if (!img) return;
      img.src = g[i];
      const btn = img.closest(".g-item");
      if (btn) btn.dataset.src = g[i];
    });
  }

  // Lightbox
  const items = [...document.querySelectorAll(".g-item")].filter(b => (b.dataset.src || "").trim().length);
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lbImg");
  const lbClose = document.getElementById("lbClose");
  const lbPrev = document.getElementById("lbPrev");
  const lbNext = document.getElementById("lbNext");

  if (items.length && lb && lbImg) {
    let idx = 0;
    const sources = items.map(b => b.dataset.src);

    const open = (i) => {
      idx = i;
      lbImg.src = sources[idx];
      lb.classList.add("show");
      lb.setAttribute("aria-hidden","false");
    };
    const close = () => {
      lb.classList.remove("show");
      lb.setAttribute("aria-hidden","true");
      lbImg.src = "";
    };
    const prev = () => open((idx - 1 + sources.length) % sources.length);
    const next = () => open((idx + 1) % sources.length);

    items.forEach((b,i) => b.addEventListener("click", () => open(i)));
    lbClose?.addEventListener("click", close);
    lbPrev?.addEventListener("click", prev);
    lbNext?.addEventListener("click", next);

    lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("show")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    });
  }

  // Inquiry form (still safe mock; only sends if endpoint exists)
  const inquiryForm = document.getElementById("inquiryForm");
  const inquiryMsg = document.getElementById("inquiryMsg");

  inquiryForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const school = inquiryForm.getAttribute("data-school") || "";
    const fd = new FormData(inquiryForm);
    const payload = Object.fromEntries(fd.entries());

    inquiryMsg.textContent = "Submitting...";

    // If you later create this endpoint, it will just work:
    // POST /schools/:code/inquiry
    try {
      const res = await fetch(`/schools/${school}/inquiry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        inquiryMsg.textContent = data.message || "Mock only — connect backend when ready.";
        return;
      }

      inquiryMsg.textContent = data.message || "Submitted ✅";
      inquiryForm.reset();
    } catch {
      inquiryMsg.textContent = "Mock only — connect backend when ready.";
    }
  });
})();

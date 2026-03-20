(() => {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  const mobileBtn = document.getElementById("mobileMenuBtn");
  const collapseBtn = document.getElementById("sbToggle");

  if (!sidebar) return;

  // ----- Mobile open/close -----
  function openMobile(){
    sidebar.classList.add("open");
    backdrop && backdrop.classList.add("show");
  }
  function closeMobile(){
    sidebar.classList.remove("open");
    backdrop && backdrop.classList.remove("show");
  }

  mobileBtn && mobileBtn.addEventListener("click", () => {
    sidebar.classList.contains("open") ? closeMobile() : openMobile();
  });

  // ✅ IMPORTANT: don't use backdrop click close because it requires pointer-events:auto
  // backdrop && backdrop.addEventListener("click", closeMobile);

  sidebar.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    if (window.matchMedia("(max-width:1100px)").matches) closeMobile();
  });

  // ----- Desktop collapse < / > -----
  if (collapseBtn){
    const icon = collapseBtn.querySelector("i");

    function syncIcon(){
      if (!icon) return;
      icon.className = sidebar.classList.contains("collapsed")
        ? "fa fa-angle-right"
        : "fa fa-angle-left";
    }

    if (localStorage.getItem("cc_sidebar_collapsed") === "1") {
      sidebar.classList.add("collapsed");
    }
    syncIcon();

    collapseBtn.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
      localStorage.setItem("cc_sidebar_collapsed", sidebar.classList.contains("collapsed") ? "1" : "0");
      syncIcon();
    });
  }

  // ----- Active link highlight (by URL) -----
  (() => {
    const links = document.querySelectorAll(".navbutton[href]");
    const path = window.location.pathname;

    links.forEach(a => a.classList.remove("active"));

    let best = null;
    links.forEach(a => {
      const href = a.getAttribute("href");
      if (!href) return;
      if (path === href || path.startsWith(href + "/")) {
        if (!best || href.length > best.getAttribute("href").length) best = a;
      }
    });

    if (best) best.classList.add("active");
  })();

  // ----- Tooltip when collapsed -----
  (() => {
    let tip = document.querySelector(".cc-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "cc-tooltip";
      document.body.appendChild(tip);
    }

    function showTip(text, x, y){
      tip.textContent = text || "";
      tip.style.left = (x + 12) + "px";
      tip.style.top = y + "px";
      tip.style.opacity = "1";
    }
    function hideTip(){ tip.style.opacity = "0"; }

    const items = sidebar.querySelectorAll(".navbutton[data-label]");
    items.forEach(el => {
      el.addEventListener("mouseenter", () => {
        if (!sidebar.classList.contains("collapsed")) return;
        const label = el.dataset.label || el.textContent.trim();
        const r = el.getBoundingClientRect();
        showTip(label, r.right, r.top + r.height / 2);
      });
      el.addEventListener("mousemove", () => {
        if (!sidebar.classList.contains("collapsed")) return;
        const label = el.dataset.label || el.textContent.trim();
        const r = el.getBoundingClientRect();
        showTip(label, r.right, r.top + r.height / 2);
      });
      el.addEventListener("mouseleave", hideTip);
    });

    window.addEventListener("scroll", hideTip, true);
  })();
})();

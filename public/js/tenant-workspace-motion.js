(() => {
  "use strict";

  const boot = () => {
    if (document.body?.dataset?.portal !== "tenant") return;
    const reduced = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    if (!reduced) document.documentElement.classList.add("ca-tenant-motion");

    const routeProgress = document.createElement("div");
    routeProgress.className = "ca-tenant-progress";
    routeProgress.setAttribute("aria-hidden", "true");
    const scrollProgress = document.createElement("div");
    scrollProgress.className = "ca-tenant-scroll-progress";
    scrollProgress.setAttribute("aria-hidden", "true");
    document.body.append(routeProgress, scrollProgress);

    const selectors = [
      ".main > .card", ".main > section", "main > .card", "main > section",
      ".kpi-card", ".kpi-row > .card", ".table-wrap", ".panel", ".dash-card",
      ".metric-card", ".filters-row", ".section"
    ].join(",");
    const targets = Array.from(document.querySelectorAll(selectors)).filter((el) => !el.closest(".sidebar"));

    targets.forEach((element, index) => {
      element.classList.add("ca-tenant-reveal", `ca-tenant-delay-${(index % 8) + 1}`);
      if (element.matches(".card:nth-child(even),.kpi-card:nth-child(even),.metric-card:nth-child(even),.dash-card:nth-child(even)")) {
        element.classList.add("ca-tenant-right");
      } else if (element.matches(".card:nth-child(odd),.kpi-card:nth-child(odd),.metric-card:nth-child(odd),.dash-card:nth-child(odd)")) {
        element.classList.add("ca-tenant-left");
      } else if (element.matches(".table-wrap,.panel,.filters-row")) {
        element.classList.add("ca-tenant-scale");
      }
      if (element.matches(".card,.kpi-card,.panel,.dash-card,.metric-card,.table-wrap")) element.classList.add("ca-tenant-hover");
    });

    if (reduced || !("IntersectionObserver" in window)) targets.forEach((el) => el.classList.add("ca-tenant-in"));
    else {
      const observer = new IntersectionObserver((entries, io) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("ca-tenant-in");
          io.unobserve(entry.target);
        });
      }, { threshold: 0.08, rootMargin: "0px 0px -7% 0px" });
      targets.forEach((el) => observer.observe(el));
    }

    let ticking = false;
    const renderScroll = () => {
      ticking = false;
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      const pct = Math.min(1, Math.max(0, window.scrollY / max));
      scrollProgress.style.transform = `scaleX(${pct})`;
      document.body.classList.toggle("ca-tenant-scrolled", window.scrollY > 18);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(renderScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    renderScroll();

    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download") || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      let url;
      try { url = new URL(link.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || (url.hash && url.pathname === window.location.pathname)) return;
      document.body.classList.add("ca-tenant-routing");
    }, { passive: true });

    window.addEventListener("pageshow", () => {
      document.body.classList.remove("ca-tenant-routing");
      onScroll();
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();

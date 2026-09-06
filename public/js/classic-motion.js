(() => {
  "use strict";

  const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const coarseQuery = window.matchMedia?.("(pointer: coarse)");
  const reduced = Boolean(motionQuery?.matches);
  const coarse = Boolean(coarseQuery?.matches);
  const html = document.documentElement;
  if (!reduced) html.classList.add("ca-motion-ready");

  const protectedMotionZone = (el) => Boolean(
    el?.closest?.(".orbit-ring,.orbit-center,.orbit-section,.orbit-wrapper")
  );

  const createProgress = (className) => {
    const node = document.createElement("div");
    node.className = className;
    node.setAttribute("aria-hidden", "true");
    return node;
  };

  const boot = () => {
    if (!document.body) return;

    const scrollProgress = createProgress("ca-scroll-progress");
    const routeProgress = createProgress("ca-route-progress");
    document.body.prepend(routeProgress);
    document.body.prepend(scrollProgress);

    const revealSelectors = [
      "main > section",
      "section.block",
      ".section-container",
      ".seo-content-section",
      ".landing-section",
      ".landing-cta",
      ".conversion-banner",
      ".feature",
      ".card",
      ".panel",
      ".stat",
      ".program",
      ".news article",
      ".photo",
      ".p4-card",
      ".testimonial",
      ".testimonial-card",
      ".school-card",
      ".blog2",
      ".blog-card",
      ".job-card",
      ".login-shell",
      ".tenant-footer-shell",
      ".gallery-story figure",
      ".cinfo",
      ".cform",
      ".thead",
      ".chead",
      ".blogs-head",
      ".p4-head",
      ".s-head",
      ".jobs-head",
      ".step",
      ".info-card",
      ".seo-info-card",
      ".seo-step",
      ".ride-feature",
      ".requirement"
    ];

    const revealTargets = Array.from(document.querySelectorAll(revealSelectors.join(",")))
      .filter((el) => !protectedMotionZone(el));

    revealTargets.forEach((element, index) => {
      element.classList.add("ca-motion-reveal");

      if (element.matches(
        ".info-card,.seo-info-card,.testimonial-card:nth-child(even),.school-card:nth-child(even),.blog-card:nth-child(even),.feature:nth-child(even),.card:nth-child(even),.stat:nth-child(even),.program:nth-child(even),.news article:nth-child(even)"
      )) {
        element.classList.add("ca-motion-from-right");
      } else if (element.matches(
        ".testimonial-card:nth-child(odd),.school-card:nth-child(odd),.blog-card:nth-child(odd),.feature:nth-child(odd),.card:nth-child(odd),.stat:nth-child(odd),.program:nth-child(odd),.news article:nth-child(odd)"
      )) {
        element.classList.add("ca-motion-from-left");
      } else if (element.matches(
        ".conversion-banner,.landing-cta,.section-container,.login-shell,.tenant-footer-shell,.hero-media,.hero-image,.page-hero,.about-hero"
      )) {
        element.classList.add("ca-motion-scale");
      }

      element.classList.add(`ca-motion-delay-${(index % 8) + 1}`);
    });

    const observer = (!reduced && "IntersectionObserver" in window)
      ? new IntersectionObserver((entries, io) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("ca-motion-visible");
            io.unobserve(entry.target);
          });
        }, { rootMargin: "0px 0px -7% 0px", threshold: 0.08 })
      : null;

    revealTargets.forEach((element) => {
      if (observer) observer.observe(element);
      else element.classList.add("ca-motion-visible");
    });

    const tiltSelector = [
      ".feature", ".card", ".panel", ".stat", ".program", ".news article",
      ".p4-card", ".testimonial-card", ".school-card", ".blog2", ".blog-card",
      ".job-card", ".gallery-story figure", ".info-card", ".seo-info-card",
      ".seo-step", ".ride-feature", ".requirement", ".faq-item"
    ].join(",");
    document.querySelectorAll(tiltSelector).forEach((card) => {
      if (!protectedMotionZone(card)) card.classList.add("ca-motion-tilt");
    });

    const imageSelector = [
      ".hero-media", ".hero-image", ".gallery-story .photo", ".blog2 .blog-img",
      ".blog-img", ".page-hero .hero-visual", ".rounded-shadow-img", ".about-grid img",
      ".seo-content-section img", ".landing-section img"
    ].join(",");
    const motionImages = Array.from(document.querySelectorAll(imageSelector))
      .filter((el) => !protectedMotionZone(el));
    motionImages.forEach((element) => element.classList.add("ca-motion-image", "ca-motion-scroll-float"));

    const headers = document.querySelectorAll("header,.site-header,.tenant-site-nav");
    const updateHeaderDepth = () => {
      const scrolled = window.scrollY > 18;
      headers.forEach((header) => header.classList.toggle("ca-header-scrolled", scrolled));
      document.body.classList.toggle("ca-scrolled", scrolled);
    };

    const cssViewTimeline = Boolean(window.CSS?.supports?.("animation-timeline: view()"));
    const jsParallaxTargets = (!reduced && !coarse && window.innerWidth > 820 && !cssViewTimeline)
      ? motionImages.filter((element) => element.matches(".hero-media,.hero-image,.gallery-story .photo,.blog2 .blog-img,.page-hero .hero-visual"))
      : [];

    let ticking = false;
    const renderScrollMotion = () => {
      ticking = false;
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      const pct = Math.min(1, Math.max(0, window.scrollY / max));
      scrollProgress.style.transform = `scaleX(${pct})`;
      updateHeaderDepth();

      if (jsParallaxTargets.length) {
        const viewportCenter = window.innerHeight / 2;
        for (const element of jsParallaxTargets) {
          const rect = element.getBoundingClientRect();
          if (rect.bottom < -100 || rect.top > window.innerHeight + 100) continue;
          const center = rect.top + rect.height / 2;
          const normalized = Math.max(-1, Math.min(1, (center - viewportCenter) / window.innerHeight));
          element.style.setProperty("--ca-scroll-float-y", `${Math.round(normalized * -13)}px`);
        }
      }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(renderScrollMotion);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    renderScrollMotion();

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => document.body.classList.add("ca-page-ready"));
    });

    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;
      let url;
      try { url = new URL(link.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || (url.hash && url.pathname === window.location.pathname)) return;
      document.body.classList.remove("ca-page-ready");
      document.body.classList.add("ca-routing");
    }, { passive: true });

    window.addEventListener("pageshow", () => {
      document.body.classList.remove("ca-routing");
      document.body.classList.add("ca-page-ready");
      onScroll();
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();

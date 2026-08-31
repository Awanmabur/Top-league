(() => {
  "use strict";

  function perView() {
    if (window.matchMedia("(min-width: 768px)").matches) return 3;
    if (window.matchMedia("(min-width: 520px)").matches) return 2;
    return 1;
  }

  function initCarousel(root) {
    if (!root || root.dataset.classicCarouselReady === "1") return;
    const track = root.querySelector(".swiper-wrapper");
    const slides = track ? Array.from(track.querySelectorAll(":scope > .swiper-slide")) : [];
    const pagination = root.querySelector(".swiper-pagination");
    if (!track || slides.length < 2) return;
    root.dataset.classicCarouselReady = "1";

    let current = 0;
    let timer = null;
    let scrollFrame = 0;
    let paused = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const maxIndex = () => Math.max(0, slides.length - perView());
    const step = () => {
      if (slides.length < 2) return 0;
      return Math.max(1, slides[1].offsetLeft - slides[0].offsetLeft);
    };
    const clamped = (value) => Math.max(0, Math.min(maxIndex(), value));

    function dots() {
      if (!pagination) return [];
      const count = maxIndex() + 1;
      if (pagination.children.length !== count) {
        pagination.replaceChildren();
        for (let i = 0; i < count; i += 1) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "swiper-pagination-bullet";
          button.setAttribute("aria-label", `Show testimonial ${i + 1}`);
          button.addEventListener("click", () => go(i, true));
          pagination.appendChild(button);
        }
      }
      return Array.from(pagination.children);
    }

    function paintDots() {
      dots().forEach((dot, index) => {
        const active = index === current;
        dot.classList.toggle("swiper-pagination-bullet-active", active);
        dot.setAttribute("aria-current", active ? "true" : "false");
      });
    }

    function go(index, userInitiated = false) {
      current = clamped(index);
      track.scrollTo({ left: current * step(), behavior: reducedMotion.matches ? "auto" : "smooth" });
      paintDots();
      if (userInitiated) restart();
    }

    function stop() {
      if (timer) window.clearInterval(timer);
      timer = null;
    }

    function start() {
      stop();
      if (paused || reducedMotion.matches || window.matchMedia("(max-width: 700px)").matches) return;
      timer = window.setInterval(() => go(current >= maxIndex() ? 0 : current + 1), 2800);
    }

    function restart() { start(); }

    track.addEventListener("scroll", () => {
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        const width = step();
        if (width) current = clamped(Math.round(track.scrollLeft / width));
        paintDots();
      });
    }, { passive: true });

    root.addEventListener("pointerenter", () => { paused = true; stop(); }, { passive: true });
    root.addEventListener("pointerleave", () => { paused = false; start(); }, { passive: true });
    root.addEventListener("focusin", () => { paused = true; stop(); });
    root.addEventListener("focusout", () => { paused = false; start(); });
    document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
    window.addEventListener("resize", () => {
      current = clamped(current);
      go(current);
      start();
    }, { passive: true });
    reducedMotion.addEventListener?.("change", start);

    paintDots();
    start();
  }

  function boot() {
    document.querySelectorAll(".testimonial-wrapper").forEach(initCarousel);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();

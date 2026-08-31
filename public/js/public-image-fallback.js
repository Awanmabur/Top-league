(() => {
  "use strict";
  function localFallbackFor(img) {
    const src = String(img.getAttribute("src") || "").toLowerCase();
    const alt = String(img.getAttribute("alt") || "").toLowerCase();

    if (src.includes("google_play_store_badge")) return "/vendor/marketing/google-play-badge.svg";
    if (src.includes("developer.apple.com/assets/elements/badges")) return "/vendor/marketing/app-store-badge.svg";
    if (src.includes("icons8.com")) return "/vendor/marketing/feature-icon.svg";

    if (alt.includes("logo") || src.includes("logo")) return "/img/academylogo.webp";
    return "/img/feature.webp";
  }

  document.addEventListener("error", (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fallbackApplied === "1") return;
    img.dataset.fallbackApplied = "1";
    const fallback = localFallbackFor(img);
    if (fallback && img.getAttribute("src") !== fallback) img.setAttribute("src", fallback);
  }, true);
})();

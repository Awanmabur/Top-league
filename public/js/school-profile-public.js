// /public/js/school-profile-public.js

function $(id) {
  return document.getElementById(id);
}

function postJson(url, payload) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(payload),
  });
}

function initHamburger() {
  const hamb = $("hamburger");
  const menu = $("mobileMenu");
  hamb?.addEventListener("click", () => menu?.classList.toggle("show"));
}

/**
 * ✅ Tabs: DO NOT jump to hero on phones.
 * - Switches panels
 * - Keeps scroll position if tabs are already visible
 * - Otherwise scrolls to the tabs bar (below sticky topbar)
 */
function initTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");
  const tabsBar = document.querySelector(".tabs");
  const topbar = document.querySelector(".topbar");

  if (!tabs.length || !panels.length) return;

  function topbarH() {
    return topbar?.offsetHeight || 0;
  }

  function tabsBarIsVisibleEnough() {
    if (!tabsBar) return true;
    const r = tabsBar.getBoundingClientRect();
    const offset = topbarH() + 10;
    const withinTop = r.top >= offset && r.top <= offset + 120;
    const notTooLow = r.bottom > offset;
    return withinTop && notTooLow;
  }

  function scrollToTabsBar() {
    if (!tabsBar) return;
    if (tabsBarIsVisibleEnough()) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const y =
          tabsBar.getBoundingClientRect().top +
          window.scrollY -
          (topbarH() + 12);
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
      });
    });
  }

  function activate(tabId, opts = { setHash: true, scroll: true }) {
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tabId));
    panels.forEach((p) => p.classList.toggle("active", p.id === tabId));

    if (opts.setHash) {
      try {
        history.replaceState(null, "", `#${tabId}`);
      } catch (e) {}
    }

    if (opts.scroll) scrollToTabsBar();
  }

  tabs.forEach((t) =>
    t.addEventListener("click", () =>
      activate(t.dataset.tab, { setHash: true, scroll: true }),
    ),
  );

  const hash = (location.hash || "").replace("#", "").trim();
  if (
    hash &&
    document.getElementById(hash) &&
    document.querySelector(`.tab[data-tab="${hash}"]`)
  ) {
    activate(hash, { setHash: false, scroll: false });
  }

  window.__activateSchoolTab = (tabId, options = {}) =>
    activate(tabId, { setHash: true, scroll: true, ...options });
}

function initGoTabLinks() {
  document.querySelectorAll("[data-go-tab]").forEach((a) => {
    a.addEventListener("click", (e) => {
      const tabId = a.getAttribute("data-go-tab");
      if (!tabId) return;
      if (typeof window.__activateSchoolTab !== "function") return;

      e.preventDefault();
      window.__activateSchoolTab(tabId, { setHash: true, scroll: true });
      $("mobileMenu")?.classList.remove("show");
    });
  });

  window.addEventListener("hashchange", () => {
    const hash = (location.hash || "").replace("#", "").trim();
    if (!hash) return;
    if (!document.getElementById(hash)) return;
    if (!document.querySelector(`.tab[data-tab="${hash}"]`)) return;
    if (typeof window.__activateSchoolTab !== "function") return;
    window.__activateSchoolTab(hash, { setHash: false, scroll: true });
  });
}

/* ✅ Cover image */
function initCover() {
  const cover = $("cover");
  if (!cover) return;

  const url = (cover.dataset.coverUrl || "").trim();
  if (!url) return;

  const safe = url.replace(/"/g, '\\"');
  cover.style.setProperty("--cover-url", `url("${safe}")`);
}

function initSubjectSearch() {
  const ps = $("subjectSearch") || $("programSearch");
  const rows = document.querySelectorAll(".subject-row, .program-row");
  ps?.addEventListener("input", () => {
    const q = (ps.value || "").trim().toLowerCase();
    rows.forEach((r) => {
      const hay = (r.getAttribute("data-name") || "").toLowerCase();
      r.style.display = hay.includes(q) ? "" : "none";
    });
  });
}

/**
 * ✅ FIXED LIGHTBOX (PC safe):
 * - Uses event delegation on #galleryGrid
 * - Rebuilds sources every time you open (works if gallery updates)
 * - Prevents default button behavior just in case
 */
function initLightbox() {
  const grid = $("galleryGrid");
  const lb = $("lightbox");
  const lbImg = $("lbImg");
  const lbClose = $("lbClose");
  const lbPrev = $("lbPrev");
  const lbNext = $("lbNext");

  if (!grid || !lb || !lbImg) return;

  let idx = 0;

  function getSources() {
    return [...grid.querySelectorAll(".g-item")]
      .map((b) => b?.dataset?.src)
      .filter(Boolean);
  }

  function open(i) {
    const sources = getSources();
    if (!sources.length) return;

    idx = Math.max(0, Math.min(i, sources.length - 1));
    lbImg.src = sources[idx];

    lb.classList.add("show");
    lb.setAttribute("aria-hidden", "false");
  }

  function close() {
    lb.classList.remove("show");
    lb.setAttribute("aria-hidden", "true");
    lbImg.src = "";
  }

  function prev() {
    const sources = getSources();
    if (!sources.length) return;
    open((idx - 1 + sources.length) % sources.length);
  }

  function next() {
    const sources = getSources();
    if (!sources.length) return;
    open((idx + 1) % sources.length);
  }

  // ✅ Delegated click handler (works reliably on PC)
  grid.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".g-item");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const items = [...grid.querySelectorAll(".g-item")];
    const i = items.indexOf(btn);
    open(i >= 0 ? i : 0);
  });

  lbClose?.addEventListener("click", (e) => {
    e.preventDefault();
    close();
  });
  lbPrev?.addEventListener("click", (e) => {
    e.preventDefault();
    prev();
  });
  lbNext?.addEventListener("click", (e) => {
    e.preventDefault();
    next();
  });

  lb.addEventListener("click", (e) => {
    if (e.target === lb) close();
  });

  document.addEventListener("keydown", (e) => {
    if (!lb.classList.contains("show")) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  });
}

function initForms() {
  const inquiryForm = $("inquiryForm");
  const inquiryMsg = $("inquiryMsg");
  const reviewForm = $("reviewForm");
  const reviewMsg = $("reviewMsg");

  inquiryForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    inquiryMsg.textContent = "";

    const url = inquiryForm.action;
    const payload = Object.fromEntries(new FormData(inquiryForm).entries());

    try {
      const res = await postJson(url, payload);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok)
        throw new Error(data.message || `Failed (${res.status})`);
      inquiryMsg.textContent = data.message || "Message submitted";
      inquiryForm.reset();
    } catch (err) {
      inquiryMsg.textContent = err.message || "Failed";
    }
  });

  reviewForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    reviewMsg.textContent = "";

    const url = reviewForm.action;
    const payload = Object.fromEntries(new FormData(reviewForm).entries());

    try {
      const res = await postJson(url, payload);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok)
        throw new Error(data.message || `Failed (${res.status})`);
      reviewMsg.textContent = data.message || "Review submitted";
      reviewForm.reset();
    } catch (err) {
      reviewMsg.textContent = err.message || "Failed";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initHamburger();
  initTabs();
  initGoTabLinks();
  initCover();
  initSubjectSearch();
  initLightbox();
  initForms();
});

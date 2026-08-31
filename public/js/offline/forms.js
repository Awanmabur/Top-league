// Generic offline-form framework. Opt any form into offline-safe submission
// by adding data-offline="true" — no other wiring required. While online,
// forms submit and behave exactly as a normal form post (including
// following server redirects). While offline, the submission is queued in
// IndexedDB and replayed automatically once connectivity returns.
(function () {
  if (!("indexedDB" in window)) return; // unsupported browser, fall back to normal form posts

  const banner = createBanner();
  let pendingCount = 0;
  let needsLogin = false;

  function createBanner() {
    const el = document.createElement("div");
    el.id = "offline-status-banner";
    el.setAttribute("role", "status");
    el.style.cssText = [
      "position:fixed", "left:50%", "bottom:18px", "transform:translateX(-50%)",
      "z-index:99999", "display:none", "align-items:center", "gap:10px",
      "padding:10px 16px", "border-radius:999px", "font-family:system-ui,Segoe UI,Arial",
      "font-size:13px", "font-weight:700", "color:#fff", "background:#0f172a",
      "box-shadow:0 12px 30px rgba(2,8,23,.25)",
    ].join(";");
    el.addEventListener("click", () => {
      if (needsLogin) window.location.href = "/login";
    });
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(el));
    return el;
  }

  function renderBanner() {
    if (!navigator.onLine) {
      banner.style.background = "#92400e";
      banner.textContent = pendingCount
        ? `Offline — ${pendingCount} item(s) saved locally, will sync automatically`
        : "Offline — changes will be saved locally until you're back online";
      banner.style.display = "flex";
      return;
    }

    if (needsLogin) {
      banner.style.background = "#b91c1c";
      banner.textContent = `Log in again to sync ${pendingCount} saved item(s) — click here`;
      banner.style.cursor = "pointer";
      banner.style.display = "flex";
      return;
    }

    banner.style.cursor = "";

    if (pendingCount > 0) {
      banner.style.background = "#0a6fbf";
      banner.textContent = `Syncing ${pendingCount} saved item(s)…`;
      banner.style.display = "flex";
      return;
    }

    banner.style.display = "none";
  }

  async function refreshPendingCount() {
    try {
      pendingCount = await window.OfflineDb.count();
    } catch (_) {
      pendingCount = 0;
    }
    renderBanner();
  }

  async function flushNow() {
    if (!navigator.onLine) return;
    try {
      let sawNeedsLogin = false;
      await window.OfflineQueue.flush({
        onItemSettled: ({ needsLogin: itemNeedsLogin }) => {
          if (itemNeedsLogin) sawNeedsLogin = true;
        },
      });
      needsLogin = sawNeedsLogin;
    } catch (_) {
      // ignore — likely still offline, will retry on next online event
    }
    await refreshPendingCount();
  }

  async function registerBackgroundSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ("sync" in reg) {
        await reg.sync.register("flush-offline-queue");
        return true;
      }
    } catch (_) {
      // Background Sync unsupported (e.g. Safari/Firefox) — fall back below
    }
    return false;
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = [
      "position:fixed", "left:50%", "bottom:68px", "transform:translateX(-50%)",
      "z-index:99999", "padding:10px 16px", "border-radius:12px",
      "font-family:system-ui,Segoe UI,Arial", "font-size:13px", "font-weight:700",
      "color:#fff", "background:#16a34a", "box-shadow:0 12px 30px rgba(2,8,23,.2)",
    ].join(";");
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function setBusy(form, busy) {
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = busy;
    form.classList.toggle("is-offline-submitting", busy);
  }

  async function handleSubmit(event) {
    const form = event.target;
    if (!form.matches('form[data-offline="true"]')) return;

    event.preventDefault();
    setBusy(form, true);

    const formData = new FormData(form);
    const url = form.getAttribute("action") || window.location.pathname;
    const method = (form.getAttribute("method") || "POST").toUpperCase();

    if (navigator.onLine) {
      try {
        const res = await fetch(url, { method, body: formData, credentials: "same-origin" });
        if (res.ok || (res.status >= 300 && res.status < 400)) {
          window.location.href = res.url || url;
          return;
        }
        // Server explicitly rejected the request (validation error, etc.) —
        // don't queue it, let the normal page error handling take over.
        setBusy(form, false);
        return;
      } catch (_) {
        // network failed mid-flight — fall through to queue below
      }
    }

    await window.OfflineQueue.enqueue({ url, method, formData, label: form.dataset.offlineLabel || "" });
    showToast(form.dataset.offlineSavedMessage || "Saved offline — it will sync automatically.");
    setBusy(form, false);
    await refreshPendingCount();
    registerBackgroundSync();
  }

  document.addEventListener("submit", handleSubmit, true);
  window.addEventListener("online", () => {
    renderBanner();
    flushNow();
  });
  window.addEventListener("offline", renderBanner);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "offline-queue-flushed") {
        refreshPendingCount();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderBanner();
    refreshPendingCount();
  });

  window.__offlineForms = { flushNow, refreshPendingCount };
})();

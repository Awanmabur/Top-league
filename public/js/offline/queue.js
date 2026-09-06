// Bounded offline request queue. Only explicitly opted-in, same-origin form
// submissions are persisted. Files, secrets and unbounded payloads are never
// written to IndexedDB.
(function (global) {
  const STATUS = {
    PENDING: "pending",
    SYNCING: "syncing",
    FAILED: "failed",
  };
  const MAX_QUEUE_ITEMS = 50;
  const MAX_PAYLOAD_BYTES = 1024 * 1024;
  const MAX_ATTEMPTS = 8;
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const ALLOWED_METHODS = new Set(["POST", "PUT", "PATCH"]);
  const SECRET_KEY_RE = /(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie)/i;

  function origin() {
    return String(global.location?.origin || "");
  }

  function normalizeUrl(rawUrl) {
    const base = origin();
    if (!base) throw new Error("Offline queue cannot determine page origin");
    const parsed = new URL(String(rawUrl || ""), base);
    if (parsed.origin !== base) throw new Error("Offline queue accepts same-origin requests only");
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Offline queue requires HTTP(S)");
    return `${parsed.pathname}${parsed.search}`;
  }

  function serializeFormData(formData) {
    if (!(formData instanceof FormData)) throw new Error("Offline queue requires form data");
    const entries = [];
    let bytes = 0;
    const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

    for (const [rawKey, value] of formData.entries()) {
      const key = String(rawKey || "");
      if (!key || key.length > 180) throw new Error("Offline form contains an invalid field name");
      if (key !== "_csrf" && SECRET_KEY_RE.test(key)) {
        throw new Error("Sensitive credentials cannot be stored for offline replay");
      }
      if (typeof value !== "string") {
        throw new Error("File uploads cannot be stored for offline replay");
      }
      if (value.length > 64 * 1024) throw new Error("Offline form field is too large");
      bytes += encoder ? encoder.encode(key).length + encoder.encode(value).length : key.length + value.length;
      if (bytes > MAX_PAYLOAD_BYTES) throw new Error("Offline form exceeds the local storage limit");
      entries.push([key, value]);
    }
    return entries;
  }

  function toFormData(entries) {
    const fd = new FormData();
    (Array.isArray(entries) ? entries : []).forEach(([key, value]) => {
      if (typeof key === "string" && typeof value === "string") fd.append(key, value);
    });
    return fd;
  }

  async function enqueue({ url, method = "POST", formData, label = "" }) {
    const normalizedMethod = String(method).toUpperCase();
    if (!ALLOWED_METHODS.has(normalizedMethod)) throw new Error("This request cannot be queued offline");
    const safeUrl = normalizeUrl(url);
    const entries = serializeFormData(formData);
    const count = await global.OfflineDb.count();
    if (count >= MAX_QUEUE_ITEMS) throw new Error("Offline queue is full. Reconnect before saving more changes.");

    const record = {
      url: safeUrl,
      method: normalizedMethod,
      entries,
      label: String(label || "").slice(0, 120),
      status: STATUS.PENDING,
      attempts: 0,
      error: "",
      createdAt: Date.now(),
    };

    const id = await global.OfflineDb.add(record);
    return Object.assign({ id }, record);
  }

  // Replays pending items in submission order. Old/excessively retried items
  // fail closed rather than remaining reusable browser credentials forever.
  async function flush({ onItemSettled } = {}) {
    const items = (await global.OfflineDb.getAll()).sort((a, b) => a.createdAt - b.createdAt);
    const results = { synced: 0, failed: 0, remaining: 0 };
    const now = Date.now();

    for (const item of items) {
      if (!Number.isFinite(Number(item.createdAt)) || now - Number(item.createdAt) > MAX_AGE_MS) {
        await global.OfflineDb.remove(item.id);
        results.failed += 1;
        onItemSettled?.({ item, ok: false, terminal: true, expired: true });
        continue;
      }
      if (Number(item.attempts || 0) >= MAX_ATTEMPTS) {
        await global.OfflineDb.update(item.id, { status: STATUS.FAILED, error: "Retry limit reached. Review and submit again." });
        results.failed += 1;
        onItemSettled?.({ item, ok: false, terminal: true });
        continue;
      }
      if (item.status === STATUS.FAILED) {
        results.remaining += 1;
        continue;
      }

      let safeUrl;
      try {
        safeUrl = normalizeUrl(item.url);
      } catch (_) {
        await global.OfflineDb.remove(item.id);
        results.failed += 1;
        onItemSettled?.({ item, ok: false, terminal: true });
        continue;
      }

      const method = String(item.method || "").toUpperCase();
      if (!ALLOWED_METHODS.has(method)) {
        await global.OfflineDb.remove(item.id);
        results.failed += 1;
        onItemSettled?.({ item, ok: false, terminal: true });
        continue;
      }

      await global.OfflineDb.update(item.id, { status: STATUS.SYNCING });

      try {
        const res = await fetch(safeUrl, {
          method,
          body: toFormData(item.entries),
          credentials: "same-origin",
          redirect: "manual",
          cache: "no-store",
          headers: { "X-Offline-Replay": "1" },
        });

        if (res.ok || (res.status >= 300 && res.status < 400)) {
          await global.OfflineDb.remove(item.id);
          results.synced += 1;
          onItemSettled?.({ item, ok: true });
          continue;
        }

        if (res.status === 401) {
          await global.OfflineDb.update(item.id, {
            status: STATUS.PENDING,
            error: "You were logged out. Log in again, then it will sync automatically.",
            attempts: Number(item.attempts || 0) + 1,
          });
          results.remaining += 1;
          onItemSettled?.({ item, ok: false, terminal: false, needsLogin: true });
          break;
        }

        if (res.status >= 400 && res.status < 500) {
          const message =
            res.status === 403
              ? "This saved submission expired or is no longer authorized. Review and submit it again."
              : `Server rejected this submission (HTTP ${res.status}).`;
          await global.OfflineDb.update(item.id, {
            status: STATUS.FAILED,
            error: message,
            attempts: Number(item.attempts || 0) + 1,
          });
          results.failed += 1;
          onItemSettled?.({ item, ok: false, terminal: true });
          continue;
        }

        throw new Error(`Server error (HTTP ${res.status})`);
      } catch (err) {
        const attempts = Number(item.attempts || 0) + 1;
        await global.OfflineDb.update(item.id, {
          status: attempts >= MAX_ATTEMPTS ? STATUS.FAILED : STATUS.PENDING,
          error: err?.message || "Network error",
          attempts,
        });
        if (attempts >= MAX_ATTEMPTS) results.failed += 1;
        else results.remaining += 1;
        onItemSettled?.({ item, ok: false, terminal: attempts >= MAX_ATTEMPTS });
        break;
      }
    }

    return results;
  }

  async function retry(id) {
    const items = await global.OfflineDb.getAll();
    const item = items.find((candidate) => candidate.id === id);
    if (!item || Date.now() - Number(item.createdAt || 0) > MAX_AGE_MS) {
      if (item) await global.OfflineDb.remove(id);
      throw new Error("This offline submission has expired");
    }
    await global.OfflineDb.update(id, { status: STATUS.PENDING, error: "", attempts: 0 });
  }

  async function discard(id) {
    await global.OfflineDb.remove(id);
  }

  global.OfflineQueue = { STATUS, enqueue, flush, retry, discard };
})(typeof self !== "undefined" ? self : this);

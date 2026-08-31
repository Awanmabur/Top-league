// Generic offline request queue: enqueue a form submission while offline,
// replay it once connectivity returns. Used by both page scripts (forms.js)
// and the service worker's "sync" event handler, so no ES module syntax.
(function (global) {
  const STATUS = {
    PENDING: "pending",
    SYNCING: "syncing",
    FAILED: "failed",
  };

  function serializeFormData(formData) {
    const entries = [];
    for (const [key, value] of formData.entries()) {
      entries.push([key, value]);
    }
    return entries;
  }

  function toFormData(entries) {
    const fd = new FormData();
    entries.forEach(([key, value]) => fd.append(key, value));
    return fd;
  }

  async function enqueue({ url, method = "POST", formData, label = "" }) {
    const record = {
      url,
      method: String(method).toUpperCase(),
      entries: serializeFormData(formData),
      label,
      status: STATUS.PENDING,
      attempts: 0,
      error: "",
      createdAt: Date.now(),
    };

    const id = await global.OfflineDb.add(record);
    return Object.assign({ id }, record);
  }

  // Replays every pending/failed item in submission order. Stops an item's
  // retries on a 4xx (the request itself is invalid/stale, e.g. an expired
  // CSRF token) rather than retrying forever; keeps retrying on network
  // failures since those usually mean we're still offline.
  async function flush({ onItemSettled } = {}) {
    const items = (await global.OfflineDb.getAll()).sort((a, b) => a.createdAt - b.createdAt);
    const results = { synced: 0, failed: 0, remaining: 0 };

    for (const item of items) {
      if (item.status === STATUS.FAILED) {
        results.remaining += 1;
        continue;
      }

      await global.OfflineDb.update(item.id, { status: STATUS.SYNCING });

      try {
        const res = await fetch(item.url, {
          method: item.method,
          body: toFormData(item.entries),
          credentials: "same-origin",
          headers: { "X-Offline-Replay": "1" },
        });

        if (res.ok || (res.status >= 300 && res.status < 400)) {
          await global.OfflineDb.remove(item.id);
          results.synced += 1;
          onItemSettled?.({ item, ok: true });
          continue;
        }

        // Session expired/invalidated while offline: this isn't wrong with
        // the item itself, every other queued item will fail the exact same
        // way, so leave them all PENDING (not FAILED) and stop rather than
        // burning through the queue marking everything unrecoverable.
        if (res.status === 401) {
          await global.OfflineDb.update(item.id, {
            status: STATUS.PENDING,
            error: "You were logged out. Log in again, then it will sync automatically.",
            attempts: item.attempts + 1,
          });
          results.remaining += 1;
          onItemSettled?.({ item, ok: false, terminal: false, needsLogin: true });
          break;
        }

        if (res.status >= 400 && res.status < 500) {
          const message =
            res.status === 403
              ? "You don't have permission to submit this — it was not saved."
              : `Server rejected this submission (HTTP ${res.status}).`;
          await global.OfflineDb.update(item.id, {
            status: STATUS.FAILED,
            error: message,
            attempts: item.attempts + 1,
          });
          results.failed += 1;
          onItemSettled?.({ item, ok: false, terminal: true });
          continue;
        }

        throw new Error(`Server error (HTTP ${res.status})`);
      } catch (err) {
        await global.OfflineDb.update(item.id, {
          status: STATUS.PENDING,
          error: err?.message || "Network error",
          attempts: item.attempts + 1,
        });
        results.remaining += 1;
        onItemSettled?.({ item, ok: false, terminal: false });
        // Stop on the first network failure rather than hammering every
        // remaining item — we're almost certainly still offline.
        break;
      }
    }

    return results;
  }

  async function retry(id) {
    await global.OfflineDb.update(id, { status: STATUS.PENDING, error: "" });
  }

  async function discard(id) {
    await global.OfflineDb.remove(id);
  }

  global.OfflineQueue = { STATUS, enqueue, flush, retry, discard };
})(typeof self !== "undefined" ? self : this);

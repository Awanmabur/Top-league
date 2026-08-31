// Shared IndexedDB helper for the offline request queue.
// Loaded both as a plain <script> in pages and via importScripts() inside the
// service worker, so it must not use ES module import/export syntax.
(function (global) {
  const DB_NAME = "classic-academy-offline";
  const DB_VERSION = 1;
  const STORE = "requests";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("status", "status");
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;

      Promise.resolve(fn(store))
        .then((r) => {
          result = r;
        })
        .catch(reject);

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  }

  function reqToPromise(idbRequest) {
    return new Promise((resolve, reject) => {
      idbRequest.onsuccess = () => resolve(idbRequest.result);
      idbRequest.onerror = () => reject(idbRequest.error);
    });
  }

  const OfflineDb = {
    async add(record) {
      return withStore("readwrite", (store) => reqToPromise(store.add(record)));
    },

    async update(id, changes) {
      return withStore("readwrite", async (store) => {
        const existing = await reqToPromise(store.get(id));
        if (!existing) return null;
        const next = Object.assign({}, existing, changes);
        await reqToPromise(store.put(next));
        return next;
      });
    },

    async remove(id) {
      return withStore("readwrite", (store) => reqToPromise(store.delete(id)));
    },

    async getAll() {
      return withStore("readonly", (store) => reqToPromise(store.getAll()));
    },

    async count() {
      return withStore("readonly", (store) => reqToPromise(store.count()));
    },
  };

  global.OfflineDb = OfflineDb;
})(typeof self !== "undefined" ? self : this);

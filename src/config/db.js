// src/config/db.js
const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return String(v).toLowerCase() === "true";
}

const platformUri = process.env.PLATFORM_DB_URI;
const tenantBaseUri = process.env.MONGO_URI_BASE || process.env.MONGO_URI;

if (!platformUri) {
  throw new Error("Missing PLATFORM_DB_URI");
}

if (!tenantBaseUri) {
  throw new Error("Missing MONGO_URI_BASE or MONGO_URI");
}

// keep index creation off for speed
const COMMON_OPTS = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 20000,
  connectTimeoutMS: 20000,
  socketTimeoutMS: 30000,
  autoIndex: false,
  autoCreate: false,
  bufferCommands: false,
};

const platformConnection = mongoose.createConnection(platformUri, COMMON_OPTS);

platformConnection.on("error", (e) => {
  console.error("❌ Platform DB error:", e.message);
});

async function waitForPlatform() {
  if (platformConnection.readyState === 1) return;

  if (typeof platformConnection.asPromise === "function") {
    await platformConnection.asPromise();
    return;
  }

  await new Promise((resolve, reject) => {
    platformConnection.once("connected", resolve);
    platformConnection.once("error", reject);
  });
}

const TENANT_CACHE = new Map();
const TENANT_CONNECTING = new Map();

async function waitForConn(conn) {
  if (conn.readyState === 1) return;

  if (typeof conn.asPromise === "function") {
    await conn.asPromise();
    return;
  }

  await new Promise((resolve, reject) => {
    conn.once("connected", resolve);
    conn.once("error", reject);
  });
}

async function createTenantConnection(dbName) {
  const conn = mongoose.createConnection(tenantBaseUri, {
    ...COMMON_OPTS,
    dbName,
  });

  conn.on("error", (e) => {
    console.error(`❌ Tenant DB error (${dbName}):`, e.message);
  });

  try {
    await waitForConn(conn);
    return conn;
  } catch (err) {
    try {
      await conn.close();
    } catch (_) {}
    throw err;
  }
}

async function getTenantConnection(dbName) {
  if (!dbName) throw new Error("getTenantConnection: dbName is required");

  const cached = TENANT_CACHE.get(dbName);
  if (cached && cached.readyState === 1) {
    return cached;
  }

  if (TENANT_CONNECTING.has(dbName)) {
    return TENANT_CONNECTING.get(dbName);
  }

  const connectPromise = createTenantConnection(dbName)
    .then((conn) => {
      TENANT_CACHE.set(dbName, conn);
      TENANT_CONNECTING.delete(dbName);
      return conn;
    })
    .catch((err) => {
      TENANT_CACHE.delete(dbName);
      TENANT_CONNECTING.delete(dbName);
      throw err;
    });

  TENANT_CONNECTING.set(dbName, connectPromise);
  return connectPromise;
}

module.exports = {
  platformConnection,
  waitForPlatform,
  getTenantConnection,
  boolEnv,
};
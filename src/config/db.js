// src/config/db.js
const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return String(v).toLowerCase() === "true";
}

function boundedIntEnv(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const platformUri = process.env.PLATFORM_DB_URI;
const tenantBaseUri = process.env.MONGO_URI_BASE || process.env.MONGO_URI;

if (!platformUri) {
  throw new Error("Missing PLATFORM_DB_URI");
}

if (!tenantBaseUri) {
  throw new Error("Missing MONGO_URI_BASE or MONGO_URI");
}

// Keep index creation off at runtime. Production gets a larger shared pool so
// platform routing/session-independent traffic does not serialize behind the
// small development default. Values stay bounded to avoid connection storms.
const DEFAULT_MAX_POOL_SIZE = process.env.NODE_ENV === "production" ? 30 : 10;
const DEFAULT_MIN_POOL_SIZE = process.env.NODE_ENV === "production" ? 2 : 0;
const COMMON_OPTS = {
  maxPoolSize: boundedIntEnv("MONGO_MAX_POOL_SIZE", DEFAULT_MAX_POOL_SIZE, 5, 100),
  minPoolSize: boundedIntEnv("MONGO_MIN_POOL_SIZE", DEFAULT_MIN_POOL_SIZE, 0, 20),
  serverSelectionTimeoutMS: boundedIntEnv("MONGO_SERVER_SELECTION_TIMEOUT_MS", 10000, 2000, 30000),
  connectTimeoutMS: boundedIntEnv("MONGO_CONNECT_TIMEOUT_MS", 10000, 2000, 30000),
  socketTimeoutMS: boundedIntEnv("MONGO_SOCKET_TIMEOUT_MS", 30000, 5000, 120000),
  autoIndex: false,
  autoCreate: false,
  bufferCommands: false,
};

const platformConnection = mongoose.createConnection(platformUri, COMMON_OPTS);

platformConnection.on("error", (e) => {
  console.error("Platform DB error:", e.message);
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

function getMongoHost(uri) {
  try {
    return new URL(uri).host.toLowerCase();
  } catch {
    return "";
  }
}

const PLATFORM_MONGO_HOST = getMongoHost(platformUri);
const TENANT_MONGO_HOST = getMongoHost(tenantBaseUri);
const CAN_REUSE_PLATFORM_CLIENT =
  PLATFORM_MONGO_HOST &&
  TENANT_MONGO_HOST &&
  PLATFORM_MONGO_HOST === TENANT_MONGO_HOST;

function shouldReusePlatformClient() {
  if (process.env.REUSE_PLATFORM_MONGO !== undefined) {
    return boolEnv("REUSE_PLATFORM_MONGO", CAN_REUSE_PLATFORM_CLIENT);
  }

  return CAN_REUSE_PLATFORM_CLIENT;
}

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
  if (shouldReusePlatformClient()) {
    await waitForPlatform();
    const conn = platformConnection.useDb(dbName, { useCache: true });
    conn.on("error", (e) => {
      console.error(`Tenant DB error (${dbName}):`, e.message);
    });
    return conn;
  }

  const conn = mongoose.createConnection(tenantBaseUri, {
    ...COMMON_OPTS,
    dbName,
  });

  conn.on("error", (e) => {
    console.error(`Tenant DB error (${dbName}):`, e.message);
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
  boundedIntEnv,
  COMMON_OPTS,
};

const net = require("net");
const tls = require("tls");
const { EventEmitter } = require("events");

function parseRedisUrl(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); }
  catch (_) { throw new Error("REDIS_URL is invalid."); }
  if (!["redis:", "rediss:"].includes(url.protocol)) {
    throw new Error("REDIS_URL must use redis:// or rediss://.");
  }
  const dbRaw = String(url.pathname || "").replace(/^\//, "");
  const database = dbRaw === "" ? 0 : Number(dbRaw);
  if (!Number.isInteger(database) || database < 0) throw new Error("REDIS_URL database must be a non-negative integer.");
  return {
    secure: url.protocol === "rediss:",
    host: url.hostname,
    port: Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379)),
    username: decodeURIComponent(url.username || ""),
    password: decodeURIComponent(url.password || ""),
    database,
  };
}

function encodeCommand(parts) {
  const buffers = [Buffer.from(`*${parts.length}\r\n`)];
  for (const part of parts) {
    const value = Buffer.isBuffer(part) ? part : Buffer.from(String(part));
    buffers.push(Buffer.from(`$${value.length}\r\n`), value, Buffer.from("\r\n"));
  }
  return Buffer.concat(buffers);
}

function readLine(buffer, offset) {
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return null;
  return { value: buffer.toString("utf8", offset, end), next: end + 2 };
}

function parseReply(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const line = readLine(buffer, offset + 1);
  if (!line) return null;
  if (type === "+") return { value: line.value, next: line.next };
  if (type === "-") {
    const error = new Error(line.value || "Redis command failed.");
    error.code = "REDIS_COMMAND_ERROR";
    return { error, next: line.next };
  }
  if (type === ":") return { value: Number(line.value), next: line.next };
  if (type === "$") {
    const length = Number(line.value);
    if (length === -1) return { value: null, next: line.next };
    if (!Number.isInteger(length) || length < 0) throw new Error("Invalid Redis bulk reply length.");
    const end = line.next + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.toString("utf8", line.next, end), next: end + 2 };
  }
  if (type === "*") {
    const count = Number(line.value);
    if (count === -1) return { value: null, next: line.next };
    if (!Number.isInteger(count) || count < 0) throw new Error("Invalid Redis array reply length.");
    const values = [];
    let cursor = line.next;
    for (let i = 0; i < count; i += 1) {
      const item = parseReply(buffer, cursor);
      if (!item) return null;
      values.push(item.error || item.value);
      cursor = item.next;
    }
    return { value: values, next: cursor };
  }
  throw new Error(`Unsupported Redis reply type '${type}'.`);
}

class RedisClient extends EventEmitter {
  constructor(url, options = {}) {
    super();
    this.config = typeof url === "string" ? parseRedisUrl(url) : url;
    if (!this.config) throw new Error("Redis configuration is required.");
    this.connectTimeoutMs = Math.min(Math.max(Number(options.connectTimeoutMs || process.env.REDIS_CONNECT_TIMEOUT_MS || 3000), 500), 30000);
    this.commandTimeoutMs = Math.min(Math.max(Number(options.commandTimeoutMs || process.env.REDIS_COMMAND_TIMEOUT_MS || 1000), 100), 15000);
    this.socket = null;
    this.connecting = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.ready = false;
    this.closing = false;
    this.reconnectTimer = null;
    this.reconnectDelayMs = Math.min(Math.max(Number(options.reconnectMinDelayMs || process.env.REDIS_RECONNECT_MIN_DELAY_MS || 250), 100), 5000);
    this.reconnectMaxDelayMs = Math.min(Math.max(Number(options.reconnectMaxDelayMs || process.env.REDIS_RECONNECT_MAX_DELAY_MS || 5000), this.reconnectDelayMs), 30000);
    this.currentReconnectDelayMs = this.reconnectDelayMs;
  }

  isReady() { return this.ready && Boolean(this.socket && !this.socket.destroyed); }

  async connect() {
    if (this.isReady()) return this;
    this.closing = false;
    if (this.connecting) return this.connecting;
    this.ready = false;
    this.connecting = new Promise((resolve, reject) => {
      const options = { host: this.config.host, port: this.config.port };
      if (this.config.secure) options.servername = this.config.host;
      const socket = this.config.secure ? tls.connect(options) : net.createConnection(options);
      let settled = false;
      const timer = setTimeout(() => {
        const err = new Error("Redis connection timed out.");
        err.code = "REDIS_CONNECT_TIMEOUT";
        socket.destroy(err);
      }, this.connectTimeoutMs);
      timer.unref?.();

      const failConnect = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connecting = null;
        reject(err);
      };
      socket.once("error", failConnect);
      const readyEvent = this.config.secure ? "secureConnect" : "connect";
      socket.once(readyEvent, async () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeListener("error", failConnect);
        this.socket = socket;
        this._bindSocket(socket);
        try {
          if (this.config.password) {
            if (this.config.username) await this.sendCommand(["AUTH", this.config.username, this.config.password], { skipConnect: true });
            else await this.sendCommand(["AUTH", this.config.password], { skipConnect: true });
          }
          if (this.config.database) await this.sendCommand(["SELECT", this.config.database], { skipConnect: true });
          const pong = await this.sendCommand(["PING"], { skipConnect: true });
          if (String(pong).toUpperCase() !== "PONG") throw new Error("Redis PING did not return PONG.");
          this.ready = true;
          this.currentReconnectDelayMs = this.reconnectDelayMs;
          this.connecting = null;
          resolve(this);
        } catch (err) {
          this.ready = false;
          this.connecting = null;
          socket.destroy();
          reject(err);
        }
      });
    });
    return this.connecting;
  }

  _scheduleReconnect() {
    if (this.closing || this.reconnectTimer || this.isReady()) return;
    const delay = this.currentReconnectDelayMs;
    this.currentReconnectDelayMs = Math.min(this.reconnectMaxDelayMs, Math.max(this.reconnectDelayMs, delay * 2));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        this.emit("error", err);
        this._scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  _bindSocket(socket) {
    socket.setNoDelay?.(true);
    socket.setKeepAlive?.(true, 5000);
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this._drainReplies();
    });
    socket.on("error", (err) => this.emit("error", err));
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      this.ready = false;
      const err = new Error("Redis connection closed.");
      err.code = "REDIS_CONNECTION_CLOSED";
      while (this.pending.length) this.pending.shift().reject(err);
      this.buffer = Buffer.alloc(0);
      this._scheduleReconnect();
    });
  }

  _drainReplies() {
    while (this.pending.length && this.buffer.length) {
      let parsed;
      try { parsed = parseReply(this.buffer, 0); }
      catch (err) {
        this.pending.shift()?.reject(err);
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.next);
      const pending = this.pending.shift();
      if (parsed.error) pending.reject(parsed.error);
      else pending.resolve(parsed.value);
    }
  }

  async sendCommand(parts, { skipConnect = false, timeoutMs = this.commandTimeoutMs } = {}) {
    if (!skipConnect) await this.connect();
    const effectiveTimeoutMs = Math.min(Math.max(Number(timeoutMs || this.commandTimeoutMs), 50), 15000);
    if (!this.socket || this.socket.destroyed) throw new Error("Redis is not connected.");
    return new Promise((resolve, reject) => {
      let timer = null;
      const settleResolve = (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      const settleReject = (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      };
      const entry = { resolve: settleResolve, reject: settleReject };
      this.pending.push(entry);
      timer = setTimeout(() => {
        const index = this.pending.indexOf(entry);
        if (index < 0) return;
        this.pending.splice(index, 1);
        const err = new Error("Redis command timed out.");
        err.code = "REDIS_COMMAND_TIMEOUT";
        settleReject(err);
        // RESP replies are ordered. Once a command times out we cannot safely
        // reuse this socket because a late reply could be mistaken for the
        // next command, so force a clean reconnect.
        if (this.socket && !this.socket.destroyed) this.socket.destroy();
      }, effectiveTimeoutMs);
      timer.unref?.();
      this.socket.write(encodeCommand(parts), (err) => {
        if (!err) return;
        const index = this.pending.indexOf(entry);
        if (index >= 0) this.pending.splice(index, 1);
        settleReject(err);
      });
    });
  }

  command(...parts) {
    const commandParts = parts.length === 1 && Array.isArray(parts[0]) ? parts[0] : parts;
    return this.sendCommand(commandParts);
  }
  ping() { return this.command("PING"); }
  get(key, options) { return this.sendCommand(["GET", key], options); }
  setEx(key, seconds, value, options) {
    return this.sendCommand(["SETEX", key, Math.max(1, Math.ceil(Number(seconds) || 1)), value], options);
  }
  del(...keys) { return keys.length ? this.command("DEL", ...keys) : Promise.resolve(0); }

  async close() {
    this.closing = true;
    this.ready = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.connecting = null;
    if (!socket || socket.destroyed) return;
    await new Promise((resolve) => {
      socket.once("close", resolve);
      socket.end();
      setTimeout(() => { if (!socket.destroyed) socket.destroy(); }, 1000).unref?.();
    });
  }
}

let singleton;
function getRedisClient() {
  if (singleton !== undefined) return singleton;
  const raw = String(process.env.REDIS_URL || "").trim();
  singleton = raw ? new RedisClient(raw) : null;
  if (singleton) {
    let lastMessage = "";
    let lastLoggedAt = 0;
    singleton.on("error", (err) => {
      const message = String(err?.message || err);
      const now = Date.now();
      if (message === lastMessage && now - lastLoggedAt < 5000) return;
      lastMessage = message;
      lastLoggedAt = now;
      console.error("Redis error:", message);
    });
  }
  return singleton;
}

async function connectRedis() {
  const client = getRedisClient();
  if (!client) return null;
  await client.connect();
  return client;
}

async function closeRedis() {
  if (singleton) await singleton.close();
}

function resetRedisClientForTests() { singleton = undefined; }

module.exports = {
  parseRedisUrl,
  encodeCommand,
  parseReply,
  RedisClient,
  getRedisClient,
  connectRedis,
  closeRedis,
  resetRedisClientForTests,
};

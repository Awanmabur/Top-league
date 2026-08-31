const crypto = require("crypto");
const { google } = require("googleapis");
const { platformConnection } = require("../config/db");
const PlatformIntegrationCredential = require("../models/platform/PlatformIntegrationCredential")(platformConnection);
const { encryptCredential, decryptCredential } = require("./tenant/integrationService");

const PROVIDER = "google_calendar";
const OAUTH_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
]);
const SERVICE_ACCOUNT_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
]);
// Backward-compatible export name used by the OAuth migration/tests.
const SCOPES = OAUTH_SCOPES;
const CACHE_TTL_MS = 60 * 1000;

let cachedCredential = null;
let cachedUntil = 0;
let cachedCalendarClient = null;
let cachedCalendarCredentialId = "";
let cachedCalendarRefreshToken = "";
let lastSuccessWriteAt = 0;

function str(value) {
  return String(value ?? "").trim();
}

function authMode() {
  const mode = str(process.env.GOOGLE_CALENDAR_AUTH_MODE).toLowerCase();
  return mode === "service_account" ? "service_account" : "oauth";
}

function oauthConfigured() {
  return Boolean(
    str(process.env.GOOGLE_OAUTH_CLIENT_ID)
    && str(process.env.GOOGLE_OAUTH_CLIENT_SECRET)
    && str(process.env.GOOGLE_OAUTH_REDIRECT_URI),
  );
}

function decodeServiceAccountPrivateKey() {
  const encoded = str(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64);
  if (!encoded || encoded.length > 32768 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) {
    const err = new Error("Google Calendar service-account private key is not configured correctly.");
    err.code = "GOOGLE_SERVICE_ACCOUNT_NOT_CONFIGURED";
    throw err;
  }
  let pem = "";
  try {
    pem = Buffer.from(encoded, "base64").toString("utf8").trim();
  } catch (_) {}
  if (
    pem.length < 256
    || pem.length > 20000
    || !/^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----$/.test(pem)
  ) {
    const err = new Error("Google Calendar service-account private key is invalid.");
    err.code = "GOOGLE_SERVICE_ACCOUNT_NOT_CONFIGURED";
    throw err;
  }
  return pem;
}

function serviceAccountConfigured() {
  const email = str(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL).toLowerCase();
  const subject = str(process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT).toLowerCase();
  const calendarId = str(process.env.GOOGLE_CALENDAR_ID);
  const encoded = str(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64);
  return Boolean(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)
    && calendarId
    && encoded,
  );
}

function configured() {
  return authMode() === "service_account" ? serviceAccountConfigured() : oauthConfigured();
}

function oauthClient() {
  if (!oauthConfigured()) {
    const err = new Error("Google Calendar OAuth client is not configured.");
    err.code = "GOOGLE_OAUTH_NOT_CONFIGURED";
    throw err;
  }
  return new google.auth.OAuth2(
    str(process.env.GOOGLE_OAUTH_CLIENT_ID),
    str(process.env.GOOGLE_OAUTH_CLIENT_SECRET),
    str(process.env.GOOGLE_OAUTH_REDIRECT_URI),
  );
}

function serviceAccountAuth() {
  if (!serviceAccountConfigured()) {
    const err = new Error("Google Calendar service account is not fully configured.");
    err.code = "GOOGLE_SERVICE_ACCOUNT_NOT_CONFIGURED";
    throw err;
  }
  return new google.auth.JWT({
    email: str(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    key: decodeServiceAccountPrivateKey(),
    scopes: [...SERVICE_ACCOUNT_SCOPES],
    // Calendar attendees require domain-wide delegation when a service account
    // is used. Impersonating the intended Workspace calendar owner preserves
    // normal organizer/invitation semantics without a user refresh token.
    subject: str(process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT),
  });
}

function sanitizeError(error) {
  const providerCode = str(
    error?.response?.data?.error
    || error?.errors?.[0]?.reason
    || error?.code
    || error?.status,
  ).slice(0, 120);
  const message = str(
    error?.response?.data?.error_description
    || error?.response?.data?.error?.message
    || error?.message
    || "Google Calendar request failed.",
  ).replace(/[\r\n]+/g, " ").slice(0, 300);
  return { providerCode, message };
}

function isInvalidGrant(error) {
  const { providerCode, message } = sanitizeError(error);
  const joined = `${providerCode} ${message}`.toLowerCase();
  return joined.includes("invalid_grant")
    || joined.includes("invalid credentials")
    || joined.includes("token has been expired or revoked")
    || joined.includes("token has been revoked");
}

function clearCredentialCache({ keepClient = false } = {}) {
  cachedCredential = null;
  cachedUntil = 0;
  if (!keepClient) {
    cachedCalendarClient = null;
    cachedCalendarCredentialId = "";
    cachedCalendarRefreshToken = "";
  }
}

async function findCredential({ includeSecret = false } = {}) {
  let query = PlatformIntegrationCredential.findOne({ provider: PROVIDER, isDeleted: { $ne: true } });
  if (includeSecret) {
    query = query.select("+credentialCiphertext +credentialIv +credentialTag +credentialVersion");
  }
  return query.lean();
}

async function importLegacyEnvRefreshToken() {
  const allowLegacyBootstrap = ["1", "true", "yes", "on"].includes(
    str(process.env.GOOGLE_OAUTH_ALLOW_LEGACY_BOOTSTRAP).toLowerCase(),
  );
  if (!allowLegacyBootstrap) return null;
  const legacy = str(process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
  if (!legacy) return null;

  const existing = await findCredential({ includeSecret: true });
  if (existing) return existing;

  const encrypted = encryptCredential(legacy);
  try {
    await PlatformIntegrationCredential.create({
      provider: PROVIDER,
      status: "connected",
      ...encrypted,
      scopes: [...SCOPES],
      calendarId: str(process.env.GOOGLE_CALENDAR_ID) || "primary",
      source: "legacy_env",
      connectedAt: new Date(),
      revision: 1,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  clearCredentialCache();
  return findCredential({ includeSecret: true });
}

async function loadConnectedCredential() {
  const now = Date.now();
  if (cachedCredential && cachedUntil > now) return cachedCredential;

  let row = await findCredential({ includeSecret: true });
  if (!row) row = await importLegacyEnvRefreshToken();

  if (!row || row.status !== "connected" || row.source === "service_account") {
    const err = new Error("Google Calendar must be reconnected by a Super Admin.");
    err.code = "GOOGLE_CALENDAR_RECONNECT_REQUIRED";
    throw err;
  }

  let refreshToken = "";
  try {
    refreshToken = decryptCredential(row);
  } catch (error) {
    await PlatformIntegrationCredential.updateOne(
      { _id: row._id, status: "connected" },
      {
        $set: {
          status: "reconnect_required",
          lastFailureAt: new Date(),
          lastErrorCode: "credential_decrypt_failed",
          lastErrorMessage: "Stored Google credential could not be decrypted.",
        },
        $inc: { revision: 1 },
      },
    ).catch(() => {});
    clearCredentialCache();
    const err = new Error("Google Calendar must be reconnected by a Super Admin.");
    err.code = "GOOGLE_CALENDAR_RECONNECT_REQUIRED";
    throw err;
  }

  if (!refreshToken) {
    const err = new Error("Google Calendar must be reconnected by a Super Admin.");
    err.code = "GOOGLE_CALENDAR_RECONNECT_REQUIRED";
    throw err;
  }

  cachedCredential = { ...row, refreshToken };
  cachedUntil = now + CACHE_TTL_MS;
  return cachedCredential;
}

async function persistRotatedRefreshToken(refreshToken, credentialId) {
  const value = str(refreshToken);
  if (!value || !credentialId) return;
  const encrypted = encryptCredential(value);
  await PlatformIntegrationCredential.updateOne(
    { _id: credentialId, provider: PROVIDER, isDeleted: { $ne: true } },
    { $set: { ...encrypted, source: "oauth", status: "connected" }, $inc: { revision: 1 } },
  ).catch((error) => console.error("Google refresh-token rotation persistence failed:", error?.message || error));

  // Google occasionally rotates refresh tokens. Keep the already-authorized
  // OAuth client (and its cached access token) alive while updating the durable
  // encrypted credential and in-memory credential snapshot.
  if (cachedCredential && String(cachedCredential._id) === String(credentialId)) {
    cachedCredential = { ...cachedCredential, refreshToken: value };
    cachedUntil = Date.now() + CACHE_TTL_MS;
  }
  if (cachedCalendarCredentialId === String(credentialId)) {
    cachedCalendarRefreshToken = value;
  }
}

async function getCalendarClient() {
  if (authMode() === "service_account") {
    if (!serviceAccountConfigured()) {
      const err = new Error("Google Calendar service account is not fully configured.");
      err.code = "GOOGLE_SERVICE_ACCOUNT_NOT_CONFIGURED";
      throw err;
    }
    const calendarId = str(process.env.GOOGLE_CALENDAR_ID);
    const identity = crypto.createHash("sha256").update([
      str(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
      str(process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT),
      calendarId,
      str(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64),
    ].join("\n")).digest("hex").slice(0, 24);
    const cacheKey = `service:${identity}`;
    if (cachedCalendarClient && cachedCalendarCredentialId === cacheKey) return cachedCalendarClient;

    const auth = serviceAccountAuth();
    cachedCalendarClient = {
      calendar: google.calendar({ version: "v3", auth }),
      auth,
      credentialId: null,
      calendarId,
      authMode: "service_account",
    };
    cachedCalendarCredentialId = cacheKey;
    cachedCalendarRefreshToken = "";
    return cachedCalendarClient;
  }

  const credential = await loadConnectedCredential();
  const credentialId = String(credential._id || "");
  if (
    cachedCalendarClient
    && cachedCalendarCredentialId === credentialId
    && cachedCalendarRefreshToken === credential.refreshToken
  ) {
    return cachedCalendarClient;
  }

  const auth = oauthClient();
  auth.eagerRefreshThresholdMillis = 5 * 60 * 1000;
  auth.setCredentials({ refresh_token: credential.refreshToken });
  auth.on("tokens", (tokens) => {
    if (tokens?.refresh_token) {
      persistRotatedRefreshToken(tokens.refresh_token, credential._id).catch(() => {});
    }
  });
  cachedCalendarClient = {
    calendar: google.calendar({ version: "v3", auth }),
    auth,
    credentialId: credential._id,
    calendarId: credential.calendarId || str(process.env.GOOGLE_CALENDAR_ID) || "primary",
    authMode: "oauth",
  };
  cachedCalendarCredentialId = credentialId;
  cachedCalendarRefreshToken = credential.refreshToken;
  return cachedCalendarClient;
}

async function markSuccess(credentialId = null) {
  const now = Date.now();
  if (now - lastSuccessWriteAt < 60 * 1000) return;
  lastSuccessWriteAt = now;

  if (authMode() === "service_account") {
    await PlatformIntegrationCredential.findOneAndUpdate(
      { provider: PROVIDER },
      {
        $set: {
          status: "connected",
          scopes: [...SERVICE_ACCOUNT_SCOPES],
          calendarId: str(process.env.GOOGLE_CALENDAR_ID),
          source: "service_account",
          credentialCiphertext: "",
          credentialIv: "",
          credentialTag: "",
          lastSuccessAt: new Date(now),
          lastValidatedAt: new Date(now),
          lastErrorCode: "",
          lastErrorMessage: "",
          isDeleted: false,
        },
        $setOnInsert: { connectedAt: new Date(now) },
        $inc: { revision: 1 },
      },
      { upsert: true, new: false, setDefaultsOnInsert: false },
    ).catch(() => {});
    return;
  }

  const filter = credentialId
    ? { _id: credentialId, provider: PROVIDER, status: "connected", isDeleted: { $ne: true } }
    : { provider: PROVIDER, status: "connected", isDeleted: { $ne: true } };
  await PlatformIntegrationCredential.updateOne(
    filter,
    {
      $set: {
        lastSuccessAt: new Date(now),
        lastValidatedAt: new Date(now),
        lastErrorCode: "",
        lastErrorMessage: "",
      },
    },
  ).catch(() => {});
}

async function markFailure(error, credentialId = null) {
  const { providerCode, message } = sanitizeError(error);
  const serviceMode = authMode() === "service_account";
  const invalidGrant = !serviceMode && isInvalidGrant(error);
  const filter = credentialId
    ? { _id: credentialId, provider: PROVIDER, isDeleted: { $ne: true } }
    : { provider: PROVIDER, isDeleted: { $ne: true } };
  const set = {
    lastFailureAt: new Date(),
    lastErrorCode: providerCode || (invalidGrant ? "invalid_grant" : "google_error"),
    lastErrorMessage: message,
  };
  if (invalidGrant || serviceMode) set.status = "reconnect_required";
  const update = (invalidGrant || serviceMode) ? { $set: set, $inc: { revision: 1 } } : { $set: set };
  if (serviceMode) {
    update.$set.source = "service_account";
    update.$set.scopes = [...SERVICE_ACCOUNT_SCOPES];
    update.$set.calendarId = str(process.env.GOOGLE_CALENDAR_ID);
    update.$set.isDeleted = false;
    await PlatformIntegrationCredential.findOneAndUpdate(
      { provider: PROVIDER },
      update,
      { upsert: true, new: false, setDefaultsOnInsert: false },
    ).catch(() => {});
  } else {
    await PlatformIntegrationCredential.updateOne(filter, update).catch(() => {});
  }
  if (invalidGrant) clearCredentialCache();
  return invalidGrant;
}

async function normalizeCalendarError(error, credentialId = null) {
  if (authMode() === "service_account") {
    await markFailure(error, credentialId);
    const wrapped = new Error("Google Calendar service-account authorization is unavailable. Check Workspace delegation and the booking calendar configuration.");
    wrapped.code = "GOOGLE_CALENDAR_SERVICE_ACCOUNT_ERROR";
    wrapped.cause = error;
    return wrapped;
  }
  const invalidGrant = await markFailure(error, credentialId);
  if (invalidGrant) {
    const wrapped = new Error("Google Calendar authorization expired or was revoked. A Super Admin must reconnect it.");
    wrapped.code = "GOOGLE_CALENDAR_RECONNECT_REQUIRED";
    wrapped.cause = error;
    return wrapped;
  }
  return error;
}

async function executeCalendar(work) {
  const client = await getCalendarClient();
  try {
    const result = await work(client.calendar, client);
    await markSuccess(client.credentialId);
    return result;
  } catch (error) {
    throw await normalizeCalendarError(error, client.credentialId);
  }
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createAuthorizationState() {
  const state = base64Url(crypto.randomBytes(32));
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { state, verifier, challenge, expiresAt: Date.now() + 10 * 60 * 1000 };
}

function authorizationUrl({ state, challenge }) {
  if (authMode() !== "oauth") {
    const err = new Error("Google Calendar is configured for service-account authentication; OAuth connect is disabled.");
    err.code = "GOOGLE_OAUTH_DISABLED";
    throw err;
  }
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [...SCOPES],
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
}

function safeStateEqual(left, right) {
  const a = Buffer.from(str(left));
  const b = Buffer.from(str(right));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function completeAuthorization({ code, verifier, actorId = null }) {
  if (authMode() !== "oauth") {
    const err = new Error("OAuth callback is disabled while Google Calendar uses service-account authentication.");
    err.code = "GOOGLE_OAUTH_DISABLED";
    throw err;
  }
  if (!str(code) || !str(verifier)) throw new Error("Google authorization response is incomplete.");
  const previous = await findCredential({ includeSecret: true });
  let previousRefreshToken = "";
  if (previous) {
    try { previousRefreshToken = decryptCredential(previous); } catch (_) {}
  }

  const auth = oauthClient();
  const { tokens } = await auth.getToken({ code: str(code), codeVerifier: str(verifier) });
  const refreshToken = str(tokens?.refresh_token);
  if (!refreshToken) {
    const err = new Error("Google did not return a refresh token. Reconnect and grant Calendar access again.");
    err.code = "GOOGLE_REFRESH_TOKEN_MISSING";
    throw err;
  }
  auth.setCredentials(tokens);

  // Google granular consent can return only a subset of requested scopes.
  // Verify the actual access token before storing a long-lived credential.
  const tokenInfo = await auth.getTokenInfo(tokens.access_token);
  const grantedScopes = Array.isArray(tokenInfo?.scopes) ? tokenInfo.scopes.map(str).filter(Boolean) : [];
  const missingScopes = SCOPES.filter((scope) => !grantedScopes.includes(scope));
  if (missingScopes.length) {
    try { await auth.revokeToken(refreshToken); } catch (_) {}
    const err = new Error("Google Calendar permission was only partially granted. Reconnect and approve all requested Calendar permissions.");
    err.code = "GOOGLE_CALENDAR_SCOPE_MISSING";
    throw err;
  }

  const calendarId = str(process.env.GOOGLE_CALENDAR_ID) || "primary";
  const calendar = google.calendar({ version: "v3", auth });
  const now = new Date();
  const shortlyAfter = new Date(now.getTime() + 60 * 1000);
  await calendar.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: shortlyAfter.toISOString(),
      items: [{ id: calendarId }],
    },
  });

  const encrypted = encryptCredential(refreshToken);
  const update = {
    status: "connected",
    ...encrypted,
    scopes: grantedScopes,
    calendarId,
    source: "oauth",
    connectedAt: now,
    disconnectedAt: null,
    lastValidatedAt: now,
    lastSuccessAt: now,
    lastFailureAt: null,
    lastErrorCode: "",
    lastErrorMessage: "",
    connectedBy: actorId || null,
    updatedBy: actorId || null,
    isDeleted: false,
  };

  await PlatformIntegrationCredential.findOneAndUpdate(
    { provider: PROVIDER },
    { $set: update, $inc: { revision: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: false },
  );
  clearCredentialCache();

  // Retire the superseded credential only after the replacement is durable and
  // validated. This limits credential sprawl and avoids hitting Google's live
  // refresh-token ceiling during repeated operator reconnects.
  if (previousRefreshToken && previousRefreshToken !== refreshToken) {
    try {
      await oauthClient().revokeToken(previousRefreshToken);
    } catch (error) {
      console.warn("Old Google refresh-token revocation failed after successful replacement:", error?.message || error);
    }
  }
  return true;
}

async function disconnect({ actorId = null } = {}) {
  if (authMode() === "service_account") {
    const err = new Error("Service-account credentials are deployment secrets. Rotate or remove them in the production environment instead of disconnecting them from the browser.");
    err.code = "GOOGLE_SERVICE_ACCOUNT_MANAGED_EXTERNALLY";
    throw err;
  }
  const row = await findCredential({ includeSecret: true });
  if (!row) return false;
  let refreshToken = "";
  try { refreshToken = decryptCredential(row); } catch (_) {}
  if (refreshToken && oauthConfigured()) {
    try {
      await oauthClient().revokeToken(refreshToken);
    } catch (error) {
      console.warn("Google token revocation request failed; local credential is still being removed:", error?.message || error);
    }
  }

  await PlatformIntegrationCredential.updateOne(
    { _id: row._id },
    {
      $set: {
        status: "disconnected",
        credentialCiphertext: "",
        credentialIv: "",
        credentialTag: "",
        disconnectedAt: new Date(),
        updatedBy: actorId || null,
        lastErrorCode: "",
        lastErrorMessage: "",
      },
      $inc: { revision: 1 },
    },
  );
  clearCredentialCache();
  return true;
}

async function testConnection() {
  return executeCalendar(async (calendar, client) => {
    const now = new Date();
    const later = new Date(now.getTime() + 60 * 1000);
    await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: later.toISOString(),
        items: [{ id: client.calendarId }],
      },
    });
    return true;
  });
}

async function connectionStatus() {
  const row = await findCredential();
  const mode = authMode();
  const consentStatus = str(process.env.GOOGLE_OAUTH_CONSENT_STATUS).toLowerCase() || "unknown";
  const serviceMode = mode === "service_account";
  const isConfigured = configured();
  const rowMatchesMode = serviceMode ? row?.source === "service_account" : row?.source !== "service_account";
  const effectiveRow = rowMatchesMode ? row : null;
  return {
    authMode: mode,
    configured: isConfigured,
    consentStatus: serviceMode ? "not_applicable" : consentStatus,
    durableConsent: serviceMode || consentStatus === "production" || consentStatus === "internal",
    connected: effectiveRow?.status === "connected",
    status: effectiveRow?.status || (isConfigured && serviceMode ? "configured" : "disconnected"),
    source: serviceMode ? "service_account" : (effectiveRow?.source || ""),
    calendarId: serviceMode
      ? str(process.env.GOOGLE_CALENDAR_ID)
      : (effectiveRow?.calendarId || str(process.env.GOOGLE_CALENDAR_ID) || "primary"),
    scopes: serviceMode ? [...SERVICE_ACCOUNT_SCOPES] : (Array.isArray(effectiveRow?.scopes) ? effectiveRow.scopes : []),
    connectedAt: effectiveRow?.connectedAt || null,
    lastValidatedAt: effectiveRow?.lastValidatedAt || null,
    lastSuccessAt: effectiveRow?.lastSuccessAt || null,
    lastFailureAt: effectiveRow?.lastFailureAt || null,
    lastErrorCode: effectiveRow?.lastErrorCode || "",
    lastErrorMessage: effectiveRow?.lastErrorMessage || "",
    serviceAccountEmail: serviceMode ? str(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) : "",
    delegatedSubject: serviceMode ? str(process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT) : "",
  };
}

module.exports = {
  PROVIDER,
  SCOPES,
  OAUTH_SCOPES,
  SERVICE_ACCOUNT_SCOPES,
  authMode,
  configured,
  oauthConfigured,
  serviceAccountConfigured,
  oauthClient,
  serviceAccountAuth,
  sanitizeError,
  isInvalidGrant,
  getCalendarClient,
  executeCalendar,
  createAuthorizationState,
  authorizationUrl,
  safeStateEqual,
  completeAuthorization,
  disconnect,
  testConnection,
  connectionStatus,
  markSuccess,
  markFailure,
  normalizeCalendarError,
  clearCredentialCache,
};

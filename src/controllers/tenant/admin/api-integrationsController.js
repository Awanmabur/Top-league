const mongoose = require("mongoose");
const {
  encryptCredential,
  maskCredential,
  normalizeBaseUrl,
  buildProbeUrl,
  assertSafeHost,
  probeIntegration,
  escapeRegex,
  nextAverage,
} = require("../../../services/tenant/integrationService");

const TYPES = new Set(["Payments", "Messaging", "Storage", "Authentication", "Analytics", "Custom"]);
const AUTH_TYPES = new Set(["API Key", "Bearer Token", "Basic Auth", "OAuth2", "None"]);
const STATUSES = new Set(["Active", "Disabled"]);
const METHODS = new Set(["HEAD", "GET"]);
function actorUserId(req) { return req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null; }
function str(v) { return String(v ?? "").trim(); }
function validId(v) { return mongoose.Types.ObjectId.isValid(String(v || "")); }
function fmt(v) { if (!v) return "—"; const d = new Date(v); return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 16).replace("T", " "); }
function csvCell(v) { let s = String(v ?? "").replace(/\r?\n/g, " "); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; }
function avgLabel(ms, requests) { return Number(requests || 0) ? `${Math.round(Number(ms || 0))} ms` : "—"; }
function hasCredential(row) { return !!row?.credentialCiphertext; }
function needsCredential(authType) { return authType !== "None"; }
function ensureEditable(row) { if (row?.migrationQuarantinedAt) throw new Error("This integration is quarantined by migration and cannot be enabled or tested. Delete it or repair it through a controlled migration."); }
function requestLog(row, result) {
  return {
    endpoint: result.endpoint || row.endpoint || "/",
    method: result.method || row.testMethod || "HEAD",
    status: result.ok ? "Success" : "Failed",
    statusCode: Number(result.statusCode || 0),
    responseTimeMs: Number(result.elapsedMs || 0),
    message: str(result.message).slice(0, 220),
    createdAt: new Date(),
  };
}
function serializeIntegration(doc) {
  const requests = Number(doc.metrics?.requests || 0);
  const success = Number(doc.metrics?.success || 0);
  const failures = Number(doc.metrics?.failures || 0);
  const quarantined = !!doc.migrationQuarantinedAt;
  return {
    id: String(doc._id),
    revision: Number(doc.revision || 0),
    name: doc.name || "",
    type: doc.type || "Custom",
    provider: doc.provider || "",
    baseUrl: doc.baseUrl || "",
    status: quarantined ? "Error" : (doc.status || "Disabled"),
    storedStatus: doc.status || "Disabled",
    authType: doc.authType || "None",
    endpoint: doc.endpoint || "/",
    testMethod: doc.testMethod || "HEAD",
    lastTestAt: fmt(doc.lastTestAt),
    lastTestStatus: doc.lastTestStatus || "Never",
    lastStatusCode: Number(doc.lastStatusCode || 0),
    credentialConfigured: hasCredential(doc),
    credentialMasked: maskCredential(doc),
    notes: doc.notes || "",
    quarantined,
    quarantineReason: quarantined ? (doc.migrationQuarantineReason || "Migration quarantine") : "",
    metrics: {
      requests,
      success,
      failures,
      successRate: requests ? `${Math.round((success / requests) * 100)}%` : "0%",
      avgResponse: avgLabel(doc.metrics?.avgResponseMs, requests),
    },
    metaPretty: JSON.stringify({
      provider: doc.provider || "",
      baseUrl: doc.baseUrl || "",
      endpoint: doc.endpoint || "/",
      method: doc.testMethod || "HEAD",
      authType: doc.authType || "None",
      credential: hasCredential(doc) ? "Configured" : "Not configured",
      lastTestStatus: doc.lastTestStatus || "Never",
      lastStatusCode: Number(doc.lastStatusCode || 0) || null,
      quarantine: quarantined ? (doc.migrationQuarantineReason || "Migration quarantine") : null,
      notes: doc.notes || "",
    }, null, 2),
  };
}
function flattenLogs(docs, cap = 2000) {
  const items = [];
  for (const doc of docs) {
    for (const log of (doc.requestLogs || [])) {
      items.push({
        integrationName: doc.name || "",
        endpoint: log.endpoint || doc.endpoint || "/",
        method: log.method || "HEAD",
        status: log.status || "Failed",
        statusCode: Number(log.statusCode || 0),
        responseTime: `${Number(log.responseTimeMs || 0)} ms`,
        responseTimeMs: Number(log.responseTimeMs || 0),
        message: log.message || "",
        createdAtRaw: log.createdAt || null,
        createdAt: fmt(log.createdAt),
      });
    }
  }
  return items.sort((a, b) => new Date(b.createdAtRaw || 0) - new Date(a.createdAtRaw || 0)).slice(0, cap);
}
function buildStats(docs) {
  let active = 0, disabled = 0, healthy = 0, errors = 0;
  for (const d of docs) {
    if (d.migrationQuarantinedAt) { errors += 1; continue; }
    if (d.status === "Active") active += 1;
    if (d.status === "Disabled") disabled += 1;
    if (d.status === "Active" && d.lastTestStatus === "Success") healthy += 1;
    if (d.status === "Error" || d.lastTestStatus === "Failed") errors += 1;
  }
  return { active, disabled, healthy, errors };
}
function parsePayload(req) {
  const type = str(req.body.type || "Custom");
  const authType = str(req.body.authType || "None");
  const status = str(req.body.status || "Disabled");
  const testMethod = str(req.body.testMethod || "HEAD").toUpperCase();
  if (!TYPES.has(type)) throw new Error("Invalid integration type.");
  if (!AUTH_TYPES.has(authType)) throw new Error("Invalid authentication type.");
  if (!STATUSES.has(status)) throw new Error("Status must be Active or Disabled.");
  if (!METHODS.has(testMethod)) throw new Error("Test method must be HEAD or GET.");
  const name = str(req.body.name).slice(0, 220);
  const provider = str(req.body.provider).slice(0, 180);
  const base = normalizeBaseUrl(req.body.baseUrl);
  const endpointUrl = buildProbeUrl(base.toString(), req.body.endpoint || "/");
  if (!name) throw new Error("Integration name is required.");
  return {
    name, type, provider,
    baseUrl: base.origin + (base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "")),
    authType, status,
    endpoint: `${endpointUrl.pathname}${endpointUrl.search}`.slice(0, 500) || "/",
    testMethod,
    notes: str(req.body.notes).slice(0, 1200),
  };
}
async function loadSecretRow(ApiIntegration, id) {
  return ApiIntegration.findOne({ _id: id, isDeleted: { $ne: true } }).select("+credentialCiphertext +credentialIv +credentialTag +credentialVersion +apiKey");
}
async function assertEnableSafe(row) {
  ensureEditable(row);
  if (needsCredential(row.authType) && !hasCredential(row)) throw new Error("Configure a credential before enabling this integration.");
  const target = buildProbeUrl(row.baseUrl, row.endpoint);
  await assertSafeHost(target);
}
async function updateProbeMetrics(ApiIntegration, item, result, actor) {
  const requests = Number(item.metrics?.requests || 0);
  let nextStatus = item.status;
  if (item.status === "Active") nextStatus = result.ok ? "Active" : "Error";
  else if (item.status === "Error") nextStatus = result.ok ? "Disabled" : "Error";
  else nextStatus = "Disabled";
  const update = {
    $set: {
      lastTestAt: new Date(),
      lastTestStatus: result.ok ? "Success" : "Failed",
      lastStatusCode: Number(result.statusCode || 0),
      status: nextStatus,
      "metrics.avgResponseMs": nextAverage(item.metrics?.avgResponseMs, requests, result.elapsedMs),
      updatedBy: actor,
    },
    $inc: { "metrics.requests": 1, "metrics.success": result.ok ? 1 : 0, "metrics.failures": result.ok ? 0 : 1, revision: 1 },
    $push: { requestLogs: { $each: [requestLog(item, result)], $slice: -100 } },
  };
  const changed = await ApiIntegration.updateOne({ _id: item._id, isDeleted: { $ne: true }, revision: Number(item.revision || 0) }, update);
  if (Number(changed.modifiedCount || 0) !== 1) throw new Error(`${item.name || "Integration"} changed in another session. Reload and try again.`);
  return result;
}

module.exports = {
  index: async (req, res) => {
    const { ApiIntegration } = req.models;
    const q = str(req.query.q), status = str(req.query.status || "all"), type = str(req.query.type || "all"), provider = str(req.query.provider || "all");
    const query = { isDeleted: { $ne: true } };
    if (q) { const rx = new RegExp(escapeRegex(q), "i"); query.$or = [{ name: rx }, { provider: rx }, { baseUrl: rx }, { type: rx }, { status: rx }]; }
    if (status !== "all" && ["Active", "Disabled", "Error"].includes(status)) query.status = status;
    if (type !== "all" && TYPES.has(type)) query.type = type;
    if (provider !== "all") query.provider = provider;
    const [docs, allDocs] = await Promise.all([
      ApiIntegration.find(query).select("+credentialCiphertext").sort({ createdAt: -1 }).limit(250).lean(),
      ApiIntegration.find({ isDeleted: { $ne: true } }).select("name provider status lastTestStatus migrationQuarantinedAt").sort({ createdAt: -1 }).limit(250).lean(),
    ]);
    return res.render("tenant/api-integrations/index", {
      tenant: req.tenant,
      csrfToken: res.locals.csrfToken || req.csrfToken?.() || "",
      integrations: docs.map(serializeIntegration),
      requestLogs: flattenLogs(docs, 1000),
      stats: buildStats(allDocs),
      filters: { providers: [...new Set(allDocs.map((x) => x.provider).filter(Boolean))].sort() },
      query: { q, status, type, provider },
    });
  },

  save: async (req, res) => {
    const { ApiIntegration } = req.models;
    try {
      const id = str(req.body.integrationId);
      const payload = parsePayload(req);
      const rawCredential = str(req.body.apiKey);
      const actor = actorUserId(req);
      if (id) {
        if (!validId(id)) throw new Error("Invalid integration ID.");
        const item = await loadSecretRow(ApiIntegration, id);
        if (!item) throw new Error("Integration not found.");
        ensureEditable(item);
        const clientRevision = Number(req.body.integrationRevision);
        if (!Number.isInteger(clientRevision) || clientRevision !== Number(item.revision || 0)) throw new Error("Integration changed in another session. Reload and try again.");
        const secretSet = {};
        if (payload.authType === "None") Object.assign(secretSet, encryptCredential(""), { apiKey: "" });
        else if (rawCredential) Object.assign(secretSet, encryptCredential(rawCredential), { apiKey: "" });
        else if (!hasCredential(item)) throw new Error("A credential is required for this authentication type.");
        const candidate = { ...item.toObject(), ...payload, ...secretSet };
        if (payload.status === "Active") await assertEnableSafe(candidate);
        const changed = await ApiIntegration.updateOne(
          { _id: item._id, isDeleted: { $ne: true }, revision: clientRevision },
          { $set: { ...payload, ...secretSet, updatedBy: actor }, $inc: { revision: 1 }, $unset: { apiKey: "" } },
        );
        if (Number(changed.modifiedCount || 0) !== 1) throw new Error("Integration changed in another session. Reload and try again.");
        req.flash?.("success", "Integration updated successfully.");
      } else {
        let secretSet = encryptCredential("");
        if (payload.authType !== "None") {
          if (!rawCredential) throw new Error("A credential is required for this authentication type.");
          secretSet = encryptCredential(rawCredential);
        }
        const candidate = { ...payload, ...secretSet };
        if (payload.status === "Active") await assertEnableSafe(candidate);
        await ApiIntegration.create({ ...payload, ...secretSet, apiKey: "", metrics: { requests: 0, success: 0, failures: 0, avgResponseMs: 0 }, requestLogs: [], revision: 0, createdBy: actor, updatedBy: actor });
        req.flash?.("success", "Integration created successfully.");
      }
    } catch (err) { req.flash?.("error", err?.code === 11000 ? "An active integration with that name already exists." : (err.message || "Could not save integration.")); }
    return res.redirect("/admin/integrations");
  },

  toggle: async (req, res) => {
    const { ApiIntegration } = req.models;
    try {
      if (!validId(req.params.id)) throw new Error("Invalid integration ID.");
      const item = await loadSecretRow(ApiIntegration, req.params.id);
      if (!item) throw new Error("Integration not found.");
      ensureEditable(item);
      const next = item.status === "Active" ? "Disabled" : "Active";
      if (next === "Active") await assertEnableSafe(item);
      const changed = await ApiIntegration.updateOne({ _id: item._id, isDeleted: { $ne: true }, revision: Number(item.revision || 0) }, { $set: { status: next, updatedBy: actorUserId(req) }, $inc: { revision: 1 } });
      if (Number(changed.modifiedCount || 0) !== 1) throw new Error("Integration changed in another session. Reload and try again.");
      req.flash?.("success", `Integration ${next === "Active" ? "enabled" : "disabled"}.`);
    } catch (err) { req.flash?.("error", err.message); }
    return res.redirect("/admin/integrations");
  },

  test: async (req, res) => {
    const { ApiIntegration } = req.models;
    try {
      if (!validId(req.params.id)) throw new Error("Invalid integration ID.");
      const item = await loadSecretRow(ApiIntegration, req.params.id);
      if (!item) throw new Error("Integration not found.");
      ensureEditable(item);
      if (needsCredential(item.authType) && !hasCredential(item)) throw new Error("Configure a credential before testing this integration.");
      const result = await probeIntegration(item);
      await updateProbeMetrics(ApiIntegration, item, result, actorUserId(req));
      req.flash?.(result.ok ? "success" : "error", result.ok ? `Integration probe succeeded (${result.statusCode}).` : `Integration probe failed: ${result.message}`);
    } catch (err) { req.flash?.("error", err.message || "Integration probe failed."); }
    return res.redirect("/admin/integrations");
  },

  delete: async (req, res) => {
    const { ApiIntegration } = req.models;
    try {
      if (!validId(req.params.id)) throw new Error("Invalid integration ID.");
      const item = await ApiIntegration.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!item) throw new Error("Integration not found.");
      if (!item.migrationQuarantinedAt && item.status !== "Disabled") throw new Error("Disable the integration before deleting it.");
      const changed = await ApiIntegration.updateOne({ _id: item._id, isDeleted: { $ne: true }, revision: Number(item.revision || 0) }, { $set: { isDeleted: true, deletedAt: new Date(), status: "Disabled", updatedBy: actorUserId(req) }, $inc: { revision: 1 } });
      if (Number(changed.modifiedCount || 0) !== 1) throw new Error("Integration changed in another session. Reload and try again.");
      req.flash?.("success", "Integration archived.");
    } catch (err) { req.flash?.("error", err.message); }
    return res.redirect("/admin/integrations");
  },

  bulkAction: async (req, res) => {
    const { ApiIntegration } = req.models;
    const ids = str(req.body.ids).split(",").map((x) => x.trim()).filter(validId);
    const action = str(req.body.action);
    if (!ids.length) return res.redirect("/admin/integrations");
    if (ids.length > 50) { req.flash?.("error", "Bulk integration actions are limited to 50 rows."); return res.redirect("/admin/integrations"); }
    if (!["enable", "disable", "test"].includes(action)) return res.status(400).send("Invalid bulk action");
    try {
      const items = await ApiIntegration.find({ _id: { $in: ids }, isDeleted: { $ne: true } }).select("+credentialCiphertext +credentialIv +credentialTag +credentialVersion +apiKey");
      if (items.length !== ids.length) throw new Error("One or more integrations no longer exist. Reload and try again.");
      if (action === "test") {
        let success = 0, failed = 0;
        for (const item of items) {
          try {
            ensureEditable(item);
            if (needsCredential(item.authType) && !hasCredential(item)) throw new Error("Credential is not configured.");
            const result = await probeIntegration(item);
            await updateProbeMetrics(ApiIntegration, item, result, actorUserId(req));
            if (result.ok) success += 1; else failed += 1;
          } catch (_) { failed += 1; }
        }
        req.flash?.(failed ? "error" : "success", `Bulk probe finished: ${success} succeeded, ${failed} failed.`);
      } else {
        const target = action === "enable" ? "Active" : "Disabled";
        for (const item of items) if (target === "Active") await assertEnableSafe(item);
        const applied = [];
        try {
          for (const item of items) {
            const before = item.status;
            const changed = await ApiIntegration.updateOne({ _id: item._id, isDeleted: { $ne: true }, revision: Number(item.revision || 0) }, { $set: { status: target, updatedBy: actorUserId(req) }, $inc: { revision: 1 } });
            if (Number(changed.modifiedCount || 0) !== 1) throw new Error(`${item.name} changed in another session.`);
            applied.push({ item, before });
          }
        } catch (err) {
          for (const row of applied.reverse()) await ApiIntegration.updateOne({ _id: row.item._id, status: target }, { $set: { status: row.before }, $inc: { revision: 1 } }).catch(() => {});
          throw err;
        }
        req.flash?.("success", `${items.length} integration(s) ${target === "Active" ? "enabled" : "disabled"}.`);
      }
    } catch (err) { req.flash?.("error", err.message); }
    return res.redirect("/admin/integrations");
  },

  exportLogs: async (req, res) => {
    const { ApiIntegration } = req.models;
    const docs = await ApiIntegration.find({ isDeleted: { $ne: true } }).select("name endpoint requestLogs").sort({ createdAt: -1 }).limit(250).lean();
    const rows = flattenLogs(docs, 10000);
    const lines = [["Integration", "Endpoint", "Method", "Status", "HTTP Status", "Response Time (ms)", "Message", "Created At"].map(csvCell).join(",")];
    for (const row of rows) lines.push([row.integrationName, row.endpoint, row.method, row.status, row.statusCode, row.responseTimeMs, row.message, row.createdAt].map(csvCell).join(","));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="integration-request-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\uFEFF${lines.join("\r\n")}`);
  },
};

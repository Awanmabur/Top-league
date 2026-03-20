const mongoose = require("mongoose");

const str = (v) => String(v ?? "").trim();

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function pretty(obj) {
  try {
    return JSON.stringify(obj || {}, null, 2);
  } catch (_) {
    return "{}";
  }
}

function formatDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function serializeLog(doc) {
  return {
    id: String(doc._id),
    actor: doc.actorName || "System",
    actorEmail: doc.actorEmail || "",
    action: doc.action || "",
    module: doc.module || "",
    entityType: doc.entityType || "",
    entityId: doc.entityId ? String(doc.entityId) : "",
    entityLabel: doc.entityLabel || "",
    severity: doc.severity || "Info",
    ipAddress: doc.ipAddress || "",
    source: doc.source || "",
    createdAt: formatDateTime(doc.createdAt),
    metadataPretty: pretty(doc.metadata),
    diffPretty: pretty({
      before: doc.before || null,
      after: doc.after || null,
    }),
  };
}

function buildStats(logs) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const actors = new Set();
  const modules = new Set();

  let today = 0;
  let critical = 0;

  logs.forEach((l) => {
    if (l.createdAt && l.createdAt.slice(0, 10) === todayStr) today += 1;
    if (l.severity === "Critical") critical += 1;
    if (l.actor) actors.add(l.actor);
    if (l.module) modules.add(l.module);
  });

  return {
    today,
    critical,
    actors: actors.size,
    modules: modules.size,
  };
}

function buildAnalytics(logs) {
  const bucket = new Map();

  logs.forEach((log) => {
    const key = log.module || "General";
    if (!bucket.has(key)) {
      bucket.set(key, {
        module: key,
        total: 0,
        critical: 0,
        warnings: 0,
        actors: new Set(),
        latest: "—",
        latestDate: null,
      });
    }

    const row = bucket.get(key);
    row.total += 1;
    if (log.severity === "Critical") row.critical += 1;
    if (log.severity === "Warning") row.warnings += 1;
    if (log.actor) row.actors.add(log.actor);

    const d = log.createdAt && log.createdAt !== "—" ? new Date(log.createdAt.replace(" ", "T")) : null;
    if (d && !Number.isNaN(d.getTime()) && (!row.latestDate || d > row.latestDate)) {
      row.latestDate = d;
      row.latest = log.createdAt;
    }
  });

  return Array.from(bucket.values()).map((row) => ({
    module: row.module,
    total: row.total,
    critical: row.critical,
    warnings: row.warnings,
    actors: row.actors.size,
    latest: row.latest,
  }));
}

module.exports = {
  index: async (req, res) => {
    const { AuditLog } = req.models;

    const q = str(req.query.q);
    const action = str(req.query.action || "all");
    const moduleName = str(req.query.module || "all");
    const status = str(req.query.status || "all");
    const from = str(req.query.from || "");
    const to = str(req.query.to || "");

    const query = { isDeleted: { $ne: true } };

    if (q) {
      query.$or = [
        { actorName: new RegExp(q, "i") },
        { actorEmail: new RegExp(q, "i") },
        { action: new RegExp(q, "i") },
        { module: new RegExp(q, "i") },
        { entityType: new RegExp(q, "i") },
        { entityLabel: new RegExp(q, "i") },
        { source: new RegExp(q, "i") },
      ];
    }

    if (action !== "all") query.action = action;
    if (moduleName !== "all") query.module = moduleName;
    if (status !== "all") query.severity = status;

    const fromDate = asDate(from);
    const toDate = asDate(to);
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = fromDate;
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const docs = await AuditLog.find(query).sort({ createdAt: -1 }).lean();
    const logs = docs.map(serializeLog);

    const allDocs = await AuditLog.find({ isDeleted: { $ne: true } })
      .select("action module")
      .lean();

    const filters = {
      actions: [...new Set(allDocs.map((x) => x.action).filter(Boolean))].sort(),
      modules: [...new Set(allDocs.map((x) => x.module).filter(Boolean))].sort(),
    };

    return res.render("tenant/admin/auditlogs/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      logs,
      analytics: buildAnalytics(logs),
      stats: buildStats(logs),
      filters,
      query: {
        q,
        action,
        module: moduleName,
        status,
        from,
        to,
      },
    });
  },
};
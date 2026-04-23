const mongoose = require("mongoose");

const str = (v) => String(v ?? "").trim();

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const actorObjectId = (req) => {
  const raw = req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
  return raw && mongoose.Types.ObjectId.isValid(String(raw))
    ? new mongoose.Types.ObjectId(String(raw))
    : null;
};

function pretty(obj) {
  try {
    return JSON.stringify(obj || {}, null, 2);
  } catch (_) {
    return "{}";
  }
}

function formatDateTime(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
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
    reviewed: !!doc.reviewed,
    reviewedAt: formatDateTime(doc.reviewedAt),
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
        latest: "-",
        latestDate: null,
      });
    }

    const row = bucket.get(key);
    row.total += 1;
    if (log.severity === "Critical") row.critical += 1;
    if (log.severity === "Warning") row.warnings += 1;
    if (log.actor) row.actors.add(log.actor);

    const d = log.createdAt && log.createdAt !== "-" ? new Date(log.createdAt.replace(" ", "T")) : null;
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

function buildQuery(req) {
  const q = str(req.query.q);
  const action = str(req.query.action || "all");
  const moduleName = str(req.query.module || "all");
  const status = str(req.query.status || "all");
  const reviewed = str(req.query.reviewed || "all");
  const from = str(req.query.from || "");
  const to = str(req.query.to || "");

  const query = { isDeleted: { $ne: true } };

  if (q) {
    const rx = new RegExp(escapeRegExp(q), "i");
    query.$or = [
      { actorName: rx },
      { actorEmail: rx },
      { action: rx },
      { module: rx },
      { entityType: rx },
      { entityLabel: rx },
      { source: rx },
    ];
  }

  if (action !== "all") query.action = action;
  if (moduleName !== "all") query.module = moduleName;
  if (status !== "all") query.severity = status;
  if (reviewed === "yes") query.reviewed = true;
  if (reviewed === "no") query.reviewed = { $ne: true };

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

  return {
    mongo: query,
    clean: {
      q,
      action,
      module: moduleName,
      status,
      reviewed,
      from,
      to,
    },
  };
}

function parseIds(value) {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "");
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => mongoose.Types.ObjectId.isValid(x))
    .map((x) => new mongoose.Types.ObjectId(x));
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  const header = [
    "When",
    "Actor",
    "Actor Email",
    "Action",
    "Module",
    "Entity Type",
    "Entity Label",
    "Severity",
    "Reviewed",
    "IP Address",
    "Source",
  ];

  const lines = rows.map((row) => [
    row.createdAt,
    row.actor,
    row.actorEmail,
    row.action,
    row.module,
    row.entityType,
    row.entityLabel,
    row.severity,
    row.reviewed ? "Yes" : "No",
    row.ipAddress,
    row.source,
  ].map(csvCell).join(","));

  return [header.map(csvCell).join(","), ...lines].join("\n");
}

module.exports = {
  index: async (req, res) => {
    const { AuditLog } = req.models;

    if (!AuditLog) {
      return res.render("tenant/auditlogs/index", {
        tenant: req.tenant,
        csrfToken: req.csrfToken?.(),
        logs: [],
        analytics: [],
        stats: { today: 0, critical: 0, actors: 0, modules: 0 },
        filters: { actions: [], modules: [] },
        query: { q: "", action: "all", module: "all", status: "all", reviewed: "all", from: "", to: "" },
      });
    }

    const { mongo: query, clean } = buildQuery(req);

    const [docs, actions, modules] = await Promise.all([
      AuditLog.find(query).sort({ createdAt: -1 }).limit(500).lean(),
      AuditLog.distinct("action", { isDeleted: { $ne: true } }),
      AuditLog.distinct("module", { isDeleted: { $ne: true } }),
    ]);
    const logs = docs.map(serializeLog);

    const filters = {
      actions: actions.filter(Boolean).sort(),
      modules: modules.filter(Boolean).sort(),
    };

    return res.render("tenant/auditlogs/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      logs,
      analytics: buildAnalytics(logs),
      stats: buildStats(logs),
      filters,
      query: {
        ...clean,
      },
    });
  },

  exportCsv: async (req, res) => {
    const { AuditLog } = req.models;
    if (!AuditLog) return res.status(404).send("Audit log model is not available.");

    const { mongo } = buildQuery(req);
    const ids = parseIds(req.query.ids);
    if (ids.length) mongo._id = { $in: ids };

    const docs = await AuditLog.find(mongo).sort({ createdAt: -1 }).limit(5000).lean();
    const csv = toCsv(docs.map(serializeLog));

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${Date.now()}.csv"`);
    return res.send(csv);
  },

  markReviewed: async (req, res) => {
    const { AuditLog } = req.models;
    if (!AuditLog) return res.status(404).json({ ok: false, message: "Audit log model is not available." });

    const ids = parseIds(req.body.ids);
    const { mongo } = buildQuery(req);
    const filter = ids.length ? { _id: { $in: ids }, isDeleted: { $ne: true } } : mongo;

    const result = await AuditLog.updateMany(filter, {
      $set: {
        reviewed: true,
        reviewedAt: new Date(),
        reviewedBy: actorObjectId(req),
      },
    });

    return res.json({
      ok: true,
      matched: result.matchedCount || result.n || 0,
      modified: result.modifiedCount || result.nModified || 0,
    });
  },
};

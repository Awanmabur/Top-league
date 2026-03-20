const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();

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

function serializeService(doc) {
  return {
    id: String(doc._id),
    serviceName: doc.serviceName || "",
    type: doc.type || "Application",
    region: doc.region || "",
    host: doc.host || "",
    status: doc.status || "Healthy",
    uptime: doc.metrics?.uptime || "—",
    latency: doc.metrics?.latency || "—",
    load: doc.metrics?.load || "—",
    errorRate: doc.metrics?.errorRate || "0%",
    cpu: doc.metrics?.cpu || "—",
    memory: doc.metrics?.memory || "—",
    lastCheckedAt: formatDateTime(doc.lastCheckedAt),
    metaPretty: pretty({
      host: doc.host || "",
      endpoint: doc.endpoint || "",
      notes: doc.notes || "",
      lastIncidentAt: doc.lastIncidentAt || null,
    }),
  };
}

function buildStats(docs) {
  let healthy = 0;
  let warning = 0;
  let critical = 0;
  let uptimeTotal = 0;
  let uptimeCount = 0;

  docs.forEach((d) => {
    if (d.status === "Healthy") healthy += 1;
    if (d.status === "Warning") warning += 1;
    if (d.status === "Critical") critical += 1;

    const up = String(d.metrics?.uptime || "").replace("%", "");
    const num = Number(up);
    if (!Number.isNaN(num)) {
      uptimeTotal += num;
      uptimeCount += 1;
    }
  });

  const uptime = uptimeCount ? `${(uptimeTotal / uptimeCount).toFixed(2)}%` : "0%";

  return { healthy, warning, critical, uptime };
}

function buildIncidents(docs) {
  const items = [];
  docs.forEach((doc) => {
    (doc.incidents || []).forEach((i) => {
      items.push({
        serviceName: doc.serviceName || "",
        actor: i.actorName || "System",
        type: i.type || "Incident",
        status: i.status || "Open",
        note: i.note || "",
        createdAt: formatDateTime(i.createdAt),
      });
    });
  });
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = {
  index: async (req, res) => {
    const { SystemHealth } = req.models;

    const q = str(req.query.q);
    const status = str(req.query.status || "all");
    const type = str(req.query.type || "all");
    const region = str(req.query.region || "all");

    const query = { isDeleted: { $ne: true } };

    if (q) {
      query.$or = [
        { serviceName: new RegExp(q, "i") },
        { host: new RegExp(q, "i") },
        { type: new RegExp(q, "i") },
        { region: new RegExp(q, "i") },
        { status: new RegExp(q, "i") },
      ];
    }

    if (status !== "all") query.status = status;
    if (type !== "all") query.type = type;
    if (region !== "all") query.region = region;

    const docs = await SystemHealth.find(query).sort({ createdAt: -1 }).lean();
    const services = docs.map(serializeService);

    const allDocs = await SystemHealth.find({ isDeleted: { $ne: true } }).select("region").lean();
    const filters = {
      regions: [...new Set(allDocs.map((x) => x.region).filter(Boolean))].sort(),
    };

    return res.render("tenant/admin/system-health/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      services,
      incidents: buildIncidents(docs),
      stats: buildStats(docs),
      filters,
      query: { q, status, type, region },
    });
  },

  create: async (req, res) => {
    const { SystemHealth } = req.models;

    const serviceName = str(req.body.serviceName);
    if (!serviceName) {
      req.flash?.("error", "Service name is required.");
      return res.redirect("/admin/system-health");
    }

    await SystemHealth.create({
      serviceName,
      type: str(req.body.type || "Application"),
      region: str(req.body.region || ""),
      status: str(req.body.status || "Warning"),
      host: "",
      endpoint: "",
      notes: str(req.body.note || ""),
      lastCheckedAt: new Date(),
      metrics: {
        uptime: str(req.body.uptime || "0%"),
        latency: str(req.body.latency || "—"),
        load: "—",
        errorRate: "0%",
        cpu: "—",
        memory: "—",
      },
      incidents: [
        {
          actorUserId: actorUserId(req),
          actorName: req.user?.fullName || req.user?.email || "System",
          type: str(req.body.status) === "Maintenance" ? "Maintenance" : "Incident",
          status: str(req.body.status) === "Healthy" ? "Resolved" : "Open",
          note: str(req.body.note || ""),
          createdAt: new Date(),
        },
      ],
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "System health item saved successfully.");
    return res.redirect("/admin/system-health");
  },

  markHealthy: async (req, res) => {
    const { SystemHealth } = req.models;
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ""))) return res.redirect("/admin/system-health");

    await SystemHealth.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Healthy", lastCheckedAt: new Date(), updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/system-health");
  },

  markMaintenance: async (req, res) => {
    const { SystemHealth } = req.models;
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ""))) return res.redirect("/admin/system-health");

    await SystemHealth.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Maintenance", lastCheckedAt: new Date(), updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/system-health");
  },

  bulkAction: async (req, res) => {
    const { SystemHealth } = req.models;

    const ids = String(req.body.ids || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => mongoose.Types.ObjectId.isValid(x));

    const action = str(req.body.action);
    if (!ids.length || !action) return res.redirect("/admin/system-health");

    const patch = { updatedBy: actorUserId(req), lastCheckedAt: new Date() };

    if (action === "healthy") {
      patch.status = "Healthy";
    } else if (action === "maintenance") {
      patch.status = "Maintenance";
    } else {
      return res.redirect("/admin/system-health");
    }

    await SystemHealth.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    return res.redirect("/admin/system-health");
  },
};
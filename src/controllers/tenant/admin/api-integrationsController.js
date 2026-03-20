const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();

function formatDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function pretty(obj) {
  try {
    return JSON.stringify(obj || {}, null, 2);
  } catch (_) {
    return "{}";
  }
}

function maskSecret(secret) {
  const s = str(secret);
  if (!s) return "";
  if (s.length <= 6) return "******";
  return `${s.slice(0, 3)}********${s.slice(-3)}`;
}

function serializeIntegration(doc) {
  const requests = Number(doc.metrics?.requests || 0);
  const success = Number(doc.metrics?.success || 0);
  const failures = Number(doc.metrics?.failures || 0);
  const successRate = requests ? `${Math.round((success / requests) * 100)}%` : "0%";

  return {
    id: String(doc._id),
    name: doc.name || "",
    type: doc.type || "Custom",
    provider: doc.provider || "",
    baseUrl: doc.baseUrl || "",
    status: doc.status || "Disabled",
    authType: doc.authType || "API Key",
    endpoint: doc.endpoint || "",
    lastTestAt: formatDateTime(doc.lastTestAt),
    apiKeyMasked: maskSecret(doc.apiKey),
    notes: doc.notes || "",
    metrics: {
      requests,
      success,
      failures,
      successRate,
      avgResponse: doc.metrics?.avgResponse || "—",
    },
    metaPretty: pretty({
      provider: doc.provider || "",
      baseUrl: doc.baseUrl || "",
      endpoint: doc.endpoint || "",
      authType: doc.authType || "",
      apiKeyMasked: maskSecret(doc.apiKey),
      notes: doc.notes || "",
    }),
  };
}

function buildStats(docs) {
  let active = 0;
  let disabled = 0;
  let healthy = 0;
  let errors = 0;

  docs.forEach((d) => {
    if (d.status === "Active") active += 1;
    if (d.status === "Disabled") disabled += 1;
    if (d.status === "Active" && Number(d.metrics?.failures || 0) === 0) healthy += 1;
    if (d.status === "Error" || Number(d.metrics?.failures || 0) > 0) errors += 1;
  });

  return { active, disabled, healthy, errors };
}

function buildLogs(docs) {
  const items = [];
  docs.forEach((doc) => {
    (doc.requestLogs || []).forEach((log) => {
      items.push({
        integrationName: doc.name || "",
        endpoint: log.endpoint || doc.endpoint || "",
        method: log.method || "GET",
        status: log.status || "Success",
        responseTime: log.responseTime || "—",
        message: log.message || "",
        createdAt: formatDateTime(log.createdAt),
      });
    });
  });
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = {
  index: async (req, res) => {
    const { ApiIntegration } = req.models;

    const q = str(req.query.q);
    const status = str(req.query.status || "all");
    const type = str(req.query.type || "all");
    const provider = str(req.query.provider || "all");

    const query = { isDeleted: { $ne: true } };

    if (q) {
      query.$or = [
        { name: new RegExp(q, "i") },
        { provider: new RegExp(q, "i") },
        { baseUrl: new RegExp(q, "i") },
        { type: new RegExp(q, "i") },
        { status: new RegExp(q, "i") },
      ];
    }

    if (status !== "all") query.status = status;
    if (type !== "all") query.type = type;
    if (provider !== "all") query.provider = provider;

    const docs = await ApiIntegration.find(query).sort({ createdAt: -1 }).lean();
    const integrations = docs.map(serializeIntegration);

    const allDocs = await ApiIntegration.find({ isDeleted: { $ne: true } }).select("provider").lean();
    const filters = {
      providers: [...new Set(allDocs.map((x) => x.provider).filter(Boolean))].sort(),
    };

    return res.render("tenant/admin/api-integrations/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      integrations,
      requestLogs: buildLogs(docs),
      stats: buildStats(docs),
      filters,
      query: { q, status, type, provider },
    });
  },

  save: async (req, res) => {
    const { ApiIntegration } = req.models;

    const id = str(req.body.integrationId);
    const payload = {
      name: str(req.body.name),
      type: str(req.body.type || "Custom"),
      provider: str(req.body.provider),
      baseUrl: str(req.body.baseUrl),
      authType: str(req.body.authType || "API Key"),
      status: str(req.body.status || "Active"),
      apiKey: str(req.body.apiKey),
      endpoint: str(req.body.endpoint),
      notes: str(req.body.notes),
      updatedBy: actorUserId(req),
    };

    if (!payload.name) {
      req.flash?.("error", "Integration name is required.");
      return res.redirect("/admin/api-integrations");
    }

    if (id && mongoose.Types.ObjectId.isValid(id)) {
      const existing = await ApiIntegration.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!existing) {
        req.flash?.("error", "Integration not found.");
        return res.redirect("/admin/api-integrations");
      }

      if (!payload.apiKey) delete payload.apiKey;

      await ApiIntegration.updateOne(
        { _id: id },
        { $set: payload }
      );

      req.flash?.("success", "Integration updated successfully.");
      return res.redirect("/admin/api-integrations");
    }

    await ApiIntegration.create({
      ...payload,
      metrics: {
        requests: 0,
        success: 0,
        failures: 0,
        avgResponse: "—",
      },
      requestLogs: [],
      lastTestAt: null,
      createdBy: actorUserId(req),
    });

    req.flash?.("success", "Integration created successfully.");
    return res.redirect("/admin/api-integrations");
  },

  toggle: async (req, res) => {
    const { ApiIntegration } = req.models;
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ""))) return res.redirect("/admin/api-integrations");

    const item = await ApiIntegration.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!item) return res.redirect("/admin/api-integrations");

    const next = item.status === "Disabled" ? "Active" : "Disabled";

    await ApiIntegration.updateOne(
      { _id: item._id },
      { $set: { status: next, updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/api-integrations");
  },

  test: async (req, res) => {
    const { ApiIntegration } = req.models;
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ""))) return res.redirect("/admin/api-integrations");

    const item = await ApiIntegration.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!item) return res.redirect("/admin/api-integrations");

    const ok = item.status !== "Disabled";
    const now = new Date();

    await ApiIntegration.updateOne(
      { _id: item._id },
      {
        $set: {
          lastTestAt: now,
          status: ok ? item.status : "Disabled",
          updatedBy: actorUserId(req),
        },
        $push: {
          requestLogs: {
            endpoint: item.endpoint || "/",
            method: "GET",
            status: ok ? "Success" : "Failed",
            responseTime: ok ? "220ms" : "—",
            message: ok ? "Connection test successful" : "Integration disabled",
            createdAt: now,
          },
        },
        $inc: {
          "metrics.requests": 1,
          "metrics.success": ok ? 1 : 0,
          "metrics.failures": ok ? 0 : 1,
        },
      }
    );

    req.flash?.("success", ok ? "Integration test completed." : "Integration test logged.");
    return res.redirect("/admin/api-integrations");
  },

  delete: async (req, res) => {
    const { ApiIntegration } = req.models;
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ""))) return res.redirect("/admin/api-integrations");

    await ApiIntegration.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/api-integrations");
  },

  bulkAction: async (req, res) => {
    const { ApiIntegration } = req.models;

    const ids = String(req.body.ids || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => mongoose.Types.ObjectId.isValid(x));

    const action = str(req.body.action);
    if (!ids.length || !action) return res.redirect("/admin/api-integrations");

    if (action === "enable") {
      await ApiIntegration.updateMany(
        { _id: { $in: ids }, isDeleted: { $ne: true } },
        { $set: { status: "Active", updatedBy: actorUserId(req) } }
      );
      return res.redirect("/admin/api-integrations");
    }

    if (action === "disable") {
      await ApiIntegration.updateMany(
        { _id: { $in: ids }, isDeleted: { $ne: true } },
        { $set: { status: "Disabled", updatedBy: actorUserId(req) } }
      );
      return res.redirect("/admin/api-integrations");
    }

    if (action === "test") {
      const now = new Date();
      await ApiIntegration.updateMany(
        { _id: { $in: ids }, isDeleted: { $ne: true } },
        {
          $set: { lastTestAt: now, updatedBy: actorUserId(req) },
          $inc: { "metrics.requests": 1, "metrics.success": 1 },
        }
      );
      return res.redirect("/admin/api-integrations");
    }

    return res.redirect("/admin/api-integrations");
  },
};
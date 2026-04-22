const { platformConnection } = require("../../config/db");

const AuditLog = require("../../models/platform/AuditLog")(platformConnection);

function escRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  listAuditLogs: async (req, res) => {
    try {
      const { q = "", action = "" } = req.query;

      const filter = {};

      if (action) filter.action = action;
      if (q) {
        const rx = new RegExp(escRegex(q), "i");
        filter.$or = [
          { action: rx },
          { description: rx },
          { actorName: rx },
          { entityType: rx },
        ];
      }

      const logs = await AuditLog.find(filter)
        .select("createdAt actorName actorRole action entityType entityId description ipAddress")
        .sort({ createdAt: -1 })
        .limit(300)
        .lean();

      return res.render("platform/audit-logs/index", {
        logs,
        filters: { q, action },
        error: null,
      });
    } catch (err) {
      console.error("listAuditLogs error:", err.message || err);
      return res.status(500).render("platform/audit-logs/index", {
        logs: [],
        filters: { q: "", action: "" },
        error: "Failed to load audit logs.",
      });
    }
  },

  showAuditLog: async (req, res) => {
    try {
      const log = await AuditLog.findById(req.params.id).lean();

      if (!log) {
        return res.status(404).render("platform/audit-logs/show", {
          log: null,
          error: "Audit log not found.",
        });
      }

      return res.render("platform/audit-logs/show", {
        log,
        error: null,
      });
    } catch (err) {
      console.error("showAuditLog error:", err.message || err);
      return res.status(500).render("platform/audit-logs/show", {
        log: null,
        error: "Failed to load audit log.",
      });
    }
  },
};

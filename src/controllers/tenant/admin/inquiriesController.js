const mongoose = require("mongoose");
const { getTenantConnection } = require("../../../config/db");
const loadTenantModels = require("../../../models/tenant/loadModels");
const {
  str,
  normalizeStatus,
  buildInquiryFilter,
  csvCell,
  actorUserId,
} = require("../../../services/tenant/inquiryService");

function wantsJson(req) {
  return (
    req.xhr ||
    (req.get("accept") || "").includes("application/json") ||
    req.get("x-requested-with") === "XMLHttpRequest"
  );
}

function formatDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

async function getTenantModelsFromReq(req) {
  if (req.models?.SchoolInquiry) return req.models;
  const dbName = req.tenant?.dbName || req.session?.tenantDbName;
  if (!dbName) throw new Error("Tenant database not found in request.");
  const conn = await getTenantConnection(dbName);
  return loadTenantModels(conn);
}

async function getInquiryModel(req) {
  const models = await getTenantModelsFromReq(req);
  if (!models?.SchoolInquiry) throw new Error("SchoolInquiry model is not available.");
  return models.SchoolInquiry;
}

function buildKpis(rows) {
  const live = rows.filter((x) => x?.isDeleted !== true);
  return {
    total: live.length,
    newCount: live.filter((x) => normalizeStatus(x.status) === "new").length,
    readCount: live.filter((x) => normalizeStatus(x.status) === "read").length,
    resolvedCount: live.filter((x) => normalizeStatus(x.status) === "resolved").length,
  };
}

function normalizeRow(x, fallbackSchoolCode = "") {
  return {
    ...x,
    schoolCode: str(x.schoolCode || fallbackSchoolCode, 80),
    createdAtLabel: formatDateTime(x.createdAt),
    updatedAtLabel: formatDateTime(x.updatedAt),
    statusLabel: normalizeStatus(x.status),
  };
}

function validIds(raw) {
  return [...new Set(str(raw, 10000).split(",").map((x) => x.trim()).filter((x) => mongoose.isValidObjectId(x)))];
}

function sendActionError(req, res, status, message) {
  if (wantsJson(req)) return res.status(status).json({ ok: false, message });
  return res.status(status).send(message);
}

module.exports = {
  async index(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);
      const q = str(req.query.q, 200);
      const requestedStatus = str(req.query.status || "all", 32).toLowerCase();
      const status = ["all", "new", "read", "resolved"].includes(requestedStatus) ? requestedStatus : "all";
      const filter = buildInquiryFilter({ q, status });

      const pageSize = 100;
      const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
      const [inquiries, total, kpiRows] = await Promise.all([
        SchoolInquiry.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
        SchoolInquiry.countDocuments(filter),
        SchoolInquiry.aggregate([
          { $match: { isDeleted: { $ne: true } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
      ]);

      const counts = Object.fromEntries(kpiRows.map((row) => [normalizeStatus(row._id), Number(row.count || 0)]));
      const kpis = { total: Object.values(counts).reduce((sum, n) => sum + n, 0), newCount: counts.new || 0, readCount: counts.read || 0, resolvedCount: counts.resolved || 0 };
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const makePageUrl = (target) => { const qs = new URLSearchParams(req.query || {}); qs.set("page", String(target)); return `/admin/inquiries?${qs.toString()}`; };
      const fallbackSchoolCode = req.tenant?.code || req.tenant?.subdomain || "";
      return res.render("tenant/inquiries/index", {
        title: "Inquiries",
        inquiries: inquiries.map((row) => normalizeRow(row, fallbackSchoolCode)),
        kpis,
        query: { q, status },
        pagination: { page, pageSize, total, pageCount, prevUrl: page > 1 ? makePageUrl(page - 1) : "", nextUrl: page < pageCount ? makePageUrl(page + 1) : "" },
        success: req.query.success ? "Updated successfully ✅" : null,
        error: null,
        csrfToken: req.csrfToken ? req.csrfToken() : null,
      });
    } catch (err) {
      console.error("admin inquiries index error:", err);
      return res.status(500).send("Failed to load inquiries.");
    }
  },

  async exportCsv(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);
      const filter = buildInquiryFilter(req.query || {});
      const rows = await SchoolInquiry.find(filter).sort({ createdAt: -1, _id: -1 }).lean();
      const fallbackSchoolCode = req.tenant?.code || req.tenant?.subdomain || "";
      const header = ["Name", "Contact", "Message", "School Code", "Status", "Created At", "Read At", "Resolved At"];
      const lines = [header.map(csvCell).join(",")];
      for (const row of rows) {
        lines.push([
          row.name,
          row.contact,
          row.message,
          row.schoolCode || fallbackSchoolCode,
          normalizeStatus(row.status),
          row.createdAt?.toISOString?.() || row.createdAt || "",
          row.readAt?.toISOString?.() || row.readAt || "",
          row.resolvedAt?.toISOString?.() || row.resolvedAt || "",
        ].map(csvCell).join(","));
      }
      const code = str(fallbackSchoolCode || "school", 80).replace(/[^a-z0-9_-]+/gi, "-") || "school";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${code}-inquiries.csv"`);
      return res.send(`\uFEFF${lines.join("\r\n")}\r\n`);
    } catch (err) {
      console.error("admin inquiries export error:", err);
      return res.status(500).send("Failed to export inquiries.");
    }
  },

  async markRead(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);
      const id = str(req.params.id, 64);
      if (!mongoose.isValidObjectId(id)) return sendActionError(req, res, 404, "Inquiry not found.");
      const now = new Date();
      const result = await SchoolInquiry.updateOne(
        {
          _id: id,
          isDeleted: { $ne: true },
          $or: [{ status: "new" }, { status: { $exists: false } }, { status: null }, { status: "" }],
        },
        { $set: { status: "read", readAt: now, readBy: actorUserId(req) } },
      );
      if (!(result.matchedCount || result.n || 0)) {
        const existing = await SchoolInquiry.findOne({ _id: id, isDeleted: { $ne: true } }).select("status").lean();
        if (!existing) return sendActionError(req, res, 404, "Inquiry not found.");
        // Read and resolved are idempotent; importantly, resolved is never downgraded.
      }
      if (wantsJson(req)) return res.json({ ok: true, message: "Inquiry marked as read." });
      return res.redirect("/admin/inquiries?success=1");
    } catch (err) {
      console.error("admin inquiries markRead error:", err);
      return sendActionError(req, res, 500, err.message || "Failed to update inquiry.");
    }
  },

  async markResolved(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);
      const id = str(req.params.id, 64);
      if (!mongoose.isValidObjectId(id)) return sendActionError(req, res, 404, "Inquiry not found.");
      const now = new Date();
      const result = await SchoolInquiry.updateOne(
        {
          _id: id,
          isDeleted: { $ne: true },
          $or: [
            { status: "new" },
            { status: "read" },
            { status: { $exists: false } },
            { status: null },
            { status: "" },
          ],
        },
        { $set: { status: "resolved", resolvedAt: now, resolvedBy: actorUserId(req) } },
      );
      if (!(result.matchedCount || result.n || 0)) {
        const existing = await SchoolInquiry.findOne({ _id: id, isDeleted: { $ne: true } }).select("status").lean();
        if (!existing) return sendActionError(req, res, 404, "Inquiry not found.");
      }
      if (wantsJson(req)) return res.json({ ok: true, message: "Inquiry marked as resolved." });
      return res.redirect("/admin/inquiries?success=1");
    } catch (err) {
      console.error("admin inquiries markResolved error:", err);
      return sendActionError(req, res, 500, err.message || "Failed to update inquiry.");
    }
  },

  async remove(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);
      const id = str(req.params.id, 64);
      if (!mongoose.isValidObjectId(id)) return sendActionError(req, res, 404, "Inquiry not found.");
      const result = await SchoolInquiry.updateOne(
        { _id: id, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorUserId(req) } },
      );
      if (!(result.matchedCount || result.n || 0)) return sendActionError(req, res, 404, "Inquiry not found.");
      if (wantsJson(req)) return res.json({ ok: true, message: "Inquiry deleted." });
      return res.redirect("/admin/inquiries?success=1");
    } catch (err) {
      console.error("admin inquiries remove error:", err);
      return sendActionError(req, res, 500, err.message || "Failed to delete inquiry.");
    }
  },

  async bulk(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);
      const action = str(req.body.action, 32).toLowerCase();
      const ids = validIds(req.body.ids);
      if (!ids.length) return sendActionError(req, res, 400, "No valid inquiries selected.");
      if (!["read", "resolve", "delete"].includes(action)) return sendActionError(req, res, 400, "Invalid bulk action.");

      const now = new Date();
      let result;
      if (action === "read") {
        result = await SchoolInquiry.updateMany(
          {
            _id: { $in: ids },
            isDeleted: { $ne: true },
            $or: [{ status: "new" }, { status: { $exists: false } }, { status: null }, { status: "" }],
          },
          { $set: { status: "read", readAt: now, readBy: actorUserId(req) } },
        );
      } else if (action === "resolve") {
        result = await SchoolInquiry.updateMany(
          {
            _id: { $in: ids },
            isDeleted: { $ne: true },
            $or: [
              { status: "new" },
              { status: "read" },
              { status: { $exists: false } },
              { status: null },
              { status: "" },
            ],
          },
          { $set: { status: "resolved", resolvedAt: now, resolvedBy: actorUserId(req) } },
        );
      } else {
        result = await SchoolInquiry.updateMany(
          { _id: { $in: ids }, isDeleted: { $ne: true } },
          { $set: { isDeleted: true, deletedAt: now, deletedBy: actorUserId(req) } },
        );
      }

      const matchedCount = result.matchedCount || result.n || 0;
      const modifiedCount = result.modifiedCount || result.nModified || 0;
      const message = action === "read"
        ? `${modifiedCount} selected inquiry${modifiedCount === 1 ? "" : "ies"} marked as read.`
        : action === "resolve"
          ? `${modifiedCount} selected inquiry${modifiedCount === 1 ? "" : "ies"} resolved.`
          : `${modifiedCount} selected inquiry${modifiedCount === 1 ? "" : "ies"} deleted.`;
      if (wantsJson(req)) return res.json({ ok: true, message, matchedCount, modifiedCount });
      return res.redirect("/admin/inquiries?success=1");
    } catch (err) {
      console.error("admin inquiries bulk error:", err);
      return sendActionError(req, res, 500, err.message || "Failed to process bulk action.");
    }
  },
};

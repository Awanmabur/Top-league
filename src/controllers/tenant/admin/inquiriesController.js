const { getTenantConnection } = require("../../../config/db");
const loadTenantModels = require("../../../models/tenant/loadModels");

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
  if (req.models?.SchoolInquiry) {
    return req.models;
  }

  const dbName = req.tenant?.dbName || req.session?.tenantDbName;
  if (!dbName) {
    throw new Error("Tenant database not found in request.");
  }

  const conn = await getTenantConnection(dbName);
  return loadTenantModels(conn);
}

async function getInquiryModel(req) {
  const models = await getTenantModelsFromReq(req);
  if (!models?.SchoolInquiry) {
    throw new Error("SchoolInquiry model is not available.");
  }
  return models.SchoolInquiry;
}

function buildKpis(rows) {
  return {
    total: rows.length,
    newCount: rows.filter((x) => String(x.status || "new") === "new").length,
    readCount: rows.filter((x) => String(x.status || "") === "read").length,
    resolvedCount: rows.filter((x) => String(x.status || "") === "resolved").length,
  };
}

function normalizeRow(x) {
  return {
    ...x,
    createdAtLabel: formatDateTime(x.createdAt),
    updatedAtLabel: formatDateTime(x.updatedAt),
    statusLabel: String(x.status || "new").trim() || "new",
  };
}

module.exports = {
  async index(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "all").trim().toLowerCase();

      const filter = {};

      if (status !== "all") {
        filter.status = status;
      }

      if (q) {
        filter.$or = [
          { name: { $regex: q, $options: "i" } },
          { contact: { $regex: q, $options: "i" } },
          { message: { $regex: q, $options: "i" } },
          { schoolCode: { $regex: q, $options: "i" } },
        ];
      }

      const [inquiries, allRows] = await Promise.all([
        SchoolInquiry.find(filter).sort({ createdAt: -1, _id: -1 }).lean(),
        SchoolInquiry.find({}).select("status").lean(),
      ]);

      const rows = inquiries.map(normalizeRow);
      const kpis = buildKpis(allRows);

      return res.render("tenant/admin/inquiries/index", {
        title: "Inquiries",
        inquiries: rows,
        kpis,
        query: {
          q,
          status,
        },
        success: req.query.success ? "Updated successfully ✅" : null,
        error: null,
        csrfToken: req.csrfToken ? req.csrfToken() : null,
      });
    } catch (err) {
      console.error("admin inquiries index error:", err);
      return res.status(500).send(err.message || "Failed to load inquiries.");
    }
  },

  async markRead(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);
      const id = String(req.params.id || "").trim();

      const inquiry = await SchoolInquiry.findById(id);
      if (!inquiry) {
        if (wantsJson(req)) {
          return res
            .status(404)
            .json({ ok: false, message: "Inquiry not found." });
        }
        return res.status(404).send("Inquiry not found.");
      }

      inquiry.status = "read";
      await inquiry.save();

      if (wantsJson(req)) {
        return res.json({ ok: true, message: "Inquiry marked as read." });
      }

      return res.redirect("/admin/inquiries?success=1");
    } catch (err) {
      console.error("admin inquiries markRead error:", err);
      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: err.message || "Failed to update inquiry.",
        });
      }
      return res.status(500).send(err.message || "Failed to update inquiry.");
    }
  },

  async markResolved(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);
      const id = String(req.params.id || "").trim();

      const inquiry = await SchoolInquiry.findById(id);
      if (!inquiry) {
        if (wantsJson(req)) {
          return res
            .status(404)
            .json({ ok: false, message: "Inquiry not found." });
        }
        return res.status(404).send("Inquiry not found.");
      }

      inquiry.status = "resolved";
      await inquiry.save();

      if (wantsJson(req)) {
        return res.json({ ok: true, message: "Inquiry marked as resolved." });
      }

      return res.redirect("/admin/inquiries?success=1");
    } catch (err) {
      console.error("admin inquiries markResolved error:", err);
      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: err.message || "Failed to update inquiry.",
        });
      }
      return res.status(500).send(err.message || "Failed to update inquiry.");
    }
  },

  async remove(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);
      const id = String(req.params.id || "").trim();

      const inquiry = await SchoolInquiry.findById(id);
      if (!inquiry) {
        if (wantsJson(req)) {
          return res
            .status(404)
            .json({ ok: false, message: "Inquiry not found." });
        }
        return res.status(404).send("Inquiry not found.");
      }

      await inquiry.deleteOne();

      if (wantsJson(req)) {
        return res.json({ ok: true, message: "Inquiry deleted." });
      }

      return res.redirect("/admin/inquiries?success=1");
    } catch (err) {
      console.error("admin inquiries remove error:", err);
      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: err.message || "Failed to delete inquiry.",
        });
      }
      return res.status(500).send(err.message || "Failed to delete inquiry.");
    }
  },

  async bulk(req, res) {
    try {
      const SchoolInquiry = await getInquiryModel(req);

      const action = String(req.body.action || "").trim().toLowerCase();
      const idsRaw = String(req.body.ids || "").trim();

      const ids = idsRaw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      if (!ids.length) {
        if (wantsJson(req)) {
          return res
            .status(400)
            .json({ ok: false, message: "No inquiries selected." });
        }
        return res.status(400).send("No inquiries selected.");
      }

      if (!["read", "resolve", "delete"].includes(action)) {
        if (wantsJson(req)) {
          return res
            .status(400)
            .json({ ok: false, message: "Invalid bulk action." });
        }
        return res.status(400).send("Invalid bulk action.");
      }

      let result;

      if (action === "read") {
        result = await SchoolInquiry.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "read" } },
        );

        if (wantsJson(req)) {
          return res.json({
            ok: true,
            message: "Selected inquiries marked as read.",
            matchedCount: result.matchedCount || result.n || 0,
            modifiedCount: result.modifiedCount || result.nModified || 0,
          });
        }

        return res.redirect("/admin/inquiries?success=1");
      }

      if (action === "resolve") {
        result = await SchoolInquiry.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "resolved" } },
        );

        if (wantsJson(req)) {
          return res.json({
            ok: true,
            message: "Selected inquiries marked as resolved.",
            matchedCount: result.matchedCount || result.n || 0,
            modifiedCount: result.modifiedCount || result.nModified || 0,
          });
        }

        return res.redirect("/admin/inquiries?success=1");
      }

      result = await SchoolInquiry.deleteMany({ _id: { $in: ids } });

      if (wantsJson(req)) {
        return res.json({
          ok: true,
          message: "Selected inquiries deleted.",
          deletedCount: result.deletedCount || 0,
        });
      }

      return res.redirect("/admin/inquiries?success=1");
    } catch (err) {
      console.error("admin inquiries bulk error:", err);
      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: err.message || "Failed to process bulk action.",
        });
      }
      return res.status(500).send(err.message || "Failed to process bulk action.");
    }
  },
};
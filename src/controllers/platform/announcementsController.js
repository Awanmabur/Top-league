const { platformConnection } = require("../../config/db");

const PlatformAnnouncement = require("../../models/platform/PlatformAnnouncement")(platformConnection);
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);

function safeTrim(v) {
  return String(v || "").trim();
}

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action: payload.action,
      entityType: payload.entityType || "PlatformAnnouncement",
      entityId: payload.entityId ? String(payload.entityId) : "",
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("❌ announcement audit log failed:", err);
  }
}

module.exports = {
  listAnnouncements: async (req, res) => {
    try {
      const announcements = await PlatformAnnouncement.find({})
        .sort({ createdAt: -1 })
        .populate("createdBy")
        .lean();

      return res.render("platform/announcements/index", {
        announcements,
        error: null,
      });
    } catch (err) {
      console.error("❌ listAnnouncements error:", err);
      return res.status(500).render("platform/announcements/index", {
        announcements: [],
        error: "Failed to load announcements.",
      });
    }
  },

  createAnnouncementForm: async (req, res) => {
    try {
      const tenants = await Tenant.find({
        isDeleted: { $ne: true },
      })
        .sort({ name: 1 })
        .lean();

      return res.render("platform/announcements/create", {
        tenants,
        old: {},
        error: null,
      });
    } catch (err) {
      console.error("❌ createAnnouncementForm error:", err);
      return res.status(500).render("platform/announcements/create", {
        tenants: [],
        old: {},
        error: "Failed to load create announcement form.",
      });
    }
  },

  createAnnouncement: async (req, res) => {
    try {
      const {
        title,
        body,
        audience,
        tenantIds,
        status,
        channel,
        publishAt,
        expiresAt,
        pinned,
      } = req.body;

      if (!safeTrim(title) || !safeTrim(body)) {
        const tenants = await Tenant.find({
          isDeleted: { $ne: true },
        })
          .sort({ name: 1 })
          .lean();

        return res.status(400).render("platform/announcements/create", {
          tenants,
          old: req.body,
          error: "Title and body are required.",
        });
      }

      const doc = await PlatformAnnouncement.create({
        title: safeTrim(title),
        body: safeTrim(body),
        audience: safeTrim(audience || "all"),
        tenantIds: Array.isArray(tenantIds) ? tenantIds : tenantIds ? [tenantIds] : [],
        status: safeTrim(status || "draft"),
        channel: safeTrim(channel || "dashboard"),
        publishAt: publishAt || undefined,
        publishedAt: safeTrim(status) === "published" ? new Date() : undefined,
        expiresAt: expiresAt || undefined,
        pinned: pinned === "on" || pinned === "true",
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });

      await writeAudit(req, {
        action: "Create Announcement",
        entityId: doc._id,
        description: `Created announcement ${doc.title}`,
        meta: {
          audience: doc.audience,
          status: doc.status,
        },
      });

      return res.redirect("/super-admin/announcements");
    } catch (err) {
      console.error("❌ createAnnouncement error:", err);

      const tenants = await Tenant.find({
        isDeleted: { $ne: true },
      })
        .sort({ name: 1 })
        .lean();

      return res.status(500).render("platform/announcements/create", {
        tenants,
        old: req.body,
        error: err?.message || "Failed to create announcement.",
      });
    }
  },

  showAnnouncement: async (req, res) => {
    try {
      const announcement = await PlatformAnnouncement.findById(req.params.id)
        .populate("tenantIds")
        .populate("createdBy")
        .lean();

      if (!announcement) {
        return res.status(404).render("platform/announcements/show", {
          announcement: null,
          error: "Announcement not found.",
        });
      }

      return res.render("platform/announcements/show", {
        announcement,
        error: null,
      });
    } catch (err) {
      console.error("❌ showAnnouncement error:", err);
      return res.status(500).render("platform/announcements/show", {
        announcement: null,
        error: "Failed to load announcement.",
      });
    }
  },

  publishAnnouncement: async (req, res) => {
    try {
      const announcement = await PlatformAnnouncement.findById(req.params.id);

      if (!announcement) {
        return res.status(404).send("Announcement not found.");
      }

      announcement.status = "published";
      announcement.publishedAt = new Date();
      announcement.updatedBy = req.user?._id || null;
      await announcement.save();

      await writeAudit(req, {
        action: "Publish Announcement",
        entityId: announcement._id,
        description: `Published announcement ${announcement.title}`,
      });

      return res.redirect("/super-admin/announcements");
    } catch (err) {
      console.error("❌ publishAnnouncement error:", err);
      return res.status(500).send("Failed to publish announcement.");
    }
  },

  deleteAnnouncement: async (req, res) => {
    try {
      const announcement = await PlatformAnnouncement.findById(req.params.id);

      if (!announcement) {
        return res.status(404).send("Announcement not found.");
      }

      await PlatformAnnouncement.deleteOne({ _id: announcement._id });

      await writeAudit(req, {
        action: "Delete Announcement",
        entityId: announcement._id,
        description: `Deleted announcement ${announcement.title}`,
      });

      return res.redirect("/super-admin/announcements");
    } catch (err) {
      console.error("❌ deleteAnnouncement error:", err);
      return res.status(500).send("Failed to delete announcement.");
    }
  },
};
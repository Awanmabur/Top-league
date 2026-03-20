"use strict";

const crypto = require("crypto");
const { platformConnection } = require("../../config/db");
const Tenant = require("../../models/platform/Tenant")(platformConnection);

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ipHash(ip) {
  if (!ip) return "";
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

function recomputeRatingSummary(tenant) {
  const reviews = tenant.settings?.profile?.reviews || [];
  const approved = reviews.filter((r) => r.status === "approved");
  const count = approved.length;
  const avg = count ? approved.reduce((sum, r) => sum + (r.rating || 0), 0) / count : 0;
  tenant.settings.profile.ratingSummary = { avg: Math.round(avg * 10) / 10, count };
}

module.exports = {
  async list(req, res, next) {
    try {
      const q = (req.query.q || "").trim();
      const city = (req.query.city || "").trim();
      const type = (req.query.type || "").trim();
      const verified = req.query.verified === "1";
      const sort = req.query.sort || "rank";

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit || "12", 10), 6), 30);
      const skip = (page - 1) * limit;

      const filter = { "settings.profile.enabled": true, isDeleted: { $ne: true } };
      if (city) filter["settings.profile.city"] = city;
      if (type) filter["settings.profile.type"] = type;
      if (verified) filter["settings.profile.verified"] = true;

      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [
          { name: rx },
          { code: rx },
          { "settings.profile.city": rx },
          { "settings.profile.type": rx },
          { "settings.profile.tagline": rx },
        ];
      }

      let sortObj = { createdAt: -1 };
      if (sort === "name") sortObj = { name: 1 };
      if (sort === "students") sortObj = { "settings.profile.stats.students": -1 };
      if (sort === "rank") sortObj = { "settings.profile.verified": -1, "settings.profile.ratingSummary.avg": -1, createdAt: -1 };

      const projection = {
        name: 1,
        code: 1,
        "settings.branding.logoUrl": 1,
        "settings.branding.coverUrl": 1,
        "settings.profile.type": 1,
        "settings.profile.tagline": 1,
        "settings.profile.city": 1,
        "settings.profile.system": 1,
        "settings.profile.verified": 1,
        "settings.profile.stats": 1,
        "settings.profile.ratingSummary": 1,
      };

      const [items, total] = await Promise.all([
        Tenant.find(filter).select(projection).sort(sortObj).skip(skip).limit(limit).lean(),
        Tenant.countDocuments(filter),
      ]);

      return res.render("tenant/public/schools/index", {
        items,
        q, city, type, verified, sort,
        page,
        pages: Math.ceil(total / limit),
        total,
      });
    } catch (e) {
      next(e);
    }
  },

  async view(req, res, next) {
    try {
      const code = String(req.params.code || "").toLowerCase().trim();

      const tenant = await Tenant.findOne({ code, "settings.profile.enabled": true, isDeleted: { $ne: true } }).lean();
      if (!tenant) return res.status(404).render("errors/404", { message: "School not found" });

      const p = tenant.settings?.profile || {};
      const reviews = (p.reviews || []).filter((r) => r.status === "approved").slice(0, 20);

      return res.render("tenant/public/schools/view", { tenant, reviews });
    } catch (e) {
      next(e);
    }
  },

  async submitReview(req, res, next) {
    try {
      const code = String(req.params.code || "").toLowerCase().trim();

      const tenant = await Tenant.findOne({ code, "settings.profile.enabled": true, isDeleted: { $ne: true } });
      if (!tenant) return res.status(404).json({ ok: false, message: "School not found" });

      tenant.settings = tenant.settings || {};
      tenant.settings.profile = tenant.settings.profile || {};
      tenant.settings.profile.reviews = tenant.settings.profile.reviews || [];
      tenant.settings.profile.ratingSummary = tenant.settings.profile.ratingSummary || { avg: 0, count: 0 };

      // basic anti-abuse
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
      const iph = ipHash(ip);
      const ua = String(req.headers["user-agent"] || "").slice(0, 200);

      const since = Date.now() - 24 * 60 * 60 * 1000;
      const recent = tenant.settings.profile.reviews.filter((r) => r.ipHash === iph && r.createdAt && r.createdAt.getTime() > since);
      if (recent.length >= 2) return res.status(429).json({ ok: false, message: "Too many reviews today. Try again tomorrow." });

      const name = String(req.body.name || "").trim().slice(0, 60);
      const email = String(req.body.email || "").trim().toLowerCase().slice(0, 120);
      const rating = Number(req.body.rating || 0);
      const title = String(req.body.title || "").trim().slice(0, 80);
      const message = String(req.body.message || "").trim().slice(0, 1200);

      if (!name || !(rating >= 1 && rating <= 5)) {
        return res.status(422).json({ ok: false, message: "Name and rating are required." });
      }

      tenant.settings.profile.reviews.push({
        name,
        email: email || undefined,
        rating,
        title,
        message,
        status: "pending",
        featured: false,
        ipHash: iph,
        userAgent: ua,
        createdAt: new Date(),
      });

      recomputeRatingSummary(tenant); // counts approved only
      await tenant.save();

      return res.json({ ok: true, message: "Thanks! Your review is submitted and awaiting approval." });
    } catch (e) {
      next(e);
    }
  },
};

const crypto = require("crypto");
const { safeColor, safeRenderUrl, sanitizePublicBranding, sanitizePublicProfileForRender } = require("../../src/services/tenant/publicPresenceService");

function plain(value) { return JSON.parse(JSON.stringify(value || {})); }
function key(prefix, row, idx) {
  const raw = row?._id ? String(row._id) : JSON.stringify([row?.q, row?.name, row?.message, idx]);
  return `${prefix}:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

async function migratePublicPresence(models, { tenant } = {}) {
  const { SchoolFAQ, SchoolReview, TenantProfile } = models || {};
  const profile = tenant?.settings?.profile || {};
  const branding = tenant?.settings?.branding || {};
  const prefs = tenant?.settings?.preferences || {};
  const stats = { faqsImported: 0, reviewsImported: 0, profileUpserted: 0 };

  if (SchoolFAQ && Array.isArray(profile.faqs)) {
    for (let i = 0; i < profile.faqs.length; i += 1) {
      const row = profile.faqs[i] || {};
      const legacySourceId = key("faq", row, i);
      const q = String(row.q || row.question || "").trim().slice(0, 160);
      const a = String(row.a || row.answer || "").trim().slice(0, 900);
      if (!q || !a) continue;
      const exists = await SchoolFAQ.findOne({ legacySourceId }).lean();
      if (exists) continue;
      await SchoolFAQ.create({ q, a, order: Number(row.order ?? row.sort ?? i) || 0, isPublished: row.isPublished !== false, revision: 1, legacySourceId });
      stats.faqsImported += 1;
    }
  }

  if (SchoolReview && Array.isArray(profile.reviews)) {
    for (let i = 0; i < profile.reviews.length; i += 1) {
      const row = profile.reviews[i] || {};
      const legacySourceId = key("review", row, i);
      const exists = await SchoolReview.findOne({ legacySourceId }).lean();
      if (exists) continue;
      const name = String(row.name || "Anonymous").trim().slice(0, 80) || "Anonymous";
      const rating = Number(row.rating);
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) continue;
      const status = ["approved", "rejected", "pending"].includes(String(row.status)) ? String(row.status) : "pending";
      await SchoolReview.create({
        name, email: String(row.email || "").trim().toLowerCase().slice(0, 120), rating,
        title: String(row.title || "").trim().slice(0, 120), message: String(row.message || "").trim().slice(0, 1200),
        status, featured: status === "approved" && !!row.featured,
        ipHash: "", userAgent: "", userAgentHash: row.userAgent ? crypto.createHash("sha256").update(String(row.userAgent)).digest("hex") : "", submitterHash: "",
        legacySourceId, revision: 1, moderationHistory: status === "pending" ? [] : [{ action: status === "approved" ? "approved" : "rejected", at: row.approvedAt || row.updatedAt || row.createdAt || new Date(), by: null, reason: "legacy migration" }], approvedAt: status === "approved" ? (row.approvedAt || row.createdAt || new Date()) : null,
        reviewedAt: status === "pending" ? null : (row.approvedAt || row.updatedAt || new Date()),
        createdAt: row.createdAt || new Date(), updatedAt: row.updatedAt || new Date(),
      });
      stats.reviewsImported += 1;
    }
  }

  if (TenantProfile && tenant) {
    const safeProfile = sanitizePublicProfileForRender(profile);
    const safeBranding = sanitizePublicBranding(branding);
    const current = await TenantProfile.findOne({ singletonKey: "school", isDeleted: { $ne: true } }).lean();
    if (!current) {
      await TenantProfile.create({
        singletonKey: "school", schoolName: String(tenant.name || tenant.code || "School").trim().slice(0, 220),
        shortName: String(profile.shortName || "").trim(), tagline: String(profile.tagline || "").trim(), category: String(profile.category || profile.type || "").trim(),
        email: String(safeProfile.contact?.email || "").trim().toLowerCase(), phone: String(safeProfile.contact?.phone || "").trim(), altPhone: String(safeProfile.contact?.altPhone || "").trim(),
        address: String(safeProfile.contact?.addressFull || "").trim(), website: String(safeProfile.contact?.website || "").trim(), logoUrl: String(safeBranding.logoUrl || "").trim(), faviconUrl: String(safeBranding.faviconUrl || "").trim(),
        primaryColor: safeColor(safeBranding.primaryColor, "#0a6fbf"), secondaryColor: safeColor(safeBranding.secondaryColor, "#0d4060"), motto: String(safeProfile.motto || ""), description: String(safeProfile.about || ""),
        tenantCode: String(tenant.code || ""), planName: String(tenant.planName || "Starter"), subdomain: String(tenant.subdomain || ""), customDomain: String(tenant.customDomain || ""), status: String(tenant.status || "Active"),
        publicProfile: plain(safeProfile), branding: plain(safeBranding), publicPreferences: { allowPublicProfile: prefs.allowPublicProfile !== false, allowReviews: prefs.allowReviews !== false, showContactForm: prefs.showContactForm !== false, showGallery: prefs.showGallery !== false },
        revision: Math.max(1, Number(profile.revision || 1)), publishedAt: prefs.allowPublicProfile === false || profile.enabled === false ? null : new Date(),
      });
      stats.profileUpserted = 1;
    }
  }
  return stats;
}
module.exports = { migratePublicPresence };

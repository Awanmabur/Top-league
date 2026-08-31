const crypto = require("crypto");

function text(v, max = 500) {
  return String(Array.isArray(v) ? v[v.length - 1] : v ?? "").trim().slice(0, max);
}
function email(v) { return text(v, 160).toLowerCase(); }
function privacySecret() {
  const secret = process.env.PUBLIC_REVIEW_FINGERPRINT_SECRET || process.env.SESSION_SECRET || process.env.DATA_ENCRYPTION_KEY || "";
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_REVIEW_FINGERPRINT_SECRET (or SESSION_SECRET/DATA_ENCRYPTION_KEY) is required for public reviews.");
  }
  return secret || "classic-academy-local-review-secret";
}
function privacyHmac(label, value) {
  return crypto.createHmac("sha256", privacySecret()).update(`${label}|${String(value || "")}`).digest("hex");
}
function isHttpUrl(value, { allowRelative = false } = {}) {
  const raw = text(value, 1000);
  if (!raw) return true;
  if (allowRelative && raw.startsWith("/") && !raw.startsWith("//")) return true;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) { return false; }
}
function safeUrl(value, opts = {}) {
  const raw = text(value, 1000);
  if (!raw) return "";
  if (!isHttpUrl(raw, opts)) throw new Error("Only safe HTTP(S) URLs are allowed.");
  return raw;
}
function safeRenderUrl(value, opts = {}) {
  const raw = text(value, 1000);
  return raw && isHttpUrl(raw, opts) ? raw : "";
}
function safeColor(value, fallback) {
  const raw = text(value, 32);
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
}
function sanitizePublicBranding(branding = {}) {
  return {
    ...branding,
    logoUrl: safeRenderUrl(branding.logoUrl, { allowRelative: true }),
    faviconUrl: safeRenderUrl(branding.faviconUrl, { allowRelative: true }),
    coverUrl: safeRenderUrl(branding.coverUrl, { allowRelative: true }),
    primaryColor: safeColor(branding.primaryColor, "#0a3d62"),
    accentColor: safeColor(branding.accentColor, "#0a6fbf"),
    secondaryColor: safeColor(branding.secondaryColor, "#083454"),
    textColor: safeColor(branding.textColor, "#0f172a"),
  };
}
function sanitizePublicProfileForRender(profile = {}) {
  const out = JSON.parse(JSON.stringify(profile || {}));
  out.contact = out.contact || {};
  out.socials = out.socials || {};
  out.location = out.location || {};
  out.admissions = out.admissions || {};
  out.seo = out.seo || {};
  out.contact.website = safeRenderUrl(out.contact.website);
  for (const key of ["facebook", "instagram", "x", "youtube", "tiktok", "linkedin"]) {
    out.socials[key] = safeRenderUrl(out.socials[key]);
  }
  out.location.googleMapUrl = safeRenderUrl(out.location.googleMapUrl);
  out.admissions.applyUrl = safeRenderUrl(out.admissions.applyUrl || out.applyUrl, { allowRelative: true });
  out.applyUrl = out.admissions.applyUrl;
  out.seo.ogImageUrl = safeRenderUrl(out.seo.ogImageUrl, { allowRelative: true });
  out.seo.canonicalUrl = safeRenderUrl(out.seo.canonicalUrl, { allowRelative: true });
  return out;
}
function reviewFingerprint({ ip = "", emailAddress = "", message = "", userAgent = "" }) {
  const material = [String(ip), email(emailAddress), text(message, 1200).toLowerCase(), text(userAgent, 200).toLowerCase()].join("|");
  return privacyHmac("review-fingerprint", material);
}
function reviewSubmitterHash({ ip = "", emailAddress = "", userAgent = "" }) {
  return privacyHmac("review-submitter", [String(ip), email(emailAddress), text(userAgent, 200).toLowerCase()].join("|"));
}
function ratingSummary(rows = []) {
  const approved = rows.filter((r) => r && r.status === "approved" && !r.isDeleted && Number(r.rating) >= 1 && Number(r.rating) <= 5);
  if (!approved.length) return { avg: 0, count: 0 };
  const total = approved.reduce((sum, row) => sum + Number(row.rating || 0), 0);
  return { avg: Number((total / approved.length).toFixed(1)), count: approved.length };
}
function sanitizeReview(row) {
  return {
    _id: row._id,
    name: text(row.name, 80),
    rating: Number(row.rating || 0),
    title: text(row.title, 120),
    message: text(row.message, 1200),
    featured: !!row.featured,
    status: row.status,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt || row.reviewedAt || null,
  };
}
function sanitizeFaq(row) {
  return { _id: row._id, q: text(row.q, 160), a: text(row.a, 900), sort: Number(row.order ?? row.sort ?? 0), isPublished: row.isPublished !== false };
}
async function listCanonicalContent(models) {
  const { SchoolFAQ, SchoolReview } = models || {};
  const [faqs, reviews] = await Promise.all([
    SchoolFAQ ? SchoolFAQ.find({ isDeleted: { $ne: true } }).sort({ order: 1, createdAt: 1 }).lean() : [],
    SchoolReview ? SchoolReview.find({ isDeleted: { $ne: true } }).sort({ featured: -1, createdAt: -1 }).lean() : [],
  ]);
  return { faqs, reviews, summary: ratingSummary(reviews) };
}
async function publicCanonicalContent(models) {
  const { SchoolFAQ, SchoolReview } = models || {};
  const [faqs, reviews] = await Promise.all([
    SchoolFAQ ? SchoolFAQ.find({ isDeleted: { $ne: true }, isPublished: true }).sort({ order: 1, createdAt: 1 }).limit(100).lean() : [],
    SchoolReview ? SchoolReview.find({ isDeleted: { $ne: true }, status: "approved" }).sort({ featured: -1, approvedAt: -1, createdAt: -1 }).limit(100).lean() : [],
  ]);
  return { faqs: faqs.map(sanitizeFaq), reviews: reviews.map(sanitizeReview), summary: ratingSummary(reviews) };
}
async function syncPublicProjection(tenantDoc, models) {
  if (!tenantDoc || !models) return null;
  const TenantModel = tenantDoc.constructor;
  if (tenantDoc._id && TenantModel && typeof TenantModel.findOneAndUpdate === "function" && typeof TenantModel.updateOne === "function") {
    const claimed = await TenantModel.findOneAndUpdate(
      { _id: tenantDoc._id, isDeleted: { $ne: true } },
      { $inc: { "meta.publicContentProjectionVersion": 1 } },
      { new: true, projection: { "meta.publicContentProjectionVersion": 1 } }
    );
    if (!claimed) throw new Error("School public profile is no longer available.");
    const version = Number(claimed.meta?.publicContentProjectionVersion || 0);
    const { faqs, reviews, summary } = await publicCanonicalContent(models);
    const now = new Date();
    const result = await TenantModel.updateOne(
      { _id: tenantDoc._id, "meta.publicContentProjectionVersion": version, isDeleted: { $ne: true } },
      { $set: {
        "settings.profile.faqs": faqs,
        "settings.profile.reviews": reviews,
        "settings.profile.ratingSummary": summary,
        "meta.lastPublicContentUpdateAt": now,
        "meta.lastPublicProjectionAt": now,
        "meta.publicPresenceSyncPending": false,
      } }
    );
    if (!result.matchedCount && !result.modifiedCount) return { faqs, reviews, summary, stale: true, projectionVersion: version };
    tenantDoc.settings = tenantDoc.settings || {};
    tenantDoc.settings.profile = tenantDoc.settings.profile || {};
    tenantDoc.settings.profile.faqs = faqs;
    tenantDoc.settings.profile.reviews = reviews;
    tenantDoc.settings.profile.ratingSummary = summary;
    tenantDoc.meta = tenantDoc.meta || {};
    tenantDoc.meta.publicContentProjectionVersion = version;
    tenantDoc.meta.lastPublicContentUpdateAt = now;
    tenantDoc.meta.lastPublicProjectionAt = now;
    return { faqs, reviews, summary, projectionVersion: version };
  }

  const { faqs, reviews, summary } = await publicCanonicalContent(models);
  tenantDoc.settings = tenantDoc.settings || {};
  tenantDoc.settings.profile = tenantDoc.settings.profile || {};
  tenantDoc.settings.profile.faqs = faqs;
  tenantDoc.settings.profile.reviews = reviews;
  tenantDoc.settings.profile.ratingSummary = summary;
  tenantDoc.meta = tenantDoc.meta || {};
  tenantDoc.meta.lastPublicContentUpdateAt = new Date();
  if (tenantDoc.markModified) {
    tenantDoc.markModified("settings.profile.faqs");
    tenantDoc.markModified("settings.profile.reviews");
    tenantDoc.markModified("settings.profile.ratingSummary");
  }
  if (tenantDoc.save) await tenantDoc.save();
  return { faqs, reviews, summary };
}
async function submitCanonicalReview({ models, payload, ip, userAgent }) {
  const { SchoolReview } = models || {};
  if (!SchoolReview) throw new Error("Review service is unavailable.");
  const name = text(payload?.name, 80);
  const emailAddress = email(payload?.email);
  const rating = Number(payload?.rating);
  const title = text(payload?.title, 120);
  const message = text(payload?.message, 1200);
  if (!name) throw new Error("Name is required.");
  if (emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) throw new Error("Email address is invalid.");
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new Error("Rating must be between 1 and 5.");
  if (!message) throw new Error("Review message is required.");
  const ua = text(userAgent, 200);
  const fingerprint = reviewFingerprint({ ip, emailAddress, message, userAgent: ua });
  const submitterHash = reviewSubmitterHash({ ip, emailAddress, userAgent: ua });
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [duplicate, recentCount] = await Promise.all([
    SchoolReview.findOne({ fingerprint, createdAt: { $gte: since }, isDeleted: { $ne: true } }).lean(),
    typeof SchoolReview.countDocuments === "function"
      ? SchoolReview.countDocuments({ submitterHash, createdAt: { $gte: since }, isDeleted: { $ne: true } })
      : 0,
  ]);
  if (duplicate) throw new Error("A similar review was already submitted recently.");
  if (Number(recentCount || 0) >= 3) throw new Error("Review submission limit reached. Try again later.");
  return SchoolReview.create({
    name, email: emailAddress, rating, title, message,
    status: "pending", featured: false,
    fingerprint, submitterHash,
    ipHash: privacyHmac("review-ip", String(ip || "")),
    userAgent: "",
    userAgentHash: privacyHmac("review-user-agent", ua),
    revision: 1,
  });
}
function validatePublicProfileInput(body = {}) {
  const urlFields = ["website", "facebook", "instagram", "x", "youtube", "tiktok", "linkedin", "googleMapUrl", "ogImageUrl", "canonicalUrl"];
  for (const field of urlFields) {
    if (text(body[field]) && !isHttpUrl(body[field], { allowRelative: field === "canonicalUrl" })) {
      throw new Error(`${field} must be a safe HTTP(S) URL.`);
    }
  }
  if (text(body.applyUrl) && !isHttpUrl(body.applyUrl, { allowRelative: true })) throw new Error("applyUrl must be a safe local or HTTP(S) URL.");
  const lat = text(body.lat); const lng = text(body.lng);
  if (lat && (!Number.isFinite(Number(lat)) || Number(lat) < -90 || Number(lat) > 90)) throw new Error("Latitude is invalid.");
  if (lng && (!Number.isFinite(Number(lng)) || Number(lng) < -180 || Number(lng) > 180)) throw new Error("Longitude is invalid.");
  return true;
}
module.exports = {
  text, email, privacySecret, privacyHmac, isHttpUrl, safeUrl, safeRenderUrl, safeColor,
  sanitizePublicBranding, sanitizePublicProfileForRender,
  reviewFingerprint, reviewSubmitterHash, ratingSummary, sanitizeReview, sanitizeFaq,
  listCanonicalContent, publicCanonicalContent, syncPublicProjection, submitCanonicalReview, validatePublicProfileInput,
};

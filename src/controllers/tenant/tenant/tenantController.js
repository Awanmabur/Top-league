const { sanitizePublicBranding, sanitizePublicProfileForRender } = require("../../../services/tenant/publicPresenceService");
const { configuredKey } = require("../../../services/indexNowService");
const scholarshipService = require("../../../services/tenant/scholarshipService");

function plain(value) {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject({ getters: false, virtuals: false });
  return value;
}

function cleanList(values, limit = 12) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))).slice(0, limit);
}


function tenantPublicOrigin(req) {
  const host = String(req.get?.("host") || req.hostname || "").trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host)) return "";
  const protocol = req.secure || req.protocol === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

function resolveTenantCanonical(req, profile) {
  const origin = tenantPublicOrigin(req);
  const configured = String(profile?.seo?.canonicalUrl || "").trim();
  if (configured) {
    try {
      const url = new URL(configured, origin || undefined);
      if (/^https?:$/.test(url.protocol)) return url.toString().replace(/\/+$/, "");
    } catch { /* fall back to the resolved tenant origin */ }
  }
  return origin ? `${origin}/` : "";
}

function buildPublicHome(tenantValue) {
  const tenant = plain(tenantValue);
  const settings = tenant.settings || {};
  const profile = sanitizePublicProfileForRender(settings.profile || {});
  const branding = sanitizePublicBranding(settings.branding || {});
  const academics = settings.academics || {};
  const schoolUnits = (Array.isArray(academics.schoolUnits) ? academics.schoolUnits : []).filter((unit) => unit && unit.isActive !== false);
  const gallery = (Array.isArray(profile.gallery) ? profile.gallery : []).filter((item) => item && item.url).sort((a,b) => Number(a.sort || 0) - Number(b.sort || 0)).slice(0, 8);
  const announcements = (Array.isArray(profile.announcements) ? profile.announcements : []).filter((item) => item && item.isPublished !== false && item.title).sort((a,b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 6);
  const programs = cleanList([...(academics.educationLevels || []), ...(academics.schoolSections || []), ...(academics.extraSubjects || []), ...schoolUnits.map((unit) => unit.name)], 12);
  const location = profile.location || {};
  const contact = profile.contact || {};
  const admissions = profile.admissions || {};
  const stats = profile.stats || {};
  return {
    tenant: { name: String(tenant.name || "School"), code: String(tenant.code || "") },
    profile, branding, gallery, announcements, programs,
    values: cleanList(profile.values, 8),
    facilities: cleanList(profile.facilities, 8),
    highlights: cleanList(profile.highlights, 8),
    whyChooseUs: cleanList(profile.whyChooseUs, 8),
    locationLabel: [location.city, location.country].filter(Boolean).join(", ") || contact.addressFull || "",
    stats: { students: Number(stats.students || 0), subjects: Number(stats.subjects || 0), staff: Number(stats.staff || 0), campuses: Number(stats.campuses || 0) },
    admissions: {
      ...admissions,
      steps: cleanList(admissions.steps, 8),
      requiredDocs: cleanList(admissions.requiredDocs, 10),
      applyUrl: admissions.applyUrl || "/apply",
    },
    preferences: settings.preferences || {},
  };
}

module.exports = {
  index: async (req, res) => {
    const tenant = req.tenant;
    if (!tenant) return res.status(404).send("School not found (tenant missing)");
    try {
      const publicHome = buildPublicHome(tenant);
      const publicSiteUrl = tenantPublicOrigin(req);
      const publicCanonicalUrl = resolveTenantCanonical(req, publicHome.profile);
      return res.render("tenant/public/index", { tenant, publicHome, publicSiteUrl, publicCanonicalUrl });
    } catch (err) {
      console.error("tenant public home:", err);
      return res.status(500).send("Render error");
    }
  },
  robots: (req, res) => {
    const origin = tenantPublicOrigin(req);
    const privatePaths = ["/admin/", "/student/", "/parent/", "/staff/", "/api/"];
    const group = (agent) => [`User-agent: ${agent}`, "Allow: /", ...privatePaths.map((path) => `Disallow: ${path}`)];
    return res.type("text/plain").send([
      ...group("*"), "",
      ...group("OAI-SearchBot"), "",
      "User-agent: GPTBot", "Disallow: /", "",
      origin ? `Sitemap: ${origin}/sitemap.xml` : "", "",
    ].filter((line, index, all) => line || all[index - 1] !== "").join("\n"));
  },
  sitemap: async (req, res) => {
    const origin = tenantPublicOrigin(req);
    if (!origin) return res.status(500).type("text/plain").send("Tenant public URL unavailable");
    const entries = [{ loc: `${origin}/`, lastmod: req.tenant?.updatedAt || null }, { loc: `${origin}/scholarships`, lastmod: null }];
    try {
      const Scholarship = req.models?.Scholarship;
      if (Scholarship) {
        const docs = await Scholarship.find(scholarshipService.publicScholarshipFilter(new Date()))
          .select("_id updatedAt")
          .sort({ updatedAt: -1 })
          .limit(5000)
          .lean();
        for (const doc of docs) {
          entries.push({ loc: `${origin}/scholarships/${encodeURIComponent(String(doc._id))}`, lastmod: doc.updatedAt || null });
        }
      }
    } catch (error) {
      console.error("tenant sitemap scholarship expansion failed:", error?.message || error);
    }
    const esc = (value) => String(value || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
    const urls = entries.map(({ loc, lastmod }) => {
      let last = "";
      if (lastmod) {
        const date = new Date(lastmod);
        if (!Number.isNaN(date.getTime())) last = `<lastmod>${date.toISOString()}</lastmod>`;
      }
      return `  <url><loc>${esc(loc)}</loc>${last}</url>`;
    }).join("\n");
    return res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
  },
  llms: (req, res) => {
    const origin = tenantPublicOrigin(req);
    const tenant = req.tenant || {};
    const home = buildPublicHome(tenant);
    const name = home.profile?.shortName || tenant.name || "School";
    return res.type("text/plain").send([
      `# ${name}`, "",
      `> Official public website for ${name}.`, "",
      "## Public pages",
      `- Home: ${origin}/`,
      `- Admissions: ${origin}/apply`,
      `- Scholarships: ${origin}/scholarships`,
      "",
      "Application-status lookups, login pages, and authenticated school portals are private/functional surfaces and are not public documentation.",
      "",
    ].join("\n"));
  },
  indexNowKey: (req, res) => {
    const key = configuredKey();
    if (!key) return res.status(404).type("text/plain").send("Not configured");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.type("text/plain").send(key);
  },
  buildPublicHome,
  tenantPublicOrigin,
  resolveTenantCanonical,
};

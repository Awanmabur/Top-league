const { platformConnection } = require("../../config/db");
const Tenant = require("../../models/platform/Tenant")(platformConnection);

function clean(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeArrayField(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === "string") return [value];
  return [];
}

function buildBaseFilter() {
  return {
    isDeleted: { $ne: true },
    "settings.profile.enabled": { $ne: false },
  };
}

function buildQuickFacilityFilter(facility) {
  const fac = clean(facility, 40).toLowerCase();
  if (!fac || fac === "all") return null;

  const rx = new RegExp(escapeRegex(fac), "i");

  return {
    $or: [
      { "settings.profile.facilities": rx },
      { "settings.profile.highlights": rx },
      { "settings.profile.system": rx },
    ],
  };
}

function buildFacilityFilters(facilities) {
  const list = Array.isArray(facilities) ? facilities : [facilities].filter(Boolean);
  const cleaned = list.map((x) => clean(x, 40).toLowerCase()).filter(Boolean);

  if (!cleaned.length) return [];

  return cleaned.map((fac) => {
    const rx = new RegExp(escapeRegex(fac), "i");
    return {
      $or: [
        { "settings.profile.facilities": rx },
        { "settings.profile.highlights": rx },
        { "settings.profile.system": rx },
      ],
    };
  });
}

function buildSort(sortBy) {
  switch (sortBy) {
    case "feesLow":
      return {
        "settings.profile.fees.amountMin": 1,
        "settings.profile.feesRangeMin": 1,
        name: 1,
      };
    case "feesHigh":
      return {
        "settings.profile.fees.amountMax": -1,
        "settings.profile.feesRangeMax": -1,
        name: 1,
      };
    case "ratingHigh":
      return {
        "settings.profile.ratingSummary.avg": -1,
        "settings.profile.verified": -1,
        name: 1,
      };
    case "nameAZ":
      return { name: 1 };
    default:
      return {
        "settings.profile.verified": -1,
        "settings.profile.ratingSummary.avg": -1,
        "settings.profile.stats.students": -1,
        createdAt: -1,
      };
  }
}

module.exports = {
  // GET /search
  async page(req, res) {
    try {
      const q = clean(req.query.q, 120);
      const category = clean(req.query.category || "all", 60).toLowerCase();
      const country = clean(req.query.country || "all", 10).toUpperCase();
      const location = clean(req.query.location, 100);
      const curriculum = clean(req.query.curriculum || "all", 60);
      const minFee = toPositiveNumber(req.query.minFee);
      const maxFee = toPositiveNumber(req.query.maxFee);
      const quickFacility = clean(req.query.quickFacility || "all", 40).toLowerCase();
      const sortBy = clean(req.query.sortBy || "relevance", 40);
      const facilities = Array.isArray(req.query.facilities)
        ? req.query.facilities
        : req.query.facilities
          ? [req.query.facilities]
          : [];

      const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
      const perPage = Math.min(
        Math.max(parseInt(req.query.limit || "6", 10) || 6, 1),
        48,
      );
      const skip = (page - 1) * perPage;

      const filter = buildBaseFilter();
      const andConditions = [];

      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        andConditions.push({
          $or: [
            { name: rx },
            { code: rx },
            { "settings.profile.shortName": rx },
            { "settings.profile.type": rx },
            { "settings.profile.category": rx },
            { "settings.profile.tagline": rx },
            { "settings.profile.curriculum": rx },
            { "settings.profile.location.city": rx },
            { "settings.profile.location.country": rx },
            { "settings.profile.facilities": rx },
            { "settings.profile.highlights": rx },
            { "settings.profile.system": rx },
          ],
        });
      }

      if (category !== "all") {
        const rx = new RegExp(escapeRegex(category), "i");
        andConditions.push({
          $or: [
            { "settings.profile.category": rx },
            { "settings.profile.type": rx },
          ],
        });
      }

      if (country !== "ALL") {
        const rx = new RegExp(`^${escapeRegex(country)}$|${escapeRegex(country)}`, "i");
        andConditions.push({
          $or: [
            { "settings.profile.location.countryCode": rx },
            { "settings.profile.location.country": rx },
          ],
        });
      }

      if (location) {
        const rx = new RegExp(escapeRegex(location), "i");
        andConditions.push({
          $or: [
            { "settings.profile.location.city": rx },
            { "settings.profile.location.country": rx },
            { "settings.profile.address": rx },
            { "settings.profile.contact.addressFull": rx },
          ],
        });
      }

      if (curriculum !== "all") {
        const rx = new RegExp(escapeRegex(curriculum), "i");
        andConditions.push({
          $or: [
            { "settings.profile.curriculum": rx },
            { "settings.academics.extraSubjects": rx },
            { "settings.profile.highlights": rx },
          ],
        });
      }

      if (minFee != null) {
        andConditions.push({
          $or: [
            { "settings.profile.fees.amountMin": { $gte: minFee } },
            { "settings.profile.feesRangeMin": { $gte: minFee } },
            { "settings.profile.feesRangeText": { $regex: String(minFee), $options: "i" } },
          ],
        });
      }

      if (maxFee != null) {
        andConditions.push({
          $or: [
            { "settings.profile.fees.amountMax": { $lte: maxFee } },
            { "settings.profile.feesRangeMax": { $lte: maxFee } },
          ],
        });
      }

      const quickFacilityFilter = buildQuickFacilityFilter(quickFacility);
      if (quickFacilityFilter) andConditions.push(quickFacilityFilter);

      const checkboxFacilityFilters = buildFacilityFilters(facilities);
      if (checkboxFacilityFilters.length) {
        andConditions.push(...checkboxFacilityFilters);
      }

      if (andConditions.length) {
        filter.$and = andConditions;
      }

      const projection = {
        name: 1,
        code: 1,
        "settings.branding.logoUrl": 1,
        "settings.branding.coverUrl": 1,
        "settings.profile.shortName": 1,
        "settings.profile.type": 1,
        "settings.profile.category": 1,
        "settings.profile.tagline": 1,
        "settings.profile.curriculum": 1,
        "settings.profile.verified": 1,
        "settings.profile.location.city": 1,
        "settings.profile.location.country": 1,
        "settings.profile.location.countryCode": 1,
        "settings.profile.contact.phone": 1,
        "settings.profile.admissions.applyUrl": 1,
        "settings.profile.ratingSummary": 1,
        "settings.profile.stats": 1,
        "settings.profile.awards": 1,
        "settings.profile.facilities": 1,
        "settings.profile.highlights": 1,
        "settings.profile.fees": 1,
        "settings.profile.feesRange": 1,
        "settings.profile.feesRangeText": 1,
        "settings.profile.feesRangeMin": 1,
        "settings.profile.feesRangeMax": 1,
      };

      const [items, total] = await Promise.all([
        Tenant.find(filter)
          .select(projection)
          .sort(buildSort(sortBy))
          .skip(skip)
          .limit(perPage)
          .lean(),
        Tenant.countDocuments(filter),
      ]);

      const results = items.map((item) => {
        const branding = item.settings?.branding || {};
        const profile = item.settings?.profile || {};
        const locationObj = profile.location || {};
        const rating = profile.ratingSummary || {};
        const facilitiesArr = normalizeArrayField(profile.facilities);
        const awardsArr = normalizeArrayField(profile.awards);

        const feeMin =
          profile.fees?.amountMin ??
          profile.feesRangeMin ??
          null;

        const feeMax =
          profile.fees?.amountMax ??
          profile.feesRangeMax ??
          null;

        let feeText = clean(profile.feesRangeText || profile.feesRange || "", 120);
        if (!feeText && feeMin != null && feeMax != null) {
          feeText = `$${feeMin} - $${feeMax}/term`;
        } else if (!feeText && feeMin != null) {
          feeText = `From $${feeMin}/term`;
        }

        const categoryLabel = clean(profile.category || profile.type || "School", 60);
        const curriculumLabel = clean(profile.curriculum || "General", 60);

        let badge = "";
        if (profile.verified) badge = "Verified";
        else if (awardsArr.length) badge = "Awarded";
        else if ((rating.avg || 0) >= 4.5) badge = "Top Rated";

        return {
          name: item.name,
          code: item.code,
          shortName: clean(profile.shortName || item.name || "S", 20),
          category: categoryLabel,
          curriculum: curriculumLabel,
          location: clean(locationObj.city || "N/A", 80),
          country: clean(
            locationObj.countryCode ||
              locationObj.country ||
              "N/A",
            30,
          ),
          rating: Number(rating.avg || 0),
          verified: !!profile.verified,
          feeText,
          feeMin,
          feeMax,
          facilities: facilitiesArr,
          awardsCount: awardsArr.length,
          img: branding.coverUrl || "https://picsum.photos/seed/search-school/1200/700",
          blurb: clean(
            profile.tagline || "Explore this school profile on Classic Academy.",
            220,
          ),
          profileUrl: `/schools/${encodeURIComponent(item.code)}`,
          applyUrl:
            profile.admissions?.applyUrl ||
            `/admissions?school=${encodeURIComponent(item.code)}`,
          badge,
        };
      });

      const pages = Math.max(1, Math.ceil(total / perPage));

      return res.render("platform/public/search", {
        results,
        total,
        page,
        pages,
        perPage,
        filters: {
          q,
          category,
          country,
          location,
          curriculum,
          minFee: minFee ?? "",
          maxFee: maxFee ?? "",
          quickFacility,
          facilities,
          sortBy,
        },
      });
    } catch (error) {
      console.error("public search page:", error);
      return res.status(500).render("platform/public/500");
    }
  },
};

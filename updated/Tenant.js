const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("Tenant model requires a mongoose connection");
  if (connection.models.Tenant) return connection.models.Tenant;

  const GalleryItemSchema = new Schema(
    {
      url: { type: String, required: true, trim: true },
      publicId: { type: String, required: true, trim: true },
      caption: { type: String, default: "", trim: true, maxlength: 220 },
      sort: { type: Number, default: 0 },
      uploadedAt: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const AwardSchema = new Schema(
    {
      title: { type: String, required: true, trim: true, maxlength: 200 },
      organization: { type: String, default: "", trim: true, maxlength: 200 },
      year: { type: Number, min: 1900, max: 3000 },
      description: { type: String, default: "", trim: true, maxlength: 800 },
      sort: { type: Number, default: 0 },
    },
    { _id: true }
  );

  const AnnouncementSchema = new Schema(
    {
      title: { type: String, required: true, trim: true, maxlength: 200 },
      body: { type: String, default: "", trim: true, maxlength: 3000 },
      date: { type: Date, default: Date.now },
      pinned: { type: Boolean, default: false },
      isPublished: { type: Boolean, default: true },
      sort: { type: Number, default: 0 },
    },
    { _id: true }
  );

  const ReviewSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 60 },
      email: { type: String, trim: true, lowercase: true, maxlength: 120 },
      rating: { type: Number, required: true, min: 1, max: 5 },
      title: { type: String, default: "", trim: true, maxlength: 80 },
      message: { type: String, default: "", trim: true, maxlength: 1200 },
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },
      featured: { type: Boolean, default: false },
      ipHash: { type: String, default: "" },
      userAgent: { type: String, default: "", maxlength: 200 },
      createdAt: { type: Date, default: Date.now },
      approvedAt: { type: Date },
    },
    { _id: true }
  );

  const FAQSchema = new Schema(
    {
      q: { type: String, required: true, trim: true, maxlength: 160 },
      a: { type: String, required: true, trim: true, maxlength: 900 },
      sort: { type: Number, default: 0 },
    },
    { _id: true }
  );

  const SocialsSchema = new Schema(
    {
      facebook: { type: String, default: "", trim: true, maxlength: 250 },
      instagram: { type: String, default: "", trim: true, maxlength: 250 },
      x: { type: String, default: "", trim: true, maxlength: 250 },
      youtube: { type: String, default: "", trim: true, maxlength: 250 },
      tiktok: { type: String, default: "", trim: true, maxlength: 250 },
      linkedin: { type: String, default: "", trim: true, maxlength: 250 },
      whatsapp: { type: String, default: "", trim: true, maxlength: 80 },
    },
    { _id: false }
  );

  const ContactSchema = new Schema(
    {
      phone: { type: String, default: "", trim: true, maxlength: 40 },
      altPhone: { type: String, default: "", trim: true, maxlength: 40 },
      email: {
        type: String,
        default: "",
        trim: true,
        lowercase: true,
        maxlength: 180,
      },
      admissionsEmail: {
        type: String,
        default: "",
        trim: true,
        lowercase: true,
        maxlength: 180,
      },
      billingEmail: {
        type: String,
        default: "",
        trim: true,
        lowercase: true,
        maxlength: 180,
      },
      website: { type: String, default: "", trim: true, maxlength: 250 },
      addressFull: { type: String, default: "", trim: true, maxlength: 300 },
      postalAddress: { type: String, default: "", trim: true, maxlength: 200 },
    },
    { _id: false }
  );

  const LocationSchema = new Schema(
    {
      country: { type: String, default: "", trim: true, maxlength: 80 },
      city: { type: String, default: "", trim: true, maxlength: 120 },
      district: { type: String, default: "", trim: true, maxlength: 120 },
      addressLine1: { type: String, default: "", trim: true, maxlength: 180 },
      addressLine2: { type: String, default: "", trim: true, maxlength: 180 },
      lat: { type: Number },
      lng: { type: Number },
      googleMapUrl: { type: String, default: "", trim: true, maxlength: 500 },
    },
    { _id: false }
  );

  const AdmissionsSchema = new Schema(
    {
      applyUrl: { type: String, default: "", trim: true, maxlength: 500 },
      requirements: {
        type: String,
        default: "",
        trim: true,
        maxlength: 4000,
      },
      officeHours: {
        type: String,
        default: "",
        trim: true,
        maxlength: 1000,
      },
      intakeLabel: { type: String, default: "", trim: true, maxlength: 120 },
      applicationFeeText: {
        type: String,
        default: "",
        trim: true,
        maxlength: 500,
      },
      admissionPhone: { type: String, default: "", trim: true, maxlength: 40 },
      isOpen: { type: Boolean, default: true },

      // ✅ NEW: real admissions fields used by public page
      steps: [{ type: String, trim: true, maxlength: 300 }],
      requiredDocs: [{ type: String, trim: true, maxlength: 200 }],
      feesRange: { type: String, default: "", trim: true, maxlength: 300 },
      paymentOptions: { type: String, default: "", trim: true, maxlength: 500 },
    },
    { _id: false }
  );

  const SEOConfigSchema = new Schema(
    {
      metaTitle: { type: String, default: "", trim: true, maxlength: 160 },
      metaDescription: {
        type: String,
        default: "",
        trim: true,
        maxlength: 320,
      },
      keywords: [{ type: String, trim: true, maxlength: 80 }],
      ogImageUrl: { type: String, default: "", trim: true, maxlength: 500 },
      canonicalUrl: { type: String, default: "", trim: true, maxlength: 500 },
      indexable: { type: Boolean, default: true },
      structuredDataEnabled: { type: Boolean, default: true },
    },
    { _id: false }
  );

  const BrandingSchema = new Schema(
    {
      logoUrl: { type: String, default: "", trim: true, maxlength: 500 },
      logoPublicId: { type: String, default: "", trim: true, maxlength: 250 },
      faviconUrl: { type: String, default: "", trim: true, maxlength: 500 },
      faviconPublicId: { type: String, default: "", trim: true, maxlength: 250 },
      coverUrl: { type: String, default: "", trim: true, maxlength: 500 },
      coverPublicId: { type: String, default: "", trim: true, maxlength: 250 },
      primaryColor: { type: String, default: "#0a3d62", trim: true, maxlength: 30 },
      accentColor: { type: String, default: "#0a6fbf", trim: true, maxlength: 30 },
      secondaryColor: { type: String, default: "#083454", trim: true, maxlength: 30 },
      textColor: { type: String, default: "#0f172a", trim: true, maxlength: 30 },
      buttonRadius: { type: Number, default: 14, min: 0, max: 50 },
    },
    { _id: false }
  );

  const ProfileStatsSchema = new Schema(
    {
      students: { type: Number, default: 0, min: 0 },
      subjects: { type: Number, default: 0, min: 0 },
      staff: { type: Number, default: 0, min: 0 },
      campuses: { type: Number, default: 0, min: 0 },
      alumni: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
  );

  const RatingSummarySchema = new Schema(
    {
      avg: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
  );

  const ProfileSchema = new Schema(
    {
      enabled: { type: Boolean, default: true },
      verified: { type: Boolean, default: false },

      type: { type: String, default: "", trim: true, maxlength: 120 },
      shortName: { type: String, default: "", trim: true, maxlength: 120 },
      tagline: { type: String, default: "", trim: true, maxlength: 220 },
      motto: { type: String, default: "", trim: true, maxlength: 220 },

      foundedYear: { type: Number, min: 1800, max: 3000 },
      system: { type: String, default: "", trim: true, maxlength: 120 },
      ownership: { type: String, default: "", trim: true, maxlength: 120 },
      category: { type: String, default: "", trim: true, maxlength: 120 },

      about: { type: String, default: "", trim: true, maxlength: 5000 },
      mission: { type: String, default: "", trim: true, maxlength: 3000 },
      vision: { type: String, default: "", trim: true, maxlength: 3000 },

      values: [{ type: String, trim: true, maxlength: 120 }],
      facilities: [{ type: String, trim: true, maxlength: 160 }],
      accreditations: [{ type: String, trim: true, maxlength: 160 }],
      clubs: [{ type: String, trim: true, maxlength: 160 }],
      scholarships: [{ type: String, trim: true, maxlength: 160 }],
      policies: [{ type: String, trim: true, maxlength: 160 }],
      highlights: [{ type: String, trim: true, maxlength: 220 }],
      whyChooseUs: [{ type: String, trim: true, maxlength: 220 }],

      contact: { type: ContactSchema, default: () => ({}) },
      socials: { type: SocialsSchema, default: () => ({}) },
      location: { type: LocationSchema, default: () => ({}) },
      admissions: { type: AdmissionsSchema, default: () => ({}) },

      stats: { type: ProfileStatsSchema, default: () => ({}) },

      gallery: [GalleryItemSchema],
      awards: [AwardSchema],
      announcements: [AnnouncementSchema],
      faqs: [FAQSchema],
      reviews: [ReviewSchema],

      ratingSummary: { type: RatingSummarySchema, default: () => ({}) },
      seo: { type: SEOConfigSchema, default: () => ({}) },
    },
    { _id: false }
  );


  const SectionSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 80 },
      code: { type: String, default: "", trim: true, maxlength: 50 },
      isActive: { type: Boolean, default: true },
    },
    { _id: true }
  );

  const LevelProfileSchema = new Schema(
    {
      title: { type: String, default: "", trim: true, maxlength: 120 },
      description: { type: String, default: "", trim: true, maxlength: 2000 },
      curriculum: { type: String, default: "", trim: true, maxlength: 120 },
      admissionsNote: { type: String, default: "", trim: true, maxlength: 1200 },
      feesNote: { type: String, default: "", trim: true, maxlength: 1200 },
    },
    { _id: false }
  );

  const LevelSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 80 },
      code: { type: String, default: "", trim: true, maxlength: 50 },
      isActive: { type: Boolean, default: true },
      profile: { type: LevelProfileSchema, default: () => ({}) },
      sections: [SectionSchema],
    },
    { _id: true }
  );

  const CampusProfileSchema = new Schema(
    {
      shortName: { type: String, default: "", trim: true, maxlength: 120 },
      tagline: { type: String, default: "", trim: true, maxlength: 220 },
      about: { type: String, default: "", trim: true, maxlength: 3000 },
      phone: { type: String, default: "", trim: true, maxlength: 40 },
      email: { type: String, default: "", trim: true, lowercase: true, maxlength: 180 },
      admissionsEmail: { type: String, default: "", trim: true, lowercase: true, maxlength: 180 },
    },
    { _id: false }
  );

  const CampusAccessSchema = new Schema(
    {
      isolatedOperations: { type: Boolean, default: true },
      adminCanSwitchIntoCampus: { type: Boolean, default: true },
      campusScopedUsersByDefault: { type: Boolean, default: true },
    },
    { _id: false }
  );

  const CampusSchema = new Schema(
    {
      schoolUnitName: { type: String, default: "", trim: true, maxlength: 160 },
      schoolUnitCode: { type: String, default: "", trim: true, maxlength: 60 },
      schoolUnitSlug: { type: String, default: "", trim: true, maxlength: 120 },
      name: { type: String, required: true, trim: true, maxlength: 140 },
      code: { type: String, default: "", trim: true, maxlength: 50 },
      city: { type: String, default: "", trim: true, maxlength: 120 },
      district: { type: String, default: "", trim: true, maxlength: 120 },
      country: { type: String, default: "", trim: true, maxlength: 80 },
      address: { type: String, default: "", trim: true, maxlength: 220 },
      contactPhone: { type: String, default: "", trim: true, maxlength: 40 },
      contactEmail: { type: String, default: "", trim: true, lowercase: true, maxlength: 180 },
      isMain: { type: Boolean, default: false },
      isActive: { type: Boolean, default: true },
      profile: { type: CampusProfileSchema, default: () => ({}) },
      branding: { type: BrandingSchema, default: () => ({}) },
      access: { type: CampusAccessSchema, default: () => ({}) },
      levels: [LevelSchema],
    },
    { _id: true }
  );

  const SchoolUnitAccessSchema = new Schema(
    {
      adminCanSwitchCampuses: { type: Boolean, default: true },
      campusScopedUsersByDefault: { type: Boolean, default: true },
      allowCrossCampusParentView: { type: Boolean, default: true },
    },
    { _id: false }
  );

  const SchoolUnitSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 160 },
      code: { type: String, default: "", trim: true, maxlength: 60 },
      slug: { type: String, default: "", trim: true, maxlength: 120 },
      schoolType: {
        type: String,
        enum: ["private", "government", "faith-based", "international", "community", "other"],
        default: "private",
      },
      category: {
        type: String,
        enum: ["nursery", "primary", "secondary", "mixed"],
        default: "mixed",
      },
      isActive: { type: Boolean, default: true },
      access: { type: SchoolUnitAccessSchema, default: () => ({}) },
      branding: { type: BrandingSchema, default: () => ({}) },
      profile: { type: ProfileSchema, default: () => ({ enabled: true }) },
      campuses: [CampusSchema],
    },
    { _id: true }
  );

  const AcademicsSchema = new Schema(
    {
      institutionType: {
        type: String,
        enum: ["academy", "school", "college", "institute"],
        default: "academy",
      },
      schoolModel: {
        type: String,
        enum: ["day", "boarding", "day-boarding", "mixed"],
        default: "day-boarding",
      },
      educationLevels: [{ type: String, trim: true, maxlength: 80 }],
      schoolSections: [{ type: String, trim: true, maxlength: 80 }],
      extraSubjects: [{ type: String, trim: true, maxlength: 120 }],
      schoolUnits: [SchoolUnitSchema],
      campuses: [CampusSchema],
      hasMultipleCampuses: { type: Boolean, default: false },
    },
    { _id: false }
  );

  const SettingsSchema = new Schema(
    {
      branding: { type: BrandingSchema, default: () => ({}) },
      profile: { type: ProfileSchema, default: () => ({}) },
      academics: { type: AcademicsSchema, default: () => ({}) },
      modules: [{ type: String, trim: true, maxlength: 100 }],
      preferences: {
        allowPublicProfile: { type: Boolean, default: true },
        allowReviews: { type: Boolean, default: true },
        showContactForm: { type: Boolean, default: true },
        showGallery: { type: Boolean, default: true },
      },
    },
    { _id: false }
  );

  const MetaSchema = new Schema(
    {
      onboardingCompleted: { type: Boolean, default: false },
      onboardingStep: { type: Number, default: 0, min: 0 },
      provisioningVersion: { type: Number, default: 1 },
      notes: { type: String, default: "", trim: true, maxlength: 2000 },

      domainStatus: {
        type: String,
        enum: ["pending", "connected", "failed", "not_configured"],
        default: "not_configured",
      },
      sslStatus: {
        type: String,
        enum: ["pending", "active", "failed", "not_applicable"],
        default: "not_applicable",
      },

      profileCompletion: { type: Number, default: 0, min: 0, max: 100 },
      lastProfileUpdateAt: { type: Date },
      lastPublicContentUpdateAt: { type: Date },
    },
    { _id: false }
  );

  const TenantSchema = new Schema(
    {
      name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
      },

      code: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        maxlength: 80,
      },

      subdomain: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        maxlength: 160,
      },

      dbName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120,
        unique: true,
      },

      customDomain: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 200,
      },

      planId: {
        type: Schema.Types.ObjectId,
        ref: "Plan",
      },

      planName: {
        type: String,
        trim: true,
        default: "",
        maxlength: 120,
      },

      status: {
        type: String,
        enum: ["trial", "active", "suspended", "cancelled", "deleted"],
        default: "trial",
      },

      trialEndsAt: { type: Date },
      subscriptionStartsAt: { type: Date },
      subscriptionEndsAt: { type: Date },
      lastBilledAt: { type: Date },
      lastSeenAt: { type: Date },

      ownerName: {
        type: String,
        trim: true,
        maxlength: 180,
      },

      ownerEmail: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 180,
      },

      ownerPhone: {
        type: String,
        trim: true,
        maxlength: 40,
      },

      country: {
        type: String,
        trim: true,
        maxlength: 80,
      },

      timezone: {
        type: String,
        trim: true,
        default: "Africa/Kampala",
        maxlength: 80,
      },

      currency: {
        type: String,
        trim: true,
        uppercase: true,
        default: "USD",
        maxlength: 10,
      },

      isDeleted: {
        type: Boolean,
        default: false,
      },

      archivedAt: { type: Date },

      settings: {
        type: SettingsSchema,
        default: () => ({}),
      },

      meta: {
        type: MetaSchema,
        default: () => ({}),
      },

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: "PlatformUser",
      },

      updatedBy: {
        type: Schema.Types.ObjectId,
        ref: "PlatformUser",
      },
    },
    { timestamps: true }
  );

  TenantSchema.index({ customDomain: 1 }, { sparse: true, unique: true });
  TenantSchema.index({ status: 1, isDeleted: 1, createdAt: -1 });
  TenantSchema.index({ planId: 1, status: 1 });
  TenantSchema.index({ planName: 1 });
  TenantSchema.index({
    name: "text",
    code: "text",
    subdomain: "text",
    "settings.profile.shortName": "text",
    "settings.profile.type": "text",
    "settings.profile.tagline": "text",
    "settings.profile.location.city": "text",
    "settings.profile.location.country": "text",
    "settings.academics.schoolUnits.name": "text",
    "settings.academics.schoolUnits.code": "text",
    "settings.academics.schoolUnits.slug": "text",
  });
  TenantSchema.index({
    "settings.profile.enabled": 1,
    "settings.profile.verified": 1,
  });
  TenantSchema.index({ ownerEmail: 1 });
  TenantSchema.index({ "settings.academics.schoolUnits.schoolType": 1, "settings.academics.schoolUnits.category": 1 });
  TenantSchema.index({ "settings.profile.contact.email": 1 });
  TenantSchema.index({ "meta.domainStatus": 1, "meta.sslStatus": 1 });

  TenantSchema.pre("save", function (next) {
    if (this.status === "deleted") {
      this.isDeleted = true;
      if (!this.archivedAt) this.archivedAt = new Date();
    }

    if (!this.settings) this.settings = {};
    if (!this.settings.branding) this.settings.branding = {};
    if (!this.settings.profile) this.settings.profile = {};
    if (!this.settings.academics) this.settings.academics = {};
    if (!this.settings.preferences) this.settings.preferences = {};
    if (!this.meta) this.meta = {};

    const academics = this.settings.academics || {};
    const schoolUnits = Array.isArray(academics.schoolUnits) ? academics.schoolUnits : [];

    if (schoolUnits.length) {
      const levels = new Set();
      const sections = new Set();
      const campuses = [];

      schoolUnits.forEach((schoolUnit) => {
        if (!schoolUnit.code && schoolUnit.name) {
          schoolUnit.code = String(schoolUnit.name)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        }
        if (!schoolUnit.slug && schoolUnit.code) schoolUnit.slug = schoolUnit.code;
        if (!schoolUnit.profile) schoolUnit.profile = {};
        if (!schoolUnit.branding) schoolUnit.branding = {};
        if (!schoolUnit.access) schoolUnit.access = {};
        if (schoolUnit.profile.enabled === undefined) schoolUnit.profile.enabled = true;

        const unitCampuses = Array.isArray(schoolUnit.campuses) ? schoolUnit.campuses : [];
        let mainFound = false;
        unitCampuses.forEach((campus, campusIndex) => {
          if (!campus.code && campus.name) {
            campus.code = String(campus.name)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
          }
          campus.schoolUnitName = schoolUnit.name || campus.schoolUnitName || "";
          campus.schoolUnitCode = schoolUnit.code || campus.schoolUnitCode || "";
          campus.schoolUnitSlug = schoolUnit.slug || campus.schoolUnitSlug || "";
          if (!campus.profile) campus.profile = {};
          if (!campus.branding) campus.branding = {};
          if (!campus.access) campus.access = {};
          if (campus.isMain && !mainFound) mainFound = true;
          else if (campus.isMain && mainFound) campus.isMain = false;
          else if (!mainFound && campusIndex === 0) {
            campus.isMain = true;
            mainFound = true;
          }
          campuses.push(campus);

          const levelItems = Array.isArray(campus.levels) ? campus.levels : [];
          levelItems.forEach((level) => {
            if (!level.code && level.name) {
              level.code = String(level.name)
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
            }
            if (!level.profile) level.profile = {};
            if (level.name) levels.add(level.name);
            const sectionItems = Array.isArray(level.sections) ? level.sections : [];
            sectionItems.forEach((section) => {
              if (!section.code && section.name) {
                section.code = String(section.name)
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "");
              }
              if (section.name) sections.add(section.name);
            });
          });
        });
      });

      academics.campuses = campuses;
      academics.educationLevels = Array.from(levels);
      academics.schoolSections = Array.from(sections);
      academics.hasMultipleCampuses = campuses.length > 1;
    }

    const completionProfile = schoolUnits[0]?.profile || this.settings.profile || {};
    const completionBranding = schoolUnits[0]?.branding || this.settings.branding || {};
    const contact = completionProfile.contact || {};
    const location = completionProfile.location || {};

    const completionFields = [
      this.name,
      completionProfile.type,
      completionProfile.tagline,
      completionProfile.about,
      completionProfile.mission,
      completionProfile.vision,
      contact.phone,
      contact.email,
      contact.website,
      contact.addressFull,
      location.city,
      location.country,
      completionBranding.logoUrl,
      completionBranding.coverUrl,
      completionProfile.admissions?.applyUrl,
      completionProfile.seo?.metaTitle,
    ];

    const filled = completionFields.filter((v) => String(v || "").trim()).length;
    this.meta.profileCompletion = Math.round(
      (filled / completionFields.length) * 100
    );

    next();
  });

  return connection.model("Tenant", TenantSchema);
};
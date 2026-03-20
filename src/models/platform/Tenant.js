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
      programs: { type: Number, default: 0, min: 0 },
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

  const SettingsSchema = new Schema(
    {
      branding: { type: BrandingSchema, default: () => ({}) },
      profile: { type: ProfileSchema, default: () => ({}) },
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
  });
  TenantSchema.index({
    "settings.profile.enabled": 1,
    "settings.profile.verified": 1,
  });
  TenantSchema.index({ ownerEmail: 1 });
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
    if (!this.settings.preferences) this.settings.preferences = {};
    if (!this.meta) this.meta = {};

    const profile = this.settings.profile;
    const contact = profile.contact || {};
    const location = profile.location || {};
    const branding = this.settings.branding || {};

    const completionFields = [
      this.name,
      profile.type,
      profile.tagline,
      profile.about,
      profile.mission,
      profile.vision,
      contact.phone,
      contact.email,
      contact.website,
      contact.addressFull,
      location.city,
      location.country,
      branding.logoUrl,
      branding.coverUrl,
      profile.admissions?.applyUrl,
      profile.seo?.metaTitle,
    ];

    const filled = completionFields.filter((v) => String(v || "").trim()).length;
    this.meta.profileCompletion = Math.round(
      (filled / completionFields.length) * 100
    );

    next();
  });

  return connection.model("Tenant", TenantSchema);
};
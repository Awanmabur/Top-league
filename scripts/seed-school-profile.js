require("dotenv").config({ quiet: true });

const { platformConnection, waitForPlatform } = require("../src/config/db");
const Tenant = require("../src/models/platform/Tenant")(platformConnection);

const TENANT_CODE =
  argValue(["tenant", "tenantCode"]) || process.env.TENANT_CODE || "classic";
const SCHOOL_UNIT_SELECTOR =
  argValue(["schoolUnitId", "schoolUnit", "unit"]) ||
  process.env.SCHOOL_UNIT_ID ||
  process.env.SCHOOL_UNIT_CODE ||
  "";

const SUBJECTS = [
  "Mathematics",
  "English Language",
  "Biology",
  "Chemistry",
  "Physics",
  "Geography",
  "History",
  "Christian Religious Education",
  "Computer Studies",
  "Entrepreneurship",
  "Literature in English",
  "Agriculture",
];

function argValue(names) {
  const keys = Array.isArray(names) ? names : [names];

  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];

    for (const key of keys) {
      if (arg === `--${key}`) return process.argv[i + 1] || "";
      if (arg.startsWith(`--${key}=`)) {
        return arg.slice(key.length + 3);
      }
    }
  }

  return "";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function galleryItem(url, index, caption) {
  return {
    url,
    publicId: `seed/classic-academy/profile-gallery-${index + 1}`,
    caption,
    sort: index,
    uploadedAt: new Date(),
  };
}

function buildBranding() {
  return {
    logoUrl:
      "https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=800&auto=format&fit=crop",
    logoPublicId: "seed/classic-academy/logo",
    coverUrl:
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=1600&auto=format&fit=crop",
    coverPublicId: "seed/classic-academy/cover",
    primaryColor: "#0a3d62",
    accentColor: "#0a6fbf",
    secondaryColor: "#083454",
    textColor: "#0f172a",
    buttonRadius: 14,
  };
}

function buildProfile() {
  return {
    enabled: true,
    verified: true,
    shortName: "Classic Academy",
    type: "Secondary School",
    tagline: "Building disciplined, confident, and future-ready learners.",
    motto: "Learn. Lead. Serve.",
    foundedYear: 2012,
    system: "Day & Boarding",
    ownership: "Private",
    category: "Secondary",

    about:
      "Classic Academy Secondary School is a modern learner-centred school committed to academic excellence, discipline, innovation, and character formation. We provide a safe, structured, and inspiring environment where students grow intellectually, socially, spiritually, and practically. Our approach combines strong classroom teaching, guided mentorship, technology-supported learning, leadership development, sports, and co-curricular engagement to prepare learners for success in school and in life.",

    mission:
      "To provide quality, holistic, and values-driven education that empowers learners to excel academically, lead responsibly, and serve their communities with integrity.",

    vision:
      "To be a leading school known for academic excellence, innovation, discipline, and the all-round development of every learner.",

    values: [
      "Integrity",
      "Excellence",
      "Respect",
      "Discipline",
      "Innovation",
      "Responsibility",
      "Teamwork",
      "Service",
    ],

    highlights: [
      "Experienced and caring teachers",
      "Strong academic support and mentoring",
      "Modern computer and science learning environment",
      "Balanced focus on academics, discipline, and talent",
      "Safe and supportive school community",
      "Active co-curricular and leadership opportunities",
      "Guidance and counselling support",
      "Strong parent-school communication",
      "Structured boarding life and supervision",
      "Learner-centred teaching approach",
    ],

    facilities: [
      "Library",
      "Computer Lab",
      "Science Laboratory",
      "School Hall",
      "Sports Field",
      "Boarding Section",
      "Guidance Office",
      "ICT Room",
      "Reading Area",
      "Cafeteria",
      "School Clinic",
      "Examination Hall",
    ],

    accreditations: ["UNEB", "Ministry of Education and Sports"],

    clubs: [
      "Debate Club",
      "ICT Club",
      "Scripture Union",
      "Wildlife Club",
      "Entrepreneurship Club",
      "Music Dance and Drama",
      "Writers Club",
      "Science Club",
      "Leadership Forum",
      "Environment Club",
    ],

    scholarships: [
      "Academic Excellence Scholarship",
      "Leadership Scholarship",
      "Partial Bursary Support",
      "Sports Talent Support",
    ],

    policies: [
      "Child Protection Policy",
      "Anti-Bullying Policy",
      "ICT Acceptable Use Policy",
      "Attendance Policy",
      "Examination Integrity Policy",
      "Boarding Conduct Policy",
      "Health and Safety Policy",
    ],

    whyChooseUs: [
      "Strong discipline culture and supportive pastoral care",
      "Regular assessment and performance tracking",
      "Well-rounded education beyond the classroom",
      "Technology-enhanced learning opportunities",
      "Safe boarding and day school options",
      "Focused preparation for national examinations",
    ],

    location: {
      city: "Kampala",
      country: "Uganda",
      addressLine1: "Plot 24, Education Road",
      googleMapUrl: "https://maps.google.com/",
    },

    contact: {
      phone: "+256700123456",
      email: "info@classicacademy.sch.ug",
      website: "https://classicacademy.sch.ug",
      addressFull: "Plot 24, Education Road, Kampala, Uganda",
    },

    socials: {
      facebook: "https://facebook.com/classicacademyug",
      instagram: "https://instagram.com/classicacademyug",
      x: "https://x.com/classicacademyug",
      youtube: "https://youtube.com/@classicacademyug",
      tiktok: "https://tiktok.com/@classicacademyug",
      linkedin: "https://linkedin.com/company/classicacademyug",
    },

    seo: {
      metaTitle:
        "Classic Academy Secondary School | Admissions, Academics & Student Life in Kampala",
      metaDescription:
        "Classic Academy Secondary School offers quality secondary education in Kampala with strong academics, discipline, ICT integration, student support, boarding and day options, and admissions guidance.",
      keywords: [
        "secondary school in Kampala",
        "school admissions Uganda",
        "boarding school Kampala",
        "day and boarding school Uganda",
        "ICT school Kampala",
        "science school in Uganda",
        "secondary education Kampala",
        "best school in Kampala",
      ],
    },

    admissions: {
      isOpen: true,
      applyUrl: "/apply",
      intakeLabel: "2026 Admissions Open",
      admissionPhone: "+256700123456",
      requirements:
        "Applicants should submit recent academic results, a copy of a birth certificate or identification document, passport-size photographs, and any transfer or recommendation letters where applicable. Placement may depend on interview or assessment requirements for the target class.",
      steps: [
        "Fill the application form",
        "Submit the required documents",
        "Pay the application fee",
        "Attend interview or placement assessment if required",
        "Receive admission feedback",
        "Complete enrollment and reporting",
      ],
      requiredDocs: [
        "Passport photo",
        "Previous report card/results slip",
        "Birth certificate or national ID copy",
        "Transfer letter if applicable",
        "Recommendation letter where required",
      ],
      feesRange:
        "UGX 450,000 - 1,200,000 per term depending on class and section",
      paymentOptions:
        "Bank deposit, mobile money, school cash office, approved installment arrangement",
      applicationFeeText: "UGX 50,000",
      officeHours:
        "Monday to Friday, 8:00 AM - 5:00 PM; Saturday, 9:00 AM - 1:00 PM",
    },

    stats: {
      students: 850,
      subjects: SUBJECTS.length,
      staff: 48,
      campuses: 1,
    },

    gallery: [
      galleryItem(
        "https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=1200&auto=format&fit=crop",
        0,
        "Learning spaces",
      ),
      galleryItem(
        "https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=1200&auto=format&fit=crop",
        1,
        "Campus life",
      ),
      galleryItem(
        "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=1200&auto=format&fit=crop",
        2,
        "Graduation day",
      ),
      galleryItem(
        "https://images.unsplash.com/photo-1513258496099-48168024aec0?q=80&w=1200&auto=format&fit=crop",
        3,
        "Focused learners",
      ),
      galleryItem(
        "https://images.unsplash.com/photo-1571260899304-425eee4c7efc?q=80&w=1200&auto=format&fit=crop",
        4,
        "ICT learning",
      ),
      galleryItem(
        "https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?q=80&w=1200&auto=format&fit=crop",
        5,
        "Assessment support",
      ),
    ],

    awards: [
      {
        title: "Best Academic Improvement",
        organization: "District Education Awards",
        year: 2023,
        description:
          "Recognized for strong improvement in student performance and learning outcomes.",
        sort: 0,
      },
      {
        title: "ICT Integration Recognition",
        organization: "Regional Schools Innovation Forum",
        year: 2024,
        description:
          "Awarded for effective use of technology in teaching and learning.",
        sort: 1,
      },
      {
        title: "Outstanding Co-curricular Participation",
        organization: "City Schools Association",
        year: 2024,
        description:
          "Recognized for active participation in debate, sports, and student leadership.",
        sort: 2,
      },
      {
        title: "Community Service Merit",
        organization: "Kampala Youth Outreach Council",
        year: 2025,
        description:
          "Honoured for student-led community service and environmental engagement.",
        sort: 3,
      },
    ],

    announcements: [
      {
        title: "Term Two Admissions Open",
        date: new Date("2026-05-05"),
        body:
          "Applications for Term Two intake are now open. Parents and guardians are welcome to contact the admissions office for guidance.",
        pinned: true,
        sort: 0,
      },
      {
        title: "New Computer Lab Upgrade",
        date: new Date("2026-04-20"),
        body:
          "The school has expanded its ICT learning space to support digital skills, research, and practical lessons.",
        sort: 1,
      },
      {
        title: "Parents Meeting Notice",
        date: new Date("2026-05-25"),
        body:
          "The school will hold a parents and guardians meeting to discuss academic progress, student welfare, and upcoming term activities.",
        sort: 2,
      },
      {
        title: "Inter-house Sports Week",
        date: new Date("2026-06-12"),
        body:
          "Students will participate in athletics, football, netball, and indoor games during Sports Week.",
        sort: 3,
      },
      {
        title: "Science Fair Registration",
        date: new Date("2026-06-30"),
        body:
          "Learners interested in innovation and practical science are encouraged to register for the annual school science fair.",
        sort: 4,
      },
    ],

    faqs: [
      {
        q: "Do you offer both day and boarding sections?",
        a:
          "Yes. The school offers both day and boarding options depending on student needs and available spaces.",
        sort: 1,
      },
      {
        q: "Which curriculum do you follow?",
        a:
          "We follow the national curriculum and support learners with structured academic and co-curricular programs.",
        sort: 2,
      },
      {
        q: "Do you have computer lessons?",
        a:
          "Yes. Students receive ICT exposure through supervised computer-based learning and practical digital skills sessions.",
        sort: 3,
      },
      {
        q: "Can parents visit the school before applying?",
        a:
          "Yes. Parents and guardians are welcome to schedule a visit and speak with the admissions office.",
        sort: 4,
      },
      {
        q: "Do you provide scholarships or bursaries?",
        a:
          "Limited merit-based and need-based support may be available depending on the school's admissions policy each year.",
        sort: 5,
      },
      {
        q: "How can I apply?",
        a:
          "You can apply through the school admissions office or the application link on the public school profile page.",
        sort: 6,
      },
    ],

    reviews: [
      {
        name: "Parent of S. Namusoke",
        rating: 5,
        title: "Supportive learning environment",
        message:
          "The teachers are approachable, the school is organized, and students receive the guidance they need to improve.",
        status: "approved",
        featured: true,
        createdAt: new Date("2026-04-10"),
        approvedAt: new Date("2026-04-10"),
      },
      {
        name: "Guardian of M. Okello",
        rating: 4,
        title: "Good discipline and academics",
        message:
          "We appreciate the balance between strong academics, discipline, and student development.",
        status: "approved",
        featured: false,
        createdAt: new Date("2026-04-14"),
        approvedAt: new Date("2026-04-14"),
      },
      {
        name: "Parent of A. Kato",
        rating: 5,
        title: "Excellent communication",
        message:
          "The school keeps us informed and provides helpful feedback about student progress.",
        status: "approved",
        featured: false,
        createdAt: new Date("2026-04-18"),
        approvedAt: new Date("2026-04-18"),
      },
      {
        name: "Guardian of R. Achieng",
        rating: 4,
        title: "Strong ICT exposure",
        message:
          "We are happy to see students gaining practical digital skills alongside their academics.",
        status: "approved",
        featured: false,
        createdAt: new Date("2026-04-22"),
        approvedAt: new Date("2026-04-22"),
      },
    ],

    ratingSummary: {
      avg: 4.5,
      count: 4,
    },
  };
}

function ensureSettings(tenant) {
  tenant.settings = tenant.settings || {};
  tenant.settings.branding = tenant.settings.branding || {};
  tenant.settings.profile = tenant.settings.profile || {};
  tenant.settings.academics = tenant.settings.academics || {};
  tenant.settings.preferences = tenant.settings.preferences || {};
  tenant.settings.academics.schoolUnits =
    tenant.settings.academics.schoolUnits || [];
}

function selectSchoolUnit(tenant, selector) {
  const units = tenant.settings.academics.schoolUnits;
  const wanted = String(selector || "").trim().toLowerCase();

  if (wanted) {
    const found = units.find((unit) => {
      const values = [
        unit._id,
        unit.code,
        unit.slug,
        unit.name,
      ].map((value) => String(value || "").trim().toLowerCase());

      return values.includes(wanted);
    });

    if (found) return found;
  }

  const active = units.find((unit) => unit.isActive !== false);
  if (active) return active;

  if (units.length) return units[0];

  units.push({
    name: "Classic Academy Secondary School",
    code: "classic-secondary",
    slug: "classic-secondary-school",
    schoolType: "private",
    category: "secondary",
    isActive: true,
    campuses: [],
  });

  return units[units.length - 1];
}

function ensureMainCampus(schoolUnit, branding) {
  schoolUnit.campuses = schoolUnit.campuses || [];

  if (schoolUnit.campuses.length) return;

  schoolUnit.campuses.push({
    name: "Main Campus",
    code: "main",
    city: "Kampala",
    district: "Kampala",
    country: "Uganda",
    address: "Plot 24, Education Road",
    contactPhone: "+256700123456",
    contactEmail: "info@classicacademy.sch.ug",
    isMain: true,
    isActive: true,
    branding: clone(branding),
    profile: {
      shortName: "Classic Academy",
      tagline: "Building disciplined, confident, and future-ready learners.",
      about:
        "A safe and supportive learning campus for academics, leadership, and student growth.",
      phone: "+256700123456",
      email: "info@classicacademy.sch.ug",
      admissionsEmail: "admissions@classicacademy.sch.ug",
    },
    levels: [
      {
        name: "Lower Secondary",
        code: "lower-secondary",
        isActive: true,
        profile: {
          title: "Lower Secondary",
          curriculum: "Uganda National Curriculum",
          description:
            "Foundational learning across core subjects, practical skills, and guided learner support.",
        },
        sections: [
          { name: "Senior One", code: "s1", isActive: true },
          { name: "Senior Two", code: "s2", isActive: true },
          { name: "Senior Three", code: "s3", isActive: true },
        ],
      },
      {
        name: "Upper Secondary",
        code: "upper-secondary",
        isActive: true,
        profile: {
          title: "Upper Secondary",
          curriculum: "Uganda National Curriculum",
          description:
            "Focused preparation for national examinations, subject mastery, and future pathways.",
        },
        sections: [
          { name: "Senior Four", code: "s4", isActive: true },
          { name: "Senior Five", code: "s5", isActive: true },
          { name: "Senior Six", code: "s6", isActive: true },
        ],
      },
    ],
  });
}

async function run() {
  await waitForPlatform();

  const tenant = await Tenant.findOne({
    code: TENANT_CODE,
    isDeleted: { $ne: true },
  });

  if (!tenant) {
    throw new Error(`No active tenant found with code "${TENANT_CODE}".`);
  }

  ensureSettings(tenant);

  const profile = buildProfile();
  const branding = buildBranding();
  const schoolUnit = selectSchoolUnit(tenant, SCHOOL_UNIT_SELECTOR);

  tenant.name = "Classic Academy Secondary School";
  tenant.settings.branding = clone(branding);
  tenant.settings.profile = clone(profile);
  tenant.settings.academics.institutionType = "school";
  tenant.settings.academics.schoolModel = "day-boarding";
  tenant.settings.academics.extraSubjects = SUBJECTS;
  tenant.settings.preferences.allowPublicProfile = true;
  tenant.settings.preferences.allowReviews = true;
  tenant.settings.preferences.showContactForm = true;
  tenant.settings.preferences.showGallery = true;

  if (schoolUnit) {
    schoolUnit.name = "Classic Academy Secondary School";
    schoolUnit.code = schoolUnit.code || "classic-secondary";
    schoolUnit.slug = schoolUnit.slug || slugify(schoolUnit.code || schoolUnit.name);
    schoolUnit.schoolType = "private";
    schoolUnit.category = "secondary";
    schoolUnit.isActive = true;
    schoolUnit.profile = clone(profile);
    schoolUnit.branding = clone(branding);
    ensureMainCampus(schoolUnit, branding);
  }

  tenant.meta = tenant.meta || {};
  tenant.meta.onboardingCompleted = true;
  tenant.meta.lastProfileUpdateAt = new Date();
  tenant.meta.lastPublicContentUpdateAt = new Date();

  tenant.markModified("settings.branding");
  tenant.markModified("settings.profile");
  tenant.markModified("settings.academics");
  tenant.markModified("settings.preferences");
  tenant.markModified("meta");

  await tenant.save();

  const unitId = schoolUnit?._id ? String(schoolUnit._id) : "";
  console.log(`Seeded profile for tenant: ${tenant.code}`);
  console.log(`School unit: ${schoolUnit?.name || "none"}${unitId ? ` (${unitId})` : ""}`);
  console.log(`Subjects available on profile: ${SUBJECTS.length}`);
  console.log(
    `Preview path: /schools/${tenant.code}${unitId ? `?schoolUnitId=${unitId}` : ""}`,
  );
}

run()
  .catch((err) => {
    console.error("Profile seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await platformConnection.close().catch(() => {});
  });

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { platformConnection, waitForPlatform } = require("../src/config/db");
const Plan = require("../src/models/platform/Plan")(platformConnection);

const FREE_PROFILE_MODULES = [
  "Setting",
  "Announcement",
  "SchoolFAQ",
  "SchoolInquiry",
  "SchoolReview",
  "Program",
];

const STARTER_EXTRA = [
  "User",
  "Applicant",
  "Student",
  "Staff",
  "Class",
  "TimetableEntry",
  "Attendance",
  "Result",
  "StudentDoc",
  "Notification",
  "NotificationPreference",
];

const STANDARD_EXTRA = [
  "InviteToken",
  "Exam",
  "Course",
  "Transcript",
  "Enrollment",
  "Parent",
  "Invoice",
  "Payment",
  "LibraryBook",
  "Hostel",
  "Event",
  "ReportExport",
  "PromotionLog",
  "DisciplineCase",
];

const PREMIUM_EXTRA = [
  "FeeStructure",
  "Scholarship",
  "ScholarshipApplication",
  "OfferLetterTemplate",
  "AdmissionRequirement",
  "OfferLetter",
  "PayrollRun",
  "PayrollItem",
  "LeaveRequest",
  "StaffRole",
  "Department",
  "Faculty",
  "Asset",
];

function uniqueModules(...groups) {
  return [...new Set(groups.flat().filter(Boolean))];
}

const PLANS = [
  {
    name: "School Profile Package",
    code: "school-profile",
    description: "Standalone online presence + admissions basics",
    billingModel: "school_only",
    pricePerSchool: 0,
    pricePerStudent: 0,
    platformSharePercent: 0,
    currency: "USD",
    billingInterval: "yearly",
    trialDays: 0,
    maxStudents: 0,
    maxStaff: 0,
    maxCampuses: 1,
    enabledModules: uniqueModules(FREE_PROFILE_MODULES),
    sortOrder: 1,
    isPublic: true,
    isActive: true,
    featureFlags: {
      customDomain: false,
      apiAccess: false,
      prioritySupport: false,
      whiteLabel: false,
      advancedReports: false,
    },
  },
  {
    name: "Starter",
    code: "starter",
    description: "Up to 300 users • 15 features / term",
    billingModel: "school_only",
    pricePerSchool: 200,
    pricePerStudent: 0,
    platformSharePercent: 0,
    currency: "USD",
    billingInterval: "termly",
    trialDays: 0,
    maxStudents: 300,
    maxStaff: 50,
    maxCampuses: 1,
    enabledModules: uniqueModules(FREE_PROFILE_MODULES, STARTER_EXTRA),
    sortOrder: 2,
    isPublic: true,
    isActive: true,
    featureFlags: {
      customDomain: false,
      apiAccess: false,
      prioritySupport: false,
      whiteLabel: false,
      advancedReports: false,
    },
  },
  {
    name: "Standard",
    code: "standard",
    description: "Up to 750 users • 35 features / term",
    billingModel: "school_only",
    pricePerSchool: 350,
    pricePerStudent: 0,
    platformSharePercent: 0,
    currency: "USD",
    billingInterval: "termly",
    trialDays: 0,
    maxStudents: 750,
    maxStaff: 120,
    maxCampuses: 1,
    enabledModules: uniqueModules(FREE_PROFILE_MODULES, STARTER_EXTRA, STANDARD_EXTRA),
    sortOrder: 3,
    isPublic: true,
    isActive: true,
    featureFlags: {
      customDomain: false,
      apiAccess: false,
      prioritySupport: false,
      whiteLabel: false,
      advancedReports: false,
    },
  },
  {
    name: "Growth",
    code: "growth",
    description: "Up to 900 users • approvals + deeper analytics",
    billingModel: "school_only",
    pricePerSchool: 425,
    pricePerStudent: 0,
    platformSharePercent: 0,
    currency: "USD",
    billingInterval: "termly",
    trialDays: 0,
    maxStudents: 900,
    maxStaff: 160,
    maxCampuses: 1,
    enabledModules: uniqueModules(FREE_PROFILE_MODULES, STARTER_EXTRA, STANDARD_EXTRA),
    sortOrder: 4,
    isPublic: true,
    isActive: true,
    featureFlags: {
      customDomain: true,
      apiAccess: false,
      prioritySupport: true,
      whiteLabel: false,
      advancedReports: true,
    },
  },
  {
    name: "Premium",
    code: "premium",
    description: "1000+ users • Up to 70 features / term",
    billingModel: "school_only",
    pricePerSchool: 500,
    pricePerStudent: 0,
    platformSharePercent: 0,
    currency: "USD",
    billingInterval: "termly",
    trialDays: 0,
    maxStudents: 1000,
    maxStaff: 300,
    maxCampuses: 3,
    enabledModules: uniqueModules(FREE_PROFILE_MODULES, STARTER_EXTRA, STANDARD_EXTRA, PREMIUM_EXTRA),
    sortOrder: 5,
    isPublic: true,
    isActive: true,
    featureFlags: {
      customDomain: true,
      apiAccess: true,
      prioritySupport: true,
      whiteLabel: true,
      advancedReports: true,
    },
  },
];

async function run() {
  await waitForPlatform();

  for (const item of PLANS) {
    await Plan.findOneAndUpdate(
      { code: item.code },
      { $set: item },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`✅ seeded ${item.code}`);
  }

  console.log("Done.");
  await platformConnection.close();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("❌ Seed failed:", err);
  try {
    await platformConnection.close();
  } catch (_) {}
  process.exit(1);
});
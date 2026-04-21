const express = require("express");
const router = express.Router();

const adminBellNotifications = require("../../../middleware/tenant/adminBellNotifications");
const requireTenantAuth = require("../../../middleware/tenant/requireTenantAuth");
const setLocals = require("../../../middleware/tenant/setLocals");

const resolveTenantAccess = require("../../../middleware/tenant/resolveTenantAccess");
const requireTenantModule = require("../../../middleware/tenant/requireTenantModule");
const requireTenantFeature = require("../../../middleware/tenant/requireTenantFeature");

// Resolve tenant + plan access first
router.use(resolveTenantAccess);

// Protect ALL admin routes
router.use(requireTenantAuth("admin"));
router.use(setLocals);
router.use(adminBellNotifications);

// Default admin landing
router.get("/", (req, res) => res.redirect("/admin/dashboard"));
router.get("/applicants", (req, res) => res.redirect("/admin/admissions/applicants"));
router.get("/intakes", (req, res) => res.redirect("/admin/admissions/intakes"));
router.get("/requirements", (req, res) => res.redirect("/admin/admissions/requirements"));
router.get("/offer-letters", (req, res) => res.redirect("/admin/admissions/offer-letters"));

// Dashboard
router.use("/", require("./dashboard"));

/* =========================================================
   ACADEMICS
========================================================= */
router.use("/admissions", requireTenantModule("Applicant"), require("./admissions"));
router.use("/students", requireTenantModule("Student"), require("./students"));
router.use("/parents", requireTenantModule("Parent"), require("./parents"));
router.use("/promotions", requireTenantModule("PromotionLog"), require("./promotions"));

router.use("/subjects", requireTenantModule("Subject"), require("./subjects"));
router.use("/classes", requireTenantModule("Class"), require("./classes"));
router.use("/sections", requireTenantModule("Section"), require("./sections")); 
router.use("/streams", requireTenantModule("Stream"), require("./streams"));

router.use("/exams", requireTenantModule("Exam"), require("./exams"));
router.use("/results", requireTenantModule("Result"), require("./results"));
router.use("/transcripts", requireTenantModule("Transcript"), require("./transcripts"));
router.use("/assignments", requireTenantModule("Assignment"), require("./assignments"));
router.use("/attendance", requireTenantModule("Attendance"), require("./attendance"));
router.use("/timetable", requireTenantModule("TimetableEntry"), require("./timetable"));
router.use("/academic-calendar", requireTenantModule("AcademicEvent"), require("./academicCalendar"));

/* =========================================================
   FINANCE
========================================================= */
router.use("/finance", requireTenantModule("Payment"), require("./finance"));
router.use("/invoices", requireTenantModule("Invoice"), require("./invoices"));
router.use("/payments", requireTenantModule("Payment"), require("./payments"));
router.use("/student-statements", requireTenantModule("Payment"), require("./studentStatements"));
router.use("/fees", requireTenantModule("FeeStructure"), require("./feeStructures"));
router.use("/fee-structures", requireTenantModule("FeeStructure"), require("./feeStructures"));
router.use("/scholarships", requireTenantModule("Scholarship"), require("./scholarships"));
router.use("/finance-reports", requireTenantModule("Payment"), require("./financeReports"));
router.use("/expenses", requireTenantModule("Payment"), require("./expenses"));

/* =========================================================
   STAFF & HR
========================================================= */
router.use("/staff", requireTenantModule("Staff"), require("./staff"));
router.use("/users", requireTenantModule("User"), require("./users"));
router.use("/roles", requireTenantModule("StaffRole"), require("./roles"));
router.use("/staff-leave", requireTenantModule("LeaveRequest"), require("./leave"));
router.use(
  "/payroll",
  (req, res, next) => {
    const modules = res.locals?.tenantAccess?.modules || [];
    if (modules.includes("PayrollRun") || modules.includes("PayrollItem")) return next();
    return requireTenantModule("LeaveRequest")(req, res, next);
  },
  require("./payroll")
);

/* =========================================================
   STUDENT SUPPORT & RECORDS
========================================================= */
router.use("/student-docs", requireTenantModule("StudentDoc"), require("./studentDocs"));
router.use("/discipline", requireTenantModule("DisciplineCase"), require("./discipline"));
router.use("/notifications", requireTenantModule("Notification"), require("./notifications"));
router.use("/announcements", requireTenantModule("Announcement"), require("./announcements"));

/* =========================================================
   CAMPUS OPERATIONS
========================================================= */
router.use("/library", requireTenantModule("LibraryBook"), require("./library"));
router.use("/hostels", requireTenantModule("Hostel"), require("./hostels"));
router.use("/transport", requireTenantModule("Transport"), require("./transport"));
router.use("/assets", requireTenantModule("Asset"), require("./assets"));
router.use("/events", requireTenantModule("Event"), require("./events"));

/* =========================================================
   REPORTING & ANALYTICS
========================================================= */
router.use("/reports", requireTenantModule("ReportExport"), require("./reports"));
router.use("/analytics", requireTenantFeature("advancedReports"), require("./analytics"));

/* =========================================================
   COMMUNICATION & SUPPORT
========================================================= */
router.use("/messaging", requireTenantModule("Notification"), require("./messaging"));
router.use("/tickets", requireTenantFeature("helpdesk"), require("./helpdesk"));
router.use("/inquiries", require("./inquiries"));

/* =========================================================
   SYSTEM / ADMIN TOOLS
========================================================= */
router.use("/auditlogs", require("./auditlogs"));
router.use("/backups", requireTenantFeature("backups"), require("./backup"));
router.use("/system", requireTenantFeature("systemHealth"), require("./system-health"));
router.use("/profile", require("./profile"));
router.use("/settings", requireTenantModule("Setting"), require("./settings"));

/* =========================================================
   API / INTEGRATIONS
========================================================= */
router.use(
  "/integrations",
  requireTenantFeature("apiAccess", { mode: "json" }),
  require("./api-integrations")
);

router.use(
  "/api",
  requireTenantFeature("apiAccess", { mode: "json" }),
  require("./api")
);

module.exports = router;

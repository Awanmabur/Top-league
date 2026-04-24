const express = require("express");
const router = express.Router();

const adminBellNotifications = require("../../../middleware/tenant/adminBellNotifications");
const auditAdminActions = require("../../../middleware/tenant/auditAdminActions");
const requireTenantAuth = require("../../../middleware/tenant/requireTenantAuth");
const requireTenantPermission = require("../../../middleware/tenant/requireTenantPermission");
const setLocals = require("../../../middleware/tenant/setLocals");

const resolveTenantAccess = require("../../../middleware/tenant/resolveTenantAccess");
const requireTenantModule = require("../../../middleware/tenant/requireTenantModule");
const requireTenantFeature = require("../../../middleware/tenant/requireTenantFeature");
const { ADMIN_PORTAL_ROLES } = require("../../../utils/tenantRoles");

// Resolve tenant + plan access first
router.use(resolveTenantAccess);

// Protect ALL admin routes
router.use(requireTenantAuth(ADMIN_PORTAL_ROLES));
router.use(setLocals);
router.use(adminBellNotifications);
router.use(auditAdminActions);

// Default admin landing
router.get("/", (req, res) => res.redirect("/admin/dashboard"));
router.get("/audit-log", (req, res) => res.redirect("/admin/auditlogs"));
router.get("/applications", (req, res) => res.redirect("/admin/admissions/applicants"));
router.get("/applications/export/csv", (req, res) => res.redirect("/admin/admissions/applicants/export"));
router.get("/applications/:id", (req, res) => res.redirect(`/admin/admissions/applicants/${req.params.id}`));
router.get("/system-health", (req, res) => res.redirect("/admin/system"));
router.get("/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  return res.redirect(q ? `/admin/students?q=${encodeURIComponent(q)}` : "/admin/students");
});
router.get("/applicants", (req, res) => res.redirect("/admin/admissions/applicants"));
router.get("/intakes", (req, res) => res.redirect("/admin/admissions/intakes"));
router.get("/requirements", (req, res) => res.redirect("/admin/admissions/requirements"));
router.get("/offer-letters", (req, res) => res.redirect("/admin/admissions/offer-letters"));

// Dashboard
router.use("/", requireTenantPermission("dashboard.view"), require("./dashboard"));

/* =========================================================
   ACADEMICS
========================================================= */
router.use("/admissions", requireTenantPermission("admissions.view"), requireTenantModule("Applicant"), require("./admissions"));
router.use("/students", requireTenantPermission("students.view"), requireTenantModule("Student"), require("./students"));
router.use("/parents", requireTenantPermission("parents.view"), requireTenantModule("Parent"), require("./parents"));
router.use("/promotions", requireTenantPermission("promotions.view"), requireTenantModule("PromotionLog"), require("./promotions"));

router.use("/subjects", requireTenantPermission("subjects.view"), requireTenantModule("Subject"), require("./subjects"));
router.use("/classes", requireTenantPermission("classes.view"), requireTenantModule("Class"), require("./classes"));
router.use("/sections", requireTenantPermission("sections.view"), requireTenantModule("Section"), require("./sections")); 
router.use("/streams", requireTenantPermission("streams.view"), requireTenantModule("Stream"), require("./streams"));

router.use("/exams", requireTenantPermission("exams.view"), requireTenantModule("Exam"), require("./exams"));
router.use("/results", requireTenantPermission("results.view"), requireTenantModule("Result"), require("./results"));
router.use("/transcripts", requireTenantPermission("transcripts.view"), requireTenantModule("Transcript"), require("./transcripts"));
router.use("/assignments", requireTenantPermission("assignments.view"), requireTenantModule("Assignment"), require("./assignments"));
router.use("/attendance", requireTenantPermission("attendance.view"), requireTenantModule("Attendance"), require("./attendance"));
router.use("/timetable", requireTenantPermission("timetable.view"), requireTenantModule("TimetableEntry"), require("./timetable"));
router.use("/academic-calendar", requireTenantPermission("academicCalendar.view"), requireTenantModule("AcademicEvent"), require("./academicCalendar"));

/* =========================================================
   FINANCE
========================================================= */
router.use("/finance", requireTenantPermission("finance.view"), requireTenantModule("Payment"), require("./finance"));
router.use("/invoices", requireTenantPermission("finance.view"), requireTenantModule("Invoice"), require("./invoices"));
router.use("/payments", requireTenantPermission("finance.view"), requireTenantModule("Payment"), require("./payments"));
router.use("/student-statements", requireTenantPermission("finance.view"), requireTenantModule("Payment"), require("./studentStatements"));
router.use("/fees", requireTenantPermission("finance.view"), requireTenantModule("FeeStructure"), require("./feeStructures"));
router.use("/fee-structures", requireTenantPermission("finance.view"), requireTenantModule("FeeStructure"), require("./feeStructures"));
router.use("/scholarships", requireTenantPermission("finance.view"), requireTenantModule("Scholarship"), require("./scholarships"));
router.use("/finance-reports", requireTenantPermission("finance.view"), requireTenantModule("Payment"), require("./financeReports"));
router.use("/expenses", requireTenantPermission("finance.view"), requireTenantModule("Payment"), require("./expenses"));

/* =========================================================
   STAFF & HR
========================================================= */
router.use("/staff", requireTenantAuth("admin"), requireTenantModule("Staff"), require("./staff"));
router.use("/users", requireTenantAuth("admin"), requireTenantModule("User"), require("./users"));
router.use("/roles", requireTenantAuth("admin"), requireTenantModule("StaffRole"), require("./roles"));
router.use("/staff-leave", requireTenantAuth("admin"), requireTenantModule("LeaveRequest"), require("./leave"));
router.use(
  "/payroll",
  requireTenantAuth("admin"),
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
router.use("/student-docs", requireTenantPermission("studentDocs.view"), requireTenantModule("StudentDoc"), require("./studentDocs"));
router.use("/discipline", requireTenantPermission("discipline.view"), requireTenantModule("DisciplineCase"), require("./discipline"));
router.use("/notifications", requireTenantPermission("notifications.view"), requireTenantModule("Notification"), require("./notifications"));
router.use("/announcements", requireTenantPermission("announcements.view"), requireTenantModule("Announcement"), require("./announcements"));

/* =========================================================
   CAMPUS OPERATIONS
========================================================= */
router.use("/library", requireTenantPermission("library.view"), requireTenantModule("LibraryBook"), require("./library"));
router.use("/hostels", requireTenantPermission("hostels.view"), requireTenantModule("Hostel"), require("./hostels"));
router.use("/transport", requireTenantAuth("admin"), requireTenantModule("Transport"), require("./transport"));
router.use("/assets", requireTenantAuth("admin"), requireTenantModule("Asset"), require("./assets"));
router.use("/events", requireTenantAuth("admin"), requireTenantModule("Event"), require("./events"));

/* =========================================================
   REPORTING & ANALYTICS
========================================================= */
router.use("/reports", requireTenantPermission("reports.view"), requireTenantModule("ReportExport"), require("./reports"));
router.use("/analytics", requireTenantPermission("reports.view"), requireTenantFeature("advancedReports"), require("./analytics"));

/* =========================================================
   COMMUNICATION & SUPPORT
========================================================= */
router.use("/messaging", requireTenantPermission("messaging.view"), requireTenantModule("Notification"), require("./messaging"));
router.use("/tickets", requireTenantAuth("admin"), requireTenantFeature("helpdesk"), require("./helpdesk"));
router.use("/helpdesk", requireTenantAuth("admin"), requireTenantFeature("helpdesk"), require("./helpdesk"));
router.use("/inquiries", requireTenantPermission("inquiries.view"), require("./inquiries"));

/* =========================================================
   SYSTEM / ADMIN TOOLS
========================================================= */
router.use("/auditlogs", requireTenantAuth("admin"), require("./auditlogs"));
router.use("/backups", requireTenantAuth("admin"), requireTenantFeature("backups"), require("./backup"));
router.use("/system", requireTenantAuth("admin"), requireTenantFeature("systemHealth"), require("./system-health"));
router.use("/profile", requireTenantPermission("profile.view"), require("./profile"));
router.use("/settings", requireTenantAuth("admin"), requireTenantModule("Setting"), require("./settings"));

/* =========================================================
   API / INTEGRATIONS
========================================================= */
router.use(
  "/integrations",
  requireTenantAuth("admin"),
  requireTenantFeature("apiAccess", { mode: "json" }),
  require("./api-integrations")
);

router.use(
  "/api",
  requireTenantAuth("admin"),
  requireTenantFeature("apiAccess", { mode: "json" }),
  require("./api")
);

module.exports = router;

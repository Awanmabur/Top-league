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
const requireTenantModels = require("../../../middleware/tenant/requireTenantModels");
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
router.get("/backup", (req, res) => res.redirect("/admin/backups"));
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
router.use("/admissions", requireTenantPermission("admissions.view"), requireTenantModels(["Applicant", "Intake", "AdmissionRequirement", "OfferLetter", "OfferLetterTemplate", "Section"], { match: "all" }), require("./admissions"));
router.use("/students", requireTenantPermission("students.view"), requireTenantModule("Student"), require("./students"));
router.use("/parents", requireTenantPermission("parents.view"), requireTenantModule("Parent"), require("./parents"));
router.use("/promotions", requireTenantPermission("promotions.view"), requireTenantModule("PromotionLog"), require("./promotions"));

router.use("/subjects", requireTenantPermission("subjects.view"), requireTenantModels(["Subject", "Class", "Section", "Stream"], { match: "all" }), requireTenantModels(["Student", "CourseRegistration", "RegistrationWindow", "StudentHold"], { match: "all" }), require("./subjects"));
router.use("/programs", requireTenantPermission("subjects.view"), requireTenantModels(["Program"], { match: "all" }), require("./programs"));
router.use("/classes", requireTenantPermission("classes.view"), requireTenantModels(["Class", "Student", "Section", "Stream", "Subject"], { match: "all" }), require("./classes"));
router.use("/sections", requireTenantPermission("sections.view"), requireTenantModels(["Section", "Class", "Student", "Stream", "Subject"], { match: "all" }), require("./sections")); 
router.use("/streams", requireTenantPermission("streams.view"), requireTenantModels(["Stream", "Class", "Section", "Student", "Subject"], { match: "all" }), require("./streams"));

router.use("/exams", requireTenantPermission("exams.view"), requireTenantModels(["Exam", "Result", "Class", "Section", "Stream", "Subject", "Staff", "Student", "Notification"], { match: "all" }), require("./exams"));
router.use("/results", requireTenantPermission("results.view"), requireTenantModels(["Result", "Exam", "Student", "Class", "Section", "Stream", "Subject"], { match: "all" }), require("./results"));
router.use("/transcripts", requireTenantPermission("transcripts.view"), requireTenantModels(["Transcript", "Student", "Result", "Class", "Section", "Stream", "Subject"], { match: "all" }), requireTenantModels(["LetterRequest", "Invoice"], { match: "all" }), require("./transcripts"));
router.use("/assignments", requireTenantPermission("assignments.view"), requireTenantModels(["Assignment", "AssignmentSubmission", "Subject", "Class", "Section", "Stream", "Student", "Notification"], { match: "all" }), require("./assignments"));
router.use("/attendance", requireTenantPermission("attendance.view"), requireTenantModels(["Attendance", "Student", "Subject", "Class", "Section", "Stream", "Staff", "Notification", "Parent"], { match: "all" }), require("./attendance"));
router.use("/timetable", requireTenantPermission("timetable.view"), requireTenantModels(["TimetableEntry", "TimetableMutationLock", "Class", "Section", "Stream", "Subject", "Staff", "Student", "Notification"], { match: "all" }), requireTenantModels(["Classroom"], { match: "all" }), require("./timetable"));
router.use("/academic-calendar", requireTenantPermission("academicCalendar.view"), requireTenantModels(["AcademicEvent", "Class", "Section", "Stream", "Student", "Notification"], { match: "all" }), require("./academicCalendar"));

/* =========================================================
   FINANCE
========================================================= */
router.use("/finance", requireTenantPermission("finance.view"), requireTenantModels(["Invoice", "Payment"], { match: "all" }), requireTenantModels(["Program"], { match: "all" }), require("./finance"));
router.use("/invoices", requireTenantPermission("finance.view"), requireTenantModels(["Invoice", "Payment"], { match: "all" }), requireTenantModels(["Program"], { match: "all" }), require("./invoices"));
router.use("/payments", requireTenantPermission("finance.view"), requireTenantModels(["Invoice", "Payment"], { match: "all" }), requireTenantModels(["Program"], { match: "all" }), require("./payments"));
router.use("/student-statements", requireTenantPermission("finance.view"), requireTenantModels(["Student", "Invoice", "Payment", "Program", "ReportExport"], { match: "all" }), require("./studentStatements"));
router.use("/fees", requireTenantPermission("finance.view"), requireTenantModule("FeeStructure"), requireTenantModels(["FeeStructure"], { match: "all" }), requireTenantModels(["Program"], { match: "all" }), require("./feeStructures"));
router.use("/fee-structures", requireTenantPermission("finance.view"), requireTenantModule("FeeStructure"), requireTenantModels(["FeeStructure"], { match: "all" }), requireTenantModels(["Program"], { match: "all" }), require("./feeStructures"));
router.use("/scholarships", requireTenantPermission("finance.view"), requireTenantModule("Scholarship"), requireTenantModels(["Program"], { match: "all" }), require("./scholarships"));
router.use("/finance-reports", requireTenantPermission("finance.view"), requireTenantModels(["Student", "Invoice", "Payment", "Program", "ReportExport"], { match: "all" }), require("./financeReports"));
router.use("/expenses", requireTenantPermission("finance.view"), requireTenantModule("Expense"), require("./expenses"));

/* =========================================================
   STAFF & HR
========================================================= */
router.use("/departments", requireTenantPermission("staff.view"), requireTenantModels(["Department"], { match: "all" }), require("./departments"));
router.use("/staff", requireTenantPermission("staff.view"), requireTenantModule("Staff"), requireTenantModels(["Department"], { match: "all" }), require("./staff"));
router.use("/users", requireTenantPermission("users.view"), requireTenantModule("User"), requireTenantModels(["User", "InviteToken", "Student", "Staff", "Parent"], { match: "all" }), require("./users"));
router.use("/roles", requireTenantPermission("roles.view"), requireTenantModule("StaffRole"), require("./roles"));
router.use("/staff-leave", requireTenantPermission("staff.view"), requireTenantModels(["Staff", "LeaveRequest"], { match: "all" }), requireTenantModels(["Department"], { match: "all" }), require("./leave"));
router.use(
  "/payroll",
  requireTenantPermission("payroll.view"),
  requireTenantModels(["PayrollRun", "PayrollItem", "Staff", "Expense"], { match: "all" }),
  requireTenantModels(["Department"], { match: "all" }),
  require("./payroll")
);

/* =========================================================
   STUDENT SUPPORT & RECORDS
========================================================= */
router.use("/student-docs", requireTenantPermission("studentDocs.view"), requireTenantModels(["StudentDoc", "Student", "Applicant", "Notification"], { match: "all" }), require("./studentDocs"));
router.use("/discipline", requireTenantPermission("discipline.view"), requireTenantModels(["DisciplineCase", "Student", "Notification"], { match: "all" }), require("./discipline"));
router.use("/notifications", requireTenantPermission("notifications.view"), requireTenantModule("Notification"), requireTenantModels(["Notification", "NotificationReceipt", "NotificationPreference"], { match: "all" }), require("./notifications"));
router.use("/announcements", requireTenantPermission("announcements.view"), requireTenantModule("Announcement"), require("./announcements"));

/* =========================================================
   CAMPUS OPERATIONS
========================================================= */
router.use("/library", requireTenantPermission("library.view"), requireTenantModels(["LibraryBook", "LibraryLoan", "LibraryReservation", "LibraryFine", "LibraryHold"], { match: "all" }), require("./library"));
router.use("/hostels", requireTenantPermission("hostels.view"), requireTenantModels(["Hostel", "HostelAllocation", "HostelApplication"], { match: "all" }), require("./hostels"));
router.use("/transport", requireTenantAuth("admin"), requireTenantModels(["Transport", "TransportAssignment", "Student", "Notification"], { match: "all" }), require("./transport"));
router.use("/assets", requireTenantAuth("admin"), requireTenantModels(["Asset", "AssetMaintenance", "Student", "Staff"], { match: "all" }), require("./assets"));
router.use("/facilities", requireTenantAuth("admin"), requireTenantModels(["Classroom", "TimetableEntry"], { match: "all" }), require("./facilities"));
router.use("/events", requireTenantAuth("admin"), requireTenantModule("Event"), require("./events"));

/* =========================================================
   REPORTING & ANALYTICS
========================================================= */
router.use("/reports", requireTenantPermission("reports.view"), requireTenantModels(["ReportExport", "Student", "Applicant", "Invoice", "Payment", "Subject"], { match: "all" }), requireTenantModels(["Program", "Section"], { match: "all" }), require("./reports"));
router.use("/analytics", requireTenantPermission("reports.view"), requireTenantFeature("advancedReports"), requireTenantModels(["Student", "Applicant", "Invoice", "Payment", "Section"], { match: "all" }), requireTenantModels(["ReportExport", "Class", "Attendance", "Result"], { match: "all" }), require("./analytics"));

/* =========================================================
   COMMUNICATION & SUPPORT
========================================================= */
router.use("/messaging", requireTenantPermission("messaging.view"), requireTenantModule("Message"), requireTenantModule("Notification"), require("./messaging"));
router.use("/tickets", requireTenantAuth("admin"), requireTenantFeature("helpdesk"), require("./helpdesk"));
router.use("/helpdesk", requireTenantAuth("admin"), requireTenantFeature("helpdesk"), require("./helpdesk"));
router.use("/inquiries", requireTenantPermission("inquiries.view"), requireTenantModels(["SchoolInquiry"], { match: "all" }), require("./inquiries"));
router.use("/jobs", requireTenantAuth("admin"), requireTenantModels(["JobOpportunity", "JobApplication", "Student"], { match: "all" }), require("./jobs"));

/* =========================================================
   SYSTEM / ADMIN TOOLS
========================================================= */
router.use("/auditlogs", requireTenantPermission("auditlogs.view"), requireTenantModels(["AuditLog"], { match: "all" }), require("./auditlogs"));
router.use("/backups", requireTenantPermission("backups.manage"), requireTenantFeature("backups"), requireTenantModels(["BackupJob"], { match: "all" }), require("./backup"));
router.use("/system", requireTenantPermission("system.manage"), requireTenantFeature("systemHealth"), requireTenantModels(["SystemHealth"], { match: "all" }), require("./system-health"));
router.use("/profile", requireTenantPermission("profile.view"), require("./profile"));
router.use("/settings", requireTenantAuth("admin"), requireTenantModule("Setting"), require("./settings"));

/* =========================================================
   API / INTEGRATIONS
========================================================= */
router.use(
  "/integrations",
  requireTenantAuth("admin"),
  requireTenantFeature("apiAccess"),
  requireTenantModels(["ApiIntegration"], { match: "all" }),
  require("./api-integrations")
);

router.use(
  "/api",
  requireTenantAuth("admin"),
  requireTenantFeature("apiAccess"),
  require("./api")
);

module.exports = router;

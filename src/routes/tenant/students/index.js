const express = require("express");
const router = express.Router();

const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");
const requireTenantFeature = require("../../../middleware/tenant/requireTenantFeature");
const requireTenantModels = require("../../../middleware/tenant/requireTenantModels");
const resolveTenantAccess = require("../../../middleware/tenant/resolveTenantAccess");
const setLocals = require("../../../middleware/tenant/setLocals");

// Protect ALL /student routes
router.use(resolveTenantAccess);
router.use(tenantAuth("student"));
router.use(setLocals);

// Sub routes
router.use("/", require("./dashboard"));
router.use("/", require("./profile"));
router.use("/", requireTenantModels(["Subject", "CourseRegistration"], { match: "any" }), requireTenantModels(["Subject", "CourseRegistration"], { match: "all" }), require("./subjects"));
router.use("/", requireTenantModels(["TimetableEntry", "Student", "Subject", "Staff", "Exam"], { match: "all" }), require("./timetable"));
router.use("/", requireTenantModels(["AcademicEvent", "Student"], { match: "all" }), require("./calendar"));
router.use("/", requireTenantModels(["DisciplineCase", "Student"], { match: "all" }), require("./discipline"));
router.use("/", requireTenantModels(["StudentDoc", "Student"], { match: "all" }), require("./documents"));
router.use("/", requireTenantModels(["Attendance", "Student", "Subject"], { match: "all" }), require("./attendance"));
router.use("/", requireTenantModels(["Assignment", "AssignmentSubmission", "Student", "Subject"], { match: "all" }), require("./assignments"));
router.use("/", requireTenantModels(["Exam", "Student", "Class", "Subject"], { match: "all" }), require("./exams"));
router.use("/", requireTenantModels(["Student", "Result", "Exam", "Subject"], { match: "all" }), require("./results"));
router.use("/", requireTenantModels(["Student", "Transcript", "Result", "Exam", "Subject"], { match: "all" }), requireTenantModels(["LetterRequest", "Invoice"], { match: "all" }), require("./transcript"));
router.use("/", requireTenantModels(["Student", "Subject", "CourseRegistration", "RegistrationWindow", "StudentHold"], { match: "all" }), require("./subjectSelection"));
router.use("/", requireTenantModels(["Invoice", "Payment"], { match: "all" }), require("./finance"));
router.use("/", requireTenantModels(["Hostel", "HostelAllocation", "HostelApplication"], { match: "all" }), require("./hostel"));
router.use("/", requireTenantModels(["Transport", "TransportAssignment", "Student"], { match: "all" }), require("./transport"));
router.use("/", requireTenantModels(["Asset", "Student"], { match: "all" }), require("./assets"));
router.use("/", requireTenantModels(["LibraryBook", "LibraryLoan", "LibraryReservation", "LibraryFine", "LibraryHold"], { match: "all" }), require("./library"));
router.use("/", requireTenantModels(["Student", "JobOpportunity", "JobApplication"], { match: "all" }), require("./jobs"));
router.use("/", requireTenantModels(["Notification", "Announcement"], { match: "any" }), require("./notifications"));
router.use("/", requireTenantFeature("helpdesk"), requireTenantModels(["HelpdeskTicket"], { match: "all" }), require("./support"));
router.use("/", requireTenantModels(["Event", "EventRegistration", "EventSubscription", "EventView"], { match: "all" }), require("./events"));

module.exports = router;

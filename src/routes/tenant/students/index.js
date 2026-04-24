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
router.use("/", requireTenantModels(["Subject", "CourseRegistration"], { match: "any" }), require("./subjects"));
router.use("/", requireTenantModels(["Timetable", "TimetableEntry", "ClassTimetable", "Schedule"], { match: "any" }), require("./timetable"));
router.use("/", requireTenantModels(["Attendance"], { match: "any" }), require("./attendance"));
router.use("/", requireTenantModels(["Assignment"], { match: "any" }), require("./assignments"));
router.use("/", requireTenantModels(["Exam"], { match: "any" }), require("./exams"));
router.use("/", requireTenantModels(["Result"], { match: "any" }), require("./results"));
router.use("/", requireTenantModels(["Transcript", "Result"], { match: "any" }), require("./transcript"));
router.use("/", requireTenantModels(["Subject", "CourseRegistration", "RegistrationWindow"], { match: "any" }), require("./subjectSelection"));
router.use("/", requireTenantModels(["Invoice", "Payment", "FeeStructure", "Receipt"], { match: "any" }), require("./finance"));
router.use("/", requireTenantModels(["Hostel", "HostelAllocation", "HostelApplication"], { match: "any" }), require("./hostel"));
router.use("/", requireTenantModels(["LibraryBook", "LibraryLoan", "LibraryReservation"], { match: "any" }), require("./library"));
router.use("/", requireTenantModels(["Job", "Opportunity"], { match: "any" }), require("./jobs"));
router.use("/", requireTenantModels(["Notification", "Announcement"], { match: "any" }), require("./notifications"));
router.use("/", requireTenantFeature("helpdesk"), requireTenantModels(["SupportTicket", "Ticket"], { match: "any" }), require("./support"));
router.use("/", requireTenantModels(["Event"], { match: "any" }), require("./events"));

module.exports = router;

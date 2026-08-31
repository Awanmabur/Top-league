const express = require("express");
const router = express.Router();

const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");
const requireTenantFeature = require("../../../middleware/tenant/requireTenantFeature");
const requireTenantModels = require("../../../middleware/tenant/requireTenantModels");
const resolveTenantAccess = require("../../../middleware/tenant/resolveTenantAccess");
const setLocals = require("../../../middleware/tenant/setLocals");

// ✅ Protect ALL parent routes
router.use(resolveTenantAccess);
router.use(tenantAuth("parent"));
router.use(requireTenantModels(["Parent"], { match: "all" }));
router.use(setLocals);

// Core pages
router.use("/", require("./dashboard"));
router.use("/", requireTenantModels(["Student"], { match: "any" }), require("./children"));
router.use("/", requireTenantModels(["Parent", "Student", "Attendance", "Subject"], { match: "all" }), require("./attendance"));
router.use("/", requireTenantModels(["Student", "Result", "Exam", "Subject"], { match: "all" }), requireTenantModels(["Transcript"], { match: "all" }), require("./results"));
router.use("/", requireTenantModels(["Student", "Assignment", "AssignmentSubmission", "Subject"], { match: "all" }), require("./assignments"));
router.use("/", requireTenantModels(["Invoice", "Payment"], { match: "all" }), require("./fees"));
router.use("/", requireTenantModels(["Student", "TimetableEntry", "Subject", "Staff"], { match: "all" }), require("./timetable"));
router.use("/", requireTenantModels(["Parent", "Student", "AcademicEvent"], { match: "all" }), require("./calendar"));
router.use("/", requireTenantModels(["Parent", "Student", "DisciplineCase"], { match: "all" }), require("./discipline"));
router.use("/", requireTenantModels(["Parent", "Student", "StudentDoc"], { match: "all" }), require("./documents"));
router.use("/", requireTenantModels(["Parent", "Student", "Transport", "TransportAssignment"], { match: "all" }), require("./transport"));
router.use("/", requireTenantModels(["Parent", "Student", "Asset"], { match: "all" }), require("./assets"));
router.use("/", require("./profile"));

// Child views
router.use("/", requireTenantModels(["Student"], { match: "any" }), require("./childViews"));

// Announcements / notifications / support
router.use("/", requireTenantModels(["Announcement"], { match: "any" }), require("./announcements"));
router.use("/", requireTenantModels(["Notification"], { match: "any" }), require("./notifications"));
router.use("/", requireTenantFeature("helpdesk"), requireTenantModels(["HelpdeskTicket"], { match: "all" }), require("./support"));

module.exports = router;

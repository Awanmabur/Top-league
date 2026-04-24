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
router.use(setLocals);

// Core pages
router.use("/", require("./dashboard"));
router.use("/", requireTenantModels(["Student"], { match: "any" }), require("./children"));
router.use("/", requireTenantModels(["Attendance"], { match: "any" }), require("./attendance"));
router.use("/", requireTenantModels(["Result"], { match: "any" }), require("./results"));
router.use("/", requireTenantModels(["FeeInvoice", "FeePayment", "Payment", "Fee", "Invoice"], { match: "any" }), require("./fees"));
router.use("/", requireTenantModels(["Timetable", "ClassTimetable", "Schedule"], { match: "any" }), require("./timetable"));
router.use("/", require("./profile"));

// Child views
router.use("/", requireTenantModels(["Student"], { match: "any" }), require("./childViews"));

// Announcements / notifications / support
router.use("/", requireTenantModels(["Announcement"], { match: "any" }), require("./announcements"));
router.use("/", requireTenantModels(["Notification"], { match: "any" }), require("./notifications"));
router.use("/", requireTenantFeature("helpdesk"), requireTenantModels(["SupportTicket", "Ticket"], { match: "any" }), require("./support"));

module.exports = router;

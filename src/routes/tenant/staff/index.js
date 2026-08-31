const express = require("express");
const router = express.Router();

const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");
const resolveTenantAccess = require("../../../middleware/tenant/resolveTenantAccess");
const setLocals = require("../../../middleware/tenant/setLocals");
const requireTenantFeature = require("../../../middleware/tenant/requireTenantFeature");
const requireTenantModels = require("../../../middleware/tenant/requireTenantModels");

/**
 * ✅ Protect ALL staff portal routes
 */
router.use(resolveTenantAccess);
router.use(tenantAuth(["staff", "lecturer"]));
router.use(setLocals);

// Core pages
router.use("/", require("./dashboard"));
router.use("/", require("./profile"));
router.use("/", requireTenantModels(["Staff", "TimetableEntry", "Subject", "Class", "Section", "Stream"], { match: "all" }), require("./timetable"));
router.use("/", requireTenantModels(["Staff", "AcademicEvent"], { match: "all" }), require("./calendar"));
router.use("/", requireTenantModels(["Staff", "Asset"], { match: "all" }), require("./assets"));
router.use("/", require("./announcements"));

// Extras (recommended for production)
router.use("/", require("./notifications"));
router.use("/", requireTenantFeature("helpdesk"), requireTenantModels(["HelpdeskTicket"], { match: "all" }), require("./support"));

// Optional HR (recommended)
router.use("/", requireTenantModels(["Staff", "LeaveRequest"], { match: "all" }), require("./leave"));
router.use("/", requireTenantModels(["Staff", "PayrollRun", "PayrollItem"], { match: "all" }), require("./payroll"));

module.exports = router;

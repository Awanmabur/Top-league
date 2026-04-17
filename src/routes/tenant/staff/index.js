const express = require("express");
const router = express.Router();

const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");
const resolveTenantAccess = require("../../../middleware/tenant/resolveTenantAccess");
const setLocals = require("../../../middleware/tenant/setLocals");

/**
 * ✅ Protect ALL staff portal routes
 * NOTE:
 * - If your tenantAuth only accepts a single role string, change this to the role you want
 *   e.g. tenantAuth("registrar") or tenantAuth("staff")
 * - Recommended: allow all staff-type roles into /staff portal
 */
router.use(resolveTenantAccess);
router.use(tenantAuth(["staff", "registrar", "finance", "librarian", "hostel", "admin"]));
router.use(setLocals);

// Core pages
router.use("/", require("./dashboard"));
router.use("/", require("./profile"));
router.use("/", require("./timetable"));
router.use("/", require("./announcements"));

// Extras (recommended for production)
router.use("/", require("./notifications"));
router.use("/", require("./support"));

// Optional HR (recommended)
router.use("/", require("./leave"));
router.use("/", require("./payroll"));

module.exports = router;

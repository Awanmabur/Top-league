const express = require("express");
const router = express.Router();

const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");
const resolveTenantAccess = require("../../../middleware/tenant/resolveTenantAccess");
const setLocals = require("../../../middleware/tenant/setLocals");

/**
 * ✅ Protect ALL staff portal routes
 */
router.use(resolveTenantAccess);
router.use(tenantAuth(["staff", "lecturer"]));
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

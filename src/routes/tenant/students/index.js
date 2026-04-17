const express = require("express");
const router = express.Router();

const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");
const resolveTenantAccess = require("../../../middleware/tenant/resolveTenantAccess");
const setLocals = require("../../../middleware/tenant/setLocals");

// Protect ALL /student routes
router.use(resolveTenantAccess);
router.use(tenantAuth("student"));
router.use(setLocals);

// Sub routes
router.use("/", require("./dashboard"));
router.use("/", require("./profile"));
router.use("/", require("./subjects"));
router.use("/", require("./timetable"));
router.use("/", require("./attendance"));
router.use("/", require("./assignments"));
router.use("/", require("./exams"));
router.use("/", require("./results"));
router.use("/", require("./transcript"));
router.use("/", require("./subjectSelection"));
router.use("/", require("./finance"));
router.use("/", require("./hostel"));
router.use("/", require("./library"));
router.use("/", require("./jobs"));
router.use("/", require("./notifications"));
router.use("/", require("./support"));
router.use("/", require("./events"));

module.exports = router;

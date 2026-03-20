const express = require("express");
const router = express.Router();

const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");

// ✅ Protect ALL lecturer routes
router.use(tenantAuth("lecturer"));

// Core pages
router.use("/", require("./dashboard"));
router.use("/", require("./courses"));
router.use("/", require("./timetable"));
router.use("/", require("./announcements"));
router.use("/", require("./profile"));

// Class section tools
router.use("/", require("./attendance"));
router.use("/", require("./gradebook"));
router.use("/", require("./materials"));
router.use("/", require("./assignments"));
router.use("/", require("./quizzes"));

// Extras (recommended for production)
router.use("/", require("./notifications"));
router.use("/", require("./support"));

module.exports = router;

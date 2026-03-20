const express = require("express");
const router = express.Router();

const tenantAuth = require("../../../middleware/tenant/requireTenantAuth");

// ✅ Protect ALL parent routes
router.use(tenantAuth("parent"));

// Core pages
router.use("/", require("./dashboard"));
router.use("/", require("./children"));
router.use("/", require("./attendance"));
router.use("/", require("./results"));
router.use("/", require("./fees"));
router.use("/", require("./timetable"));
router.use("/", require("./profile"));

// Child views
router.use("/", require("./childViews"));

// Announcements / notifications / support
router.use("/", require("./announcements"));
router.use("/", require("./notifications"));
router.use("/", require("./support"));

module.exports = router;
const express = require("express");
const router = express.Router();

// 1) Public invite/set-password FIRST (no auth)
router.use("/", require("./invitation")); // /set-password, /invite, etc.

// 2) Auth routes (public): /login, /logout, /forgot-password
router.use("/", require("./auth"));

// 3) Public tenant pages (apply/admissions/scholarships) BEFORE protected portals
router.use("/", require("../public/admissions"));       // e.g. /apply
router.use("/scholarships", require("../public/scholarships")); // e.g. /scholarships
router.use("/schools", require("../public/schoolsProfiles")); // e.g. /schools

// 4) Protected portals (each portal should protect itself internally)
router.use("/admin", require("../admin"));
router.use("/student", require("../students"));
router.use("/parent", require("../parents"));
router.use("/staff", require("../staff"));

// 5) Public school landing pages LAST (root /)
router.use("/", require("./tenant"));

module.exports = router;

const express = require("express");
const router = express.Router();
const profileController = require("../../../controllers/tenant/students/profileController");

router.get("/profile", profileController.profile);

module.exports = router;
const express = require("express");
const router = express.Router();

const profileController = require("../../../controllers/tenant/parents/profileController");

router.get("/profile", profileController.index);
router.post("/profile", profileController.update);

module.exports = router;
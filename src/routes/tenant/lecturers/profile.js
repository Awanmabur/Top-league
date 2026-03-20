const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/profileController");

router.get("/profile", ctrl.view);
router.post("/profile", ctrl.update);

module.exports = router;

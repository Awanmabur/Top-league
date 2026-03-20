const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/gradebookController");

// Gradebook per class section
router.get("/gradebook/:classSectionId", ctrl.page);
router.post("/gradebook/:classSectionId", ctrl.save);

module.exports = router;

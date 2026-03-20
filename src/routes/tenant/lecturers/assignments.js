const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/assignmentsController");

// Assignments per class section
router.get("/assignments/:classSectionId", ctrl.list);
router.post("/assignments/:classSectionId", ctrl.create);

module.exports = router;

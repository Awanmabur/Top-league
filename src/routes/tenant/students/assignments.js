const express = require("express");
const router = express.Router();
const assignmentsController = require("../../../controllers/tenant/students/assignmentsController");

router.get("/assignments", assignmentsController.assignments);

module.exports = router;
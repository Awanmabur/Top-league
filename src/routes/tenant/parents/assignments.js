const express = require("express");
const router = express.Router();
const assignmentsController = require("../../../controllers/tenant/parents/assignmentsController");

router.get("/assignments", assignmentsController.index);

module.exports = router;

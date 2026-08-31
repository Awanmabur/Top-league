const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/students/assignmentsController");

router.get("/assignments", ctrl.assignments);
router.get("/assignments/:id", ctrl.detail);
router.post("/assignments/:id/submit", ctrl.submit);
router.post("/assignments/:id/withdraw", ctrl.withdraw);

module.exports = router;

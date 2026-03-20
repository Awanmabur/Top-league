const express = require("express");
const router = express.Router();
const examsController = require("../../../controllers/tenant/students/examsController");

router.get("/exams", examsController.exams);

module.exports = router;
const express = require("express");
const router = express.Router();
const subjectsController = require("../../../controllers/tenant/students/subjectsController");

router.get("/subjects", subjectsController.subjects);

module.exports = router;

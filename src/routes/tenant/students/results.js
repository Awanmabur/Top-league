const express = require("express");
const router = express.Router();
const resultsController = require("../../../controllers/tenant/students/resultsController");

router.get("/results", resultsController.results);

module.exports = router;
const express = require("express");
const router = express.Router();
const subjectSelectionController = require("../../../controllers/tenant/students/subjectSelectionController");

router.get("/subject-selection", subjectSelectionController.subjectSelection);

module.exports = router;

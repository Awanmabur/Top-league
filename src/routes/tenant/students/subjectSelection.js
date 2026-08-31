const express = require("express");
const router = express.Router();
const subjectSelectionController = require("../../../controllers/tenant/students/subjectSelectionController");

router.get("/subject-selection", subjectSelectionController.subjectSelection);
router.post("/subject-selection/:subjectId/add", subjectSelectionController.add);
router.post("/subject-selection/:registrationId/drop", subjectSelectionController.drop);

module.exports = router;

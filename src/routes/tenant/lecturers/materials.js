const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/materialsController");

// Materials per class section
router.get("/materials/:classSectionId", ctrl.list);
router.post("/materials/:classSectionId", ctrl.create);

module.exports = router;

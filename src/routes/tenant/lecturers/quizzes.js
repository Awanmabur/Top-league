const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/lecturers/quizzesController");

// Quizzes per class section
router.get("/quizzes/:classSectionId", ctrl.list);
router.post("/quizzes/:classSectionId", ctrl.create);

module.exports = router;

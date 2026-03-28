const express = require("express");
const router = express.Router();

const examsController = require("../../../controllers/tenant/admin/examsController");

router.get("/", examsController.list);
router.post("/", examsController.examRules, examsController.create);
router.post("/:id", examsController.examRules, examsController.update);
router.post("/:id/status", examsController.setStatus);
router.post("/:id/delete", examsController.remove);
router.post("/bulk", examsController.bulk);

module.exports = router;
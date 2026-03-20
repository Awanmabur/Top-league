const express = require("express");
const router = express.Router();

const coursesCtrl = require("../../../controllers/tenant/admin/coursesController");

// list
router.get("/", coursesCtrl.list);

// create
router.post("/", coursesCtrl.courseRules, coursesCtrl.create);

// update
router.post("/:id", coursesCtrl.courseRules, coursesCtrl.update);

// status
router.post("/:id/status", coursesCtrl.setStatus);

// delete
router.post("/:id/delete", coursesCtrl.remove);

// bulk
router.post("/bulk", coursesCtrl.bulk);

module.exports = router;

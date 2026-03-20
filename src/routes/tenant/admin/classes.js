const express = require("express");
const router = express.Router();

const classesCtrl = require("../../../controllers/tenant/admin/classesController");

// list
router.get("/", classesCtrl.list);

// create
router.post("/", classesCtrl.classRules, classesCtrl.create);

// update
router.post("/:id", classesCtrl.classRules, classesCtrl.update);

// status
router.post("/:id/status", classesCtrl.setStatus);

// delete
router.post("/:id/delete", classesCtrl.remove);

// bulk
router.post("/bulk", classesCtrl.bulk);

module.exports = router;

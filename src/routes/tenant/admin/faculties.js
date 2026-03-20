const express = require("express");
const router = express.Router();

const facultyCtrl = require("../../../controllers/tenant/admin/facultiesController");

// list
router.get("/", facultyCtrl.list);

// create
router.post("/", facultyCtrl.facultyRules, facultyCtrl.create);

// update
router.post("/:id", facultyCtrl.facultyRules, facultyCtrl.update);

// toggle status
router.post("/:id/status", facultyCtrl.toggleStatus);

// delete
router.post("/:id/delete", facultyCtrl.remove);

// bulk
router.post("/bulk", facultyCtrl.bulk);

module.exports = router;

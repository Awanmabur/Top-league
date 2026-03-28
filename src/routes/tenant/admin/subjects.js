const express = require("express");
const router = express.Router();

const subjectsCtrl = require("../../../controllers/tenant/admin/subjectsController");

// list
router.get("/", subjectsCtrl.list);

// create
router.post("/", subjectsCtrl.create);

// update
router.post("/:id", subjectsCtrl.update);

// status
router.post("/:id/status", subjectsCtrl.setStatus);

// delete
router.post("/:id/delete", subjectsCtrl.remove);

// bulk
router.post("/bulk", subjectsCtrl.bulk);

module.exports = router;

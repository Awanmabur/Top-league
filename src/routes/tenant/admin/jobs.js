const express = require("express");
const router = express.Router();
const ctrl = require("../../../controllers/tenant/admin/jobsController");
router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.post("/:id", ctrl.update);
router.post("/:id/status", ctrl.status);
router.post("/applications/:id/status", ctrl.applicationStatus);
module.exports = router;

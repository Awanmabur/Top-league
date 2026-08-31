const express = require("express");
const router = express.Router();

const subjectsCtrl = require("../../../controllers/tenant/admin/subjectsController");
const registrationsCtrl = require("../../../controllers/tenant/admin/subjectRegistrationsController");

router.get("/registrations", registrationsCtrl.list);
router.post("/registrations/windows", registrationsCtrl.createWindow);
router.post("/registrations/windows/:id", registrationsCtrl.updateWindow);
router.post("/registrations/:id/decision", registrationsCtrl.decide);
router.post("/registrations/holds", registrationsCtrl.createHold);
router.post("/registrations/holds/:id/clear", registrationsCtrl.clearHold);

// list
router.get("/", subjectsCtrl.list);

// create
router.post("/", subjectsCtrl.subjectRules, subjectsCtrl.create);

// update
router.post("/:id", subjectsCtrl.subjectRules, subjectsCtrl.update);

// status
router.post("/:id/status", subjectsCtrl.setStatus);

// delete
router.post("/:id/delete", subjectsCtrl.remove);

router.get("/export.csv", subjectsCtrl.exportCsv);

// bulk
router.post("/bulk", subjectsCtrl.bulk);

module.exports = router;
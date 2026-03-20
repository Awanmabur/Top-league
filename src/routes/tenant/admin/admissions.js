const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/admissionsController");
const ctrlOffers = require("../../../controllers/tenant/admin/offerLettersController");
const ctrlIntakes = require("../../../controllers/tenant/admin/intakeController");
const ctrlRequirements = require("../../../controllers/tenant/admin/requirementsController");

// NOTE: no router.use(auth) here (admin/index already protects)

// Applicants list: GET /admin/admissions/applicants
router.get("/", ctrl.dashboard);

router.get("/applicants", ctrl.listApplicants);

// View applicant: GET /admin/admissions/applicants/:id
router.get("/applicants/:id", ctrl.viewApplicant);

// Actions
router.post("/applicants/:id/accept", ctrl.acceptApplicant);
router.post("/applicants/:id/reject", ctrl.rejectApplicant);

// Bulk action
router.post("/applicants/bulk", ctrl.bulkAction);

router.get("/offer-letters", ctrlOffers.index);
router.post("/offer-letters/template", ctrlOffers.updateTemplate);

router.post("/offer-letters/generate", ctrlOffers.generate);
router.post("/offer-letters/:id/send", ctrlOffers.send);
router.post("/offer-letters/:id/void", ctrlOffers.voidLetter);

router.get("/intakes", ctrlIntakes.index);
router.get("/intakes/new", ctrlIntakes.newPage);
router.post("/intakes/", ctrlIntakes.create);

router.get("/intakes/:id/edit", ctrlIntakes.editPage);
router.post("/intakes/:id", ctrlIntakes.update);

router.post("/intakes/:id/active", ctrlIntakes.setActive);
router.post("/intakes/:id/status", ctrlIntakes.setStatus);
router.post("/intakes/:id/delete", ctrlIntakes.remove);

router.get("/requirements", ctrlRequirements.index);
router.post("/requirements", ctrlRequirements.create);
router.post("/requirements/:id/update", ctrlRequirements.update);
router.post("/requirements/:id/delete", ctrlRequirements.remove);
router.post("/requirements/bulk-action", ctrlRequirements.bulkAction);

module.exports = router;
  
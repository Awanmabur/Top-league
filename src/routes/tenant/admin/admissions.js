const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/admissionsController");
const ctrlOffers = require("../../../controllers/tenant/admin/offerLettersController");
const ctrlIntakes = require("../../../controllers/tenant/admin/intakeController");
const ctrlRequirements = require("../../../controllers/tenant/admin/requirementsController");
const upload = require("../../../middleware/uploadMemory");
const { validateBufferedUploads } = require("../../../middleware/validateBufferedUploads");
const validateDocs = validateBufferedUploads();
const { createCsvUpload, validateCsvUpload } = require("../../../middleware/csvUpload");
const csvUpload = createCsvUpload({ maxBytes: 5 * 1024 * 1024 });
const requireTenantPermission = require("../../../middleware/tenant/requireTenantPermission");

// NOTE: no router.use(auth) here (admin/index already protects)

// Read-only Admissions roles may browse GET routes, but every mutation requires admissions.manage.
router.use((req, res, next) => req.method === "GET" ? next() : requireTenantPermission("admissions.manage")(req, res, next));

// Applicants list: GET /admin/admissions/applicants
router.get("/", ctrl.dashboard);

router.get("/applicants", ctrl.listApplicants);
router.get("/applicants/export", ctrl.exportApplicantsCsv);
router.post("/applicants/import", csvUpload.single("file"), validateCsvUpload, ctrl.importApplicantsCsv);

// View applicant: GET /admin/admissions/applicants/:id
router.get("/applicants/:id", ctrl.viewApplicant);

// Actions
router.post("/applicants/:id/export", ctrl.exportApplicant);
router.post("/applicants/:id/status", ctrl.updateStatus);
router.post("/applicants/:id/accept", ctrl.acceptApplicant);
router.post("/applicants/:id/reject", ctrl.rejectApplicant);
router.post("/applicants/:id/shortlist", ctrl.shortlistApplicant);
router.post("/applicants/:id/notes", ctrl.saveNotes);
router.post("/applicants/:id/request-docs", ctrl.requestDocs);
router.post("/applicants/:id/schedule-interview", ctrl.scheduleInterview);
router.post("/applicants/:id/cancel-interview", ctrl.cancelInterview);
router.post("/applicants/:id/documents/verify-all", ctrl.verifyAllDocuments);
router.post("/applicants/:id/documents/:key/verify", ctrl.verifyDocument);
router.post("/applicants/:id/documents/upload", upload.single("file"), validateDocs, ctrl.uploadApplicantDocument);
router.post("/applicants/:id/checklist", ctrl.saveChecklist);
router.post("/applicants/:id/email", ctrl.emailApplicant);
router.post("/applicants/:id/sms", ctrl.smsApplicant);

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
router.post("/intakes/new", ctrlIntakes.create);
router.post("/intakes/import", csvUpload.single("file"), validateCsvUpload, ctrlIntakes.importCsv);
router.post("/intakes/bulk-status", ctrlIntakes.bulkStatus);

router.get("/intakes/:id/edit", ctrlIntakes.editPage);
router.post("/intakes/:id", ctrlIntakes.update);

router.post("/intakes/:id/active", ctrlIntakes.setActive);
router.post("/intakes/:id/status", ctrlIntakes.setStatus);
router.post("/intakes/:id/delete", ctrlIntakes.remove);

router.get("/requirements", ctrlRequirements.index);
router.post("/requirements", ctrlRequirements.requirementRules, ctrlRequirements.create);
router.post("/requirements/:id/update", ctrlRequirements.requirementRules, ctrlRequirements.update);
router.post("/requirements/import", csvUpload.single("file"), validateCsvUpload, ctrlRequirements.importCsv);
router.post("/requirements/:id/delete", ctrlRequirements.remove);
router.post("/requirements/bulk-action", ctrlRequirements.bulkAction);

module.exports = router;
  
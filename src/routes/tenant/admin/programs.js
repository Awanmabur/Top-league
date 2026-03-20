const express = require("express");
const router = express.Router();

const { csrfProtection, attachCsrfToken } = require("../../../middleware/tenant/csrf");
const ctrl = require("../../../controllers/tenant/admin/programsController");

// NOTE: no auth here (admin/index.js already protects)

// GET /admin/programs
router.get("/", csrfProtection, attachCsrfToken, ctrl.list);

// POST /admin/programs
router.post("/", csrfProtection, ctrl.programRules, ctrl.create);

// POST /admin/programs/bulk-archive
router.post("/bulk-archive", csrfProtection, ctrl.bulkArchive);

// POST /admin/programs/:id
router.post("/:id", csrfProtection, ctrl.programRules, ctrl.update);

// POST /admin/programs/:id/archive
router.post("/:id/archive", csrfProtection, ctrl.archive);

// POST /admin/programs/:id/delete
router.post("/:id/delete", csrfProtection, ctrl.remove);

module.exports = router;

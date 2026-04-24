const express = require("express");
const router = express.Router();
const tenantsController = require("../../controllers/platform/tenantsController");
const { platformRequire } = require("../../middleware/platform/guards");

router.get("/super-admin/schools", platformRequire("schools.view"), tenantsController.listTenants);
router.get("/super-admin/schools/create", platformRequire("schools.manage"), tenantsController.createTenantForm);
router.post("/super-admin/schools/create", platformRequire("schools.manage"), tenantsController.createTenant);

router.get("/super-admin/schools/:id", platformRequire("schools.view"), tenantsController.showTenant);
router.get("/super-admin/schools/:id/edit", platformRequire("schools.manage"), tenantsController.editTenantForm);
router.post("/super-admin/schools/:id/edit", platformRequire("schools.manage"), tenantsController.updateTenant);

router.post("/super-admin/schools/:id/status", platformRequire("schools.manage"), tenantsController.updateTenantStatus);
router.post("/super-admin/schools/:id/delete", platformRequire("schools.manage"), tenantsController.deleteTenant);

router.post("/super-admin/schools/:id/resend-invite", platformRequire("schools.manage"), tenantsController.resendTenantInvite);

module.exports = router;

const express = require("express");
const router = express.Router();
const tenantsController = require("../../controllers/platform/tenantsController");

router.get("/super-admin/universities", tenantsController.listTenants);
router.get("/super-admin/universities/create", tenantsController.createTenantForm);
router.post("/super-admin/universities/create", tenantsController.createTenant);

router.get("/super-admin/universities/:id", tenantsController.showTenant);
router.get("/super-admin/universities/:id/edit", tenantsController.editTenantForm);
router.post("/super-admin/universities/:id/edit", tenantsController.updateTenant);

router.post("/super-admin/universities/:id/status", tenantsController.updateTenantStatus);
router.post("/super-admin/universities/:id/delete", tenantsController.deleteTenant);

router.post("/super-admin/universities/:id/resend-invite", tenantsController.resendTenantInvite);

module.exports = router;
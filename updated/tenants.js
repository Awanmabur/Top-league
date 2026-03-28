const express = require("express");
const router = express.Router();
const tenantsController = require("../../controllers/platform/tenantsController");

router.get("/super-admin/schools", tenantsController.listTenants);
router.get("/super-admin/schools/create", tenantsController.createTenantForm);
router.post("/super-admin/schools/create", tenantsController.createTenant);
router.get("/super-admin/schools/:id", tenantsController.showTenant);
router.get("/super-admin/schools/:id/edit", tenantsController.editTenantForm);
router.post("/super-admin/schools/:id/edit", tenantsController.updateTenant);
router.post("/super-admin/schools/:id/status", tenantsController.updateTenantStatus);
router.post("/super-admin/schools/:id/delete", tenantsController.deleteTenant);
router.post("/super-admin/schools/:id/resend-invite", tenantsController.resendTenantInvite);

router.get("/super-admin/universities", tenantsController.listTenants);
router.get("/super-admin/universities/create", (req, res) => res.redirect("/super-admin/schools/create"));
router.post("/super-admin/universities/create", tenantsController.createTenant);
router.get("/super-admin/universities/:id", (req, res) => res.redirect(`/super-admin/schools/${req.params.id}`));
router.get("/super-admin/universities/:id/edit", (req, res) => res.redirect(`/super-admin/schools/${req.params.id}/edit`));
router.post("/super-admin/universities/:id/edit", tenantsController.updateTenant);
router.post("/super-admin/universities/:id/status", tenantsController.updateTenantStatus);
router.post("/super-admin/universities/:id/delete", tenantsController.deleteTenant);
router.post("/super-admin/universities/:id/resend-invite", tenantsController.resendTenantInvite);

module.exports = router;

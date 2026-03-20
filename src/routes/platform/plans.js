const express = require("express");
const router = express.Router();
const plansController = require("../../controllers/platform/plansController");

router.get("/super-admin/plans", plansController.listPlans);
router.get("/super-admin/plans/create", plansController.createPlanForm);
router.post("/super-admin/plans/create", plansController.createPlan);

router.get("/super-admin/plans/:id/edit", plansController.editPlanForm);
router.post("/super-admin/plans/:id/edit", plansController.updatePlan);
router.post("/super-admin/plans/:id/delete", plansController.deletePlan);

module.exports = router;
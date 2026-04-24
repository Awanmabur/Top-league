const express = require("express");
const router = express.Router();
const plansController = require("../../controllers/platform/plansController");
const { platformRequire } = require("../../middleware/platform/guards");

router.get("/super-admin/plans", platformRequire("plans.view"), plansController.listPlans);
router.get("/super-admin/plans/create", platformRequire("plans.manage"), plansController.createPlanForm);
router.post("/super-admin/plans/create", platformRequire("plans.manage"), plansController.createPlan);

router.get("/super-admin/plans/:id/edit", platformRequire("plans.manage"), plansController.editPlanForm);
router.post("/super-admin/plans/:id/edit", platformRequire("plans.manage"), plansController.updatePlan);
router.post("/super-admin/plans/:id/delete", platformRequire("plans.manage"), plansController.deletePlan);

module.exports = router;

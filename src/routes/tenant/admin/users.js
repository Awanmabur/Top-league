const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/usersController");

router.get("/", ctrl.list);
router.get("/new", ctrl.newForm);
router.post("/", ctrl.create);

router.get("/:id", ctrl.view);
router.post("/:id/status", ctrl.updateStatus);
router.post("/:id/roles", ctrl.updateRoles);
router.post("/:id/delete", ctrl.softDelete);

router.post("/:id/resend-invite", ctrl.resendInvite);

module.exports = router;
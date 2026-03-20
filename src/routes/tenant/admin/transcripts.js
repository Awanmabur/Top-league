const express = require("express");
const router = express.Router();

const ctrl = require("../../../controllers/tenant/admin/transcriptsController");

router.get("/", ctrl.list);

router.post("/", ctrl.transcriptRules, ctrl.create);
router.post("/:id", ctrl.transcriptRules, ctrl.update);

router.post("/:id/clone", ctrl.clone);
router.post("/:id/issue", ctrl.issue);
router.post("/:id/revoke", ctrl.revoke);
router.post("/:id/delete", ctrl.remove);

router.post("/bulk", ctrl.bulk);

router.get("/:id/print", ctrl.printView);

// verification
router.get("/verify/:issueNumber", ctrl.verifyPage);
router.get("/api/verify/:issueNumber", ctrl.verifyApi);

module.exports = router;
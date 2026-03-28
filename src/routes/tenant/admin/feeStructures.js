const express = require("express");
const router = express.Router();

const feesController = require("../../../controllers/tenant/admin/feesController");

router.get("/", feesController.list);
router.post("/", feesController.feeRules, feesController.create);
router.post("/bulk-generate", feesController.bulkGenerate);
router.post("/:id", feesController.feeRules, feesController.update);
router.post("/:id/issue", feesController.issue);
router.post("/:id/void", feesController.voidFee);
router.post("/:id/delete", feesController.remove);
router.post("/bulk", feesController.bulk);

module.exports = router;


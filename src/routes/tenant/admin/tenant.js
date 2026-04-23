const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  if (!req.tenant) {
    return res.status(404).send("School not found (tenant missing)");
  }

  return res.redirect("/tenant/admin/dashboard");
});

module.exports = router;

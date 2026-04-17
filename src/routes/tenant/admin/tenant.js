const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  const tenant = req.tenant;

  if (!tenant)
    return res.status(404).send("School not found (tenant missing)");

  res.render("tenant/admin/index", { tenant }); 
});

module.exports = router;

const express = require("express");
const router = express.Router();

const studentApi = require("../../../controllers/tenant/admin/studentApiController");

// NOTE: no router.use(auth) here (admin/index already protects)

// GET /admin/api/students/search?q=...
router.get("/students/search", studentApi.search);

module.exports = router;

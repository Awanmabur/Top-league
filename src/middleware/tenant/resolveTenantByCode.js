const { platformConnection } = require("../../config/db");
const Tenant = require("../../models/platform/Tenant")(platformConnection);

function safeLower(s) {
  return String(s || "").trim().toLowerCase();
}

function wantsJson(req) {
  return (
    req.xhr ||
    (req.get("accept") || "").includes("application/json") ||
    (req.get("x-requested-with") || "") === "XMLHttpRequest"
  );
}

module.exports = async function resolveTenantByCode(req, res, next) {
  try {
    const code = safeLower(req.params.code);

    if (!code) {
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, message: "Missing school code." });
      }
      return res.status(400).send("Missing school code.");
    }

    const tenant = await Tenant.findOne({
      code,
      isDeleted: { $ne: true },
    }).lean();

    if (!tenant) {
      if (wantsJson(req)) {
        return res.status(404).json({ ok: false, message: "School not found." });
      }
      return res.status(404).send("School not found.");
    }

    req.tenant = tenant;
    return next();
  } catch (err) {
    console.error("resolveTenantByCode:", err);
    if (wantsJson(req)) {
      return res.status(500).json({ ok: false, message: "Server error" });
    }
    return res.status(500).send("Server error");
  }
};
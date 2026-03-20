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

const TENANT_CODE_CACHE = new Map();
const TENANT_CODE_TTL_MS = 5 * 60 * 1000;

function cacheGet(code) {
  const hit = TENANT_CODE_CACHE.get(code);
  if (!hit) return null;

  if (Date.now() > hit.exp) {
    TENANT_CODE_CACHE.delete(code);
    return null;
  }

  return hit.tenant;
}

function cacheSet(code, tenant) {
  TENANT_CODE_CACHE.set(code, {
    tenant,
    exp: Date.now() + TENANT_CODE_TTL_MS,
  });
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

    let tenant = cacheGet(code);

    if (!tenant) {
      tenant = await Tenant.findOne({
        code,
        isDeleted: { $ne: true },
      }).lean();

      if (tenant) {
        cacheSet(code, tenant);
      }
    }

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
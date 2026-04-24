const { getPrimaryTenantRole, normalizeTenantRoles } = require("./tenantRoles");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function buildRoleConflictError(email, currentRole, requiredRole) {
  const label = email || "This email";
  const err = new Error(
    `${label} is already linked to a ${currentRole} account. Each email can only belong to one role.`,
  );
  err.code = "ROLE_EMAIL_CONFLICT";
  err.currentRole = currentRole;
  err.requiredRole = requiredRole;
  return err;
}

function ensureSingleRoleForUser(user, requiredRole, email = "") {
  if (!user) return null;

  const currentRole = getPrimaryTenantRole(user.roles);
  if (currentRole !== requiredRole) {
    throw buildRoleConflictError(email || user.email || "", currentRole, requiredRole);
  }

  return user;
}

function singleRoleUpdate(requiredRole, extra = {}) {
  return {
    roles: normalizeTenantRoles(requiredRole),
    ...extra,
  };
}

module.exports = {
  normalizeEmail,
  buildRoleConflictError,
  ensureSingleRoleForUser,
  singleRoleUpdate,
};

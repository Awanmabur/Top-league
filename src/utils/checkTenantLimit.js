async function checkTenantLimit({
  model,
  tenantAccess,
  kind,
  filter = {},
  requiredSlots = 1,
}) {
  if (!model) {
    throw new Error("Model is required for tenant limit checks.");
  }

  if (!tenantAccess) {
    throw new Error("tenantAccess is required for tenant limit checks.");
  }

  const map = {
    students: "maxStudents",
    staff: "maxStaff",
    campuses: "maxCampuses",
  };

  const limitKey = map[kind];

  if (!limitKey) {
    throw new Error(`Unsupported tenant limit kind: ${kind}`);
  }

  const limit = Number(tenantAccess?.limits?.[limitKey] || 0);
  const requested = Math.max(0, Math.trunc(Number(requiredSlots) || 0));

  if (limit <= 0) {
    return {
      allowed: true,
      limit,
      current: 0,
      requested,
      remaining: Infinity,
      unlimited: true,
    };
  }

  const current = await model.countDocuments(filter);
  const allowed = current + requested <= limit;
  const remaining = Math.max(0, limit - current);

  return {
    allowed,
    limit,
    current,
    requested,
    remaining,
    unlimited: false,
    message:
      allowed
        ? null
        : `You have reached your ${kind} limit for the ${tenantAccess.planName || "current"} plan (${current}/${limit}).`,
  };
}

function tenantLimitError(result, kind) {
  const err = new Error(result?.message || `Tenant ${kind} limit reached.`);
  err.code = "TENANT_LIMIT_REACHED";
  err.kind = kind;
  err.limit = Number(result?.limit || 0);
  err.current = Number(result?.current || 0);
  return err;
}

async function assertTenantLimitAvailable(options) {
  const result = await checkTenantLimit(options);
  if (!result.allowed) throw tenantLimitError(result, options.kind);
  return result;
}

async function compensateIfTenantLimitExceeded({
  model,
  tenantAccess,
  kind,
  filter = {},
  createdId,
}) {
  if (!createdId) throw new Error("createdId is required for tenant limit compensation.");

  const limitKey = { students: "maxStudents", staff: "maxStaff", campuses: "maxCampuses" }[kind];
  if (!limitKey) throw new Error(`Unsupported tenant limit kind: ${kind}`);

  const limit = Number(tenantAccess?.limits?.[limitKey] || 0);
  if (limit <= 0) return { allowed: true, unlimited: true, limit, current: 0 };

  const current = await model.countDocuments(filter);
  if (current <= limit) return { allowed: true, unlimited: false, limit, current };

  // The new record has not yet acquired downstream identity/document side effects.
  // Hard-delete it so concurrent quota races fail safe rather than oversubscribing.
  const removed = await model.deleteOne({ _id: createdId });
  if (!removed?.deletedCount) {
    const err = new Error(`The ${kind} plan limit was exceeded and the new record could not be compensated safely.`);
    err.code = "TENANT_LIMIT_COMPENSATION_FAILED";
    throw err;
  }

  throw tenantLimitError({
    message: `You have reached your ${kind} limit for the ${tenantAccess.planName || "current"} plan (${Math.max(0, current - 1)}/${limit}).`,
    limit,
    current: Math.max(0, current - 1),
  }, kind);
}

module.exports = checkTenantLimit;
module.exports.assertTenantLimitAvailable = assertTenantLimitAvailable;
module.exports.compensateIfTenantLimitExceeded = compensateIfTenantLimitExceeded;

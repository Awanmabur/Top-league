async function checkTenantLimit({
  model,
  tenantAccess,
  kind,
  filter = {},
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

  if (limit <= 0) {
    return {
      allowed: true,
      limit,
      current: 0,
      unlimited: true,
    };
  }

  const current = await model.countDocuments(filter);

  return {
    allowed: current < limit,
    limit,
    current,
    unlimited: false,
    message:
      current < limit
        ? null
        : `You have reached your ${kind} limit for the ${tenantAccess.planName || "current"} plan.`,
  };
}

module.exports = checkTenantLimit;
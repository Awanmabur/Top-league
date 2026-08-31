function operationalTenantProjectionFilter(now = new Date()) {
  const current = new Date(now);
  return {
    $or: [
      { status: "trial", trialEndsAt: { $gt: current } },
      { status: "active", subscriptionEndsAt: { $gt: current } },
    ],
  };
}

function tenantProjectionIsOperational(tenant, now = new Date()) {
  if (!tenant || tenant.isDeleted === true) return false;
  const current = new Date(now);
  if (tenant.status === "trial") {
    const end = tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : null;
    return !!end && !Number.isNaN(end.getTime()) && end > current;
  }
  if (tenant.status === "active") {
    const end = tenant.subscriptionEndsAt ? new Date(tenant.subscriptionEndsAt) : null;
    return !!end && !Number.isNaN(end.getTime()) && end > current;
  }
  return false;
}

function addOperationalTenantCondition(filter = {}, now = new Date()) {
  const existing = { ...filter };
  const access = operationalTenantProjectionFilter(now);
  if (!Object.keys(existing).length) return access;
  return { $and: [existing, access] };
}

module.exports = {
  operationalTenantProjectionFilter,
  tenantProjectionIsOperational,
  addOperationalTenantCondition,
};

// src/services/tenancy/seedTenant.js
const { getTenantConnection } = require('../../config/db');
const UserModelFactory = require('../../models/tenant/User');
const { normalizeEmail, singleRoleUpdate } = require('../../utils/tenantUserAccounts');

function splitName(fullName = "") {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "Admin",
    lastName: parts.slice(1).join(" ") || "User",
  };
}

async function seedTenant(tenant, platformConnection) {
  // tenant is a Tenant document from platform_db
  const tenantConn = getTenantConnection(tenant.dbName);

  // Initialize models on tenant connection
  const User = UserModelFactory(tenantConn);

  // 1. Create initial school admin user if not exists
  const adminEmail = normalizeEmail(tenant.ownerEmail || `admin@${tenant.code}.edu`);

  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    const { firstName, lastName } = splitName(tenant.ownerName || `${tenant.name} Admin`);

    await User.create({
      firstName,
      lastName,
      email: adminEmail,
      ...singleRoleUpdate('admin', {
        status: 'invited',
        passwordHash: null,
      }),
    });

    console.log(`Seeded school admin placeholder for ${tenant.name}: ${adminEmail}`);
  } else {
    console.log(`Admin already exists for ${tenant.name}`);
  }

  // later: seed roles, grade scales, academic periods, etc.
}

module.exports = { seedTenant };

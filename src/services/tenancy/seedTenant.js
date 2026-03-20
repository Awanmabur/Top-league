// src/services/tenancy/seedTenant.js
const bcrypt = require('bcryptjs');
const { getTenantConnection } = require('../../config/db');
const TenantModelFactory = require('../../models/platform/Tenant');
const UserModelFactory = require('../../models/tenant/User');

async function seedTenant(tenant, platformConnection) {
  // tenant is a Tenant document from platform_db
  const tenantConn = getTenantConnection(tenant.dbName);

  // Initialize models on tenant connection
  const User = UserModelFactory(tenantConn);

  // 1. Create initial UniversityAdmin user if not exists
  const adminEmail = tenant.ownerEmail || `admin@${tenant.code}.edu`;

  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    const password = 'Admin123!'; // you can mail/reset later
    const passwordHash = await bcrypt.hash(password, 10);

    await User.create({
      name: tenant.ownerName || `${tenant.name} Admin`,
      email: adminEmail,
      passwordHash,
      roles: ['UniversityAdmin']
    });

    console.log(
      `Seeded UniversityAdmin for ${tenant.name}: ${adminEmail} / ${password}`
    );
  } else {
    console.log(`Admin already exists for ${tenant.name}`);
  }

  // later: seed roles, grade scales, academic periods, etc.
}

module.exports = { seedTenant };

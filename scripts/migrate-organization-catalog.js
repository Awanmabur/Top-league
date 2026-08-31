require("dotenv").config({ quiet: true });
const { platformConnection, waitForPlatform, getTenantConnection } = require("../src/config/db");
const loadTenantModels = require("../src/models/tenant/loadModels");
const Tenant = require("../src/models/platform/Tenant")(platformConnection);
const { migrateOrganizationCatalog } = require("./lib/migrateOrganizationCatalog");

(async () => {
  await waitForPlatform();
  const tenants = await Tenant.find({ isDeleted: { $ne: true } }).lean();
  for (const tenant of tenants) {
    if (!tenant.dbName) continue;
    const conn = await getTenantConnection(tenant.dbName);
    const models = loadTenantModels(conn);
    console.log(tenant.code, await migrateOrganizationCatalog(models));
  }
  await platformConnection.close();
})().catch(async (err) => { console.error(err); await platformConnection.close().catch(() => {}); process.exit(1); });

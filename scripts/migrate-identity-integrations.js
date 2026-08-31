require("dotenv").config({ quiet: true });
const { platformConnection, waitForPlatform, getTenantConnection } = require("../src/config/db");
const loadTenantModels = require("../src/models/tenant/loadModels");
const { migrateIdentityIntegrations } = require("./lib/migrateIdentityIntegrations");
(async () => {
  await waitForPlatform();
  const Tenant = platformConnection.models.Tenant || require("../src/models/platform/Tenant")(platformConnection);
  for (const tenant of await Tenant.find({ isDeleted: { $ne: true }, dbName: { $nin: [null, ""] } }).lean()) {
    const conn = await getTenantConnection(tenant.dbName);
    console.log(tenant.code || tenant._id, await migrateIdentityIntegrations(loadTenantModels(conn)));
  }
  await platformConnection.close();
})().catch((err) => { console.error(err); process.exit(1); });

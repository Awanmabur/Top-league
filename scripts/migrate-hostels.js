require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { platformConnection, waitForPlatform, getTenantConnection } = require("../src/config/db");
const TenantModel = require("../src/models/platform/Tenant");
const loadTenantModels = require("../src/models/tenant/loadModels");
const { migrateHostels } = require("./lib/migrateHostels");

async function main() {
  const requested = process.env.TENANT_CODE || process.argv.find((arg) => arg.startsWith("--tenant="))?.slice(9) || "";
  await waitForPlatform();
  const Tenant = TenantModel(platformConnection);
  const tenants = await Tenant.find({ isDeleted: { $ne: true } }).select("code subdomain dbName").lean();
  const selected = requested
    ? tenants.filter((tenant) => [tenant.code, tenant.subdomain, tenant.dbName, String(tenant._id)].map((v) => String(v || "").toLowerCase()).includes(requested.toLowerCase()))
    : tenants;
  if (requested && !selected.length) throw new Error(`No tenant found for ${requested}`);

  const connections = [];
  for (const tenant of selected) {
    if (!tenant.dbName) continue;
    const conn = await getTenantConnection(tenant.dbName);
    connections.push(conn);
    const lazy = loadTenantModels(conn);
    const models = {};
    for (const key of Object.keys(lazy)) models[key] = lazy[key];
    const result = await migrateHostels(models);
    console.log(`[ok] ${tenant.code || tenant.dbName}: ${JSON.stringify(result)}`);
  }
  await Promise.allSettled(connections.map((conn) => conn.close()));
  await platformConnection.close();
  await mongoose.disconnect().catch(() => {});
}

main().catch(async (error) => {
  console.error("Hostel migration failed:", error.message || error);
  await platformConnection.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

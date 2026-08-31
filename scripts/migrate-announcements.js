require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const { platformConnection, waitForPlatform, getTenantConnection } = require("../src/config/db");
const loadTenantModels = require("../src/models/tenant/loadModels");
const { migrateAnnouncements } = require("./lib/migrateAnnouncements");

function tenantMatchesArg(tenant, requested) {
  if (!requested) return true;
  const target = String(requested).trim().toLowerCase();
  return [tenant.code, tenant.subdomain, tenant.dbName, String(tenant._id)]
    .map((value) => String(value || "").trim().toLowerCase())
    .includes(target);
}

async function main() {
  const requestedTenant =
    process.env.TENANT_CODE ||
    process.argv.find((arg) => arg.startsWith("--tenant="))?.slice("--tenant=".length) ||
    "";

  await waitForPlatform();
  const Tenant = platformConnection.models.Tenant || require("../src/models/platform/Tenant")(platformConnection);
  const tenants = await Tenant.find({ isDeleted: { $ne: true } })
    .select("_id name code subdomain dbName")
    .lean();
  const selected = tenants.filter((tenant) => tenantMatchesArg(tenant, requestedTenant));
  if (requestedTenant && !selected.length) throw new Error(`No tenant found for ${requestedTenant}`);

  for (const tenant of selected) {
    if (!tenant.dbName) continue;
    const conn = await getTenantConnection(tenant.dbName);
    const models = loadTenantModels(conn);
    const result = await migrateAnnouncements(models);
    console.log(
      `[ok] ${tenant.code || tenant.dbName}: scanned=${result.scanned}, normalized=${result.normalized}, receiptsMigrated=${result.receiptsMigrated}`
    );
  }

  await platformConnection.close();
  await mongoose.disconnect().catch(() => {});
}

main().catch(async (err) => {
  console.error("Announcement migration failed:", err?.message || err);
  await platformConnection.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

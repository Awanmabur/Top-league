require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { platformConnection, waitForPlatform, getTenantConnection } = require("../src/config/db");
const loadTenantModels = require("../src/models/tenant/loadModels");
const { migrateMessages } = require("./lib/migrateMessages");

function tenantMatchesArg(tenant, requested) {
  if (!requested) return true;
  const target = String(requested).trim().toLowerCase();
  return [tenant.code, tenant.subdomain, tenant.dbName, String(tenant._id)]
    .map((v) => String(v || "").trim().toLowerCase()).includes(target);
}

async function main() {
  const requested = process.env.TENANT_CODE || process.argv.find((a) => a.startsWith("--tenant="))?.slice(9) || "";
  await waitForPlatform();
  const Tenant = platformConnection.models.Tenant || require("../src/models/platform/Tenant")(platformConnection);
  const tenants = await Tenant.find({ isDeleted: { $ne: true } }).select("_id code subdomain dbName").lean();
  const selected = tenants.filter((t) => tenantMatchesArg(t, requested));
  if (requested && !selected.length) throw new Error(`No tenant found for ${requested}`);
  const conns = [];
  for (const tenant of selected) {
    if (!tenant.dbName) continue;
    const conn = await getTenantConnection(tenant.dbName); conns.push(conn);
    const result = await migrateMessages(loadTenantModels(conn));
    console.log(`[ok] ${tenant.code || tenant.dbName}: scanned=${result.scanned}, normalized=${result.normalized}, recipientsMigrated=${result.recipientsMigrated}`);
  }
  await Promise.allSettled(conns.map((c) => c.close()));
  await platformConnection.close();
  await mongoose.disconnect().catch(() => {});
}
main().catch(async (err) => {
  console.error("Message migration failed:", err.message || err);
  await platformConnection.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

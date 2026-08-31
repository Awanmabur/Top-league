require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { platformConnection, waitForPlatform, getTenantConnection } = require("../src/config/db");
const loadTenantModels = require("../src/models/tenant/loadModels");
const TenantModel = require("../src/models/platform/Tenant");
const { migrateScholarships } = require("./lib/migrateScholarships");

async function main() {
  await waitForPlatform();
  const Tenant = TenantModel(platformConnection);
  const requested = process.env.TENANT_CODE || process.argv.find((a) => a.startsWith("--tenant="))?.slice(9) || "";
  const tenants = await Tenant.find({ isDeleted: { $ne: true } }).select("name code subdomain dbName").lean();
  const selected = tenants.filter((t) => !requested || [t.code, t.subdomain, t.dbName, String(t._id)].some((v) => String(v || "").toLowerCase() === requested.toLowerCase()));
  if (requested && !selected.length) throw new Error(`No tenant found for ${requested}`);
  const conns = [];
  for (const tenant of selected) {
    if (!tenant.dbName) continue;
    const conn = await getTenantConnection(tenant.dbName); conns.push(conn);
    const lazy = loadTenantModels(conn); const models = {}; for (const name of Object.keys(lazy)) models[name] = lazy[name];
    const result = await migrateScholarships(models);
    console.log(`[ok] ${tenant.code || tenant.dbName}:`, result);
  }
  await Promise.allSettled(conns.map((c) => c.close()));
  await platformConnection.close(); await mongoose.disconnect().catch(() => {});
}
main().catch(async (err) => { console.error("Scholarship migration failed:", err.message || err); await platformConnection.close().catch(() => {}); await mongoose.disconnect().catch(() => {}); process.exit(1); });

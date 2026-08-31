require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { platformConnection, waitForPlatform, getTenantConnection } = require("../src/config/db");
const loadTenantModels = require("../src/models/tenant/loadModels");
const { migrateAdmissions } = require("./lib/migrateAdmissions");

async function main() {
  await waitForPlatform();
  const Tenant = platformConnection.models.Tenant || require("../src/models/platform/Tenant")(platformConnection);
  const requested = process.env.TENANT_CODE || process.argv.find((a) => a.startsWith("--tenant="))?.slice(9) || "";
  const tenants = await Tenant.find({ isDeleted: { $ne: true }, dbName: { $nin: [null, ""] } })
    .select("_id code subdomain dbName").lean();
  const selected = requested
    ? tenants.filter((t) => [t.code, t.subdomain, t.dbName, String(t._id)].map((v) => String(v || "").toLowerCase()).includes(requested.toLowerCase()))
    : tenants;
  if (requested && !selected.length) throw new Error(`No tenant found for ${requested}`);

  const connections = [];
  for (const tenant of selected) {
    const conn = await getTenantConnection(tenant.dbName);
    connections.push(conn);
    const result = await migrateAdmissions(loadTenantModels(conn));
    console.log(`${tenant.code || tenant.dbName}: applicants=${result.applicantsScanned} letters=${result.lettersScanned} normalizedApplicants=${result.normalizedApplicants} repairedApplicationIds=${result.repairedApplicationIds} repairedLetterNumbers=${result.repairedLetterNumbers}`);
  }
  await Promise.allSettled(connections.map((c) => c.close()));
  await platformConnection.close();
  await mongoose.disconnect().catch(() => {});
}

main().catch(async (err) => {
  console.error("Admissions migration failed:", err.message || err);
  await platformConnection.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

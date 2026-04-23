require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");

const {
  platformConnection,
  waitForPlatform,
  getTenantConnection,
} = require("../src/config/db");
const loadTenantModels = require("../src/models/tenant/loadModels");

const platformModelNames = [
  "Tenant",
  "Plan",
  "PlatformPayment",
  "SupportTicket",
  "PlatformAnnouncement",
  "AuditLog",
  "PlatformUser",
  "PlatformSetting",
];

function loadPlatformModels() {
  for (const name of platformModelNames) {
    require(`../src/models/platform/${name}`)(platformConnection);
  }
  return platformConnection.models;
}

function instantiateTenantModels(conn) {
  const lazyModels = loadTenantModels(conn);
  const models = {};

  for (const name of Object.keys(lazyModels)) {
    models[name] = lazyModels[name];
  }

  return models;
}

async function createModelIndexes(scope, models) {
  const entries = Object.entries(models);
  let ok = 0;
  let failed = 0;

  for (const [name, Model] of entries) {
    const indexes = Model.schema.indexes();

    if (!indexes.length) {
      console.log(`[skip] ${scope}.${name}: no declared indexes`);
      continue;
    }

    for (const [fields, options = {}] of indexes) {
      const indexName = options.name || Object.entries(fields)
        .map(([field, direction]) => `${field}_${direction}`)
        .join("_");

      try {
        await Model.collection.createIndex(fields, options);
        ok += 1;
        console.log(`[ok] ${scope}.${name}.${indexName}`);
      } catch (err) {
        failed += 1;
        console.error(`[failed] ${scope}.${name}.${indexName}: ${err.message || err}`);
      }
    }
  }

  return { ok, failed };
}

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

  console.log("Creating platform indexes...");
  const platformModels = loadPlatformModels();
  const platformResult = await createModelIndexes("platform", platformModels);

  const Tenant = platformModels.Tenant;
  const tenants = await Tenant.find({ isDeleted: { $ne: true } })
    .select("name code subdomain dbName")
    .lean();

  const selectedTenants = tenants.filter((tenant) => tenantMatchesArg(tenant, requestedTenant));

  if (requestedTenant && !selectedTenants.length) {
    throw new Error(`No tenant found for ${requestedTenant}`);
  }

  console.log(`Creating tenant indexes for ${selectedTenants.length} tenant(s)...`);

  const tenantConnections = [];
  const totals = {
    ok: platformResult.ok,
    failed: platformResult.failed,
  };

  for (const tenant of selectedTenants) {
    if (!tenant.dbName) {
      console.warn(`[skip] tenant ${tenant.code || tenant._id} has no dbName`);
      continue;
    }

    const label = tenant.code || tenant.dbName;
    console.log(`Tenant ${label} (${tenant.dbName})`);

    const conn = await getTenantConnection(tenant.dbName);
    tenantConnections.push(conn);
    const tenantModels = instantiateTenantModels(conn);
    const result = await createModelIndexes(label, tenantModels);
    totals.ok += result.ok;
    totals.failed += result.failed;
  }

  await Promise.allSettled(tenantConnections.map((conn) => conn.close()));
  await platformConnection.close();
  await mongoose.disconnect().catch(() => {});

  console.log(`Index creation complete: ${totals.ok} model(s) ok, ${totals.failed} failed.`);

  if (totals.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error("Index creation failed:", err.message || err);
  await platformConnection.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

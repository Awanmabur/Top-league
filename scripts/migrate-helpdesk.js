require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');
const { platformConnection, waitForPlatform, getTenantConnection } = require('../src/config/db');
const defineTenant = require('../src/models/platform/Tenant');
const loadTenantModels = require('../src/models/tenant/loadModels');
const { migrateHelpdeskTickets } = require('./lib/migrateHelpdeskTickets');

function tenantMatchesArg(tenant, requested) {
  if (!requested) return true;
  const target = String(requested).trim().toLowerCase();
  return [tenant.code, tenant.subdomain, tenant.dbName, String(tenant._id)]
    .map((value) => String(value || '').trim().toLowerCase())
    .includes(target);
}

async function main() {
  const requestedTenant = process.env.TENANT_CODE || process.argv.find((arg) => arg.startsWith('--tenant='))?.slice(9) || '';
  await waitForPlatform();
  const Tenant = defineTenant(platformConnection);
  const tenants = await Tenant.find({ isDeleted: { $ne: true } }).select('name code subdomain dbName').lean();
  const selected = tenants.filter((tenant) => tenantMatchesArg(tenant, requestedTenant));
  if (requestedTenant && !selected.length) throw new Error(`No tenant found for ${requestedTenant}`);

  const connections = [];
  let scanned = 0;
  let updated = 0;
  let repairedNumbers = 0;
  for (const tenant of selected) {
    if (!tenant.dbName) continue;
    const conn = await getTenantConnection(tenant.dbName);
    connections.push(conn);
    const models = loadTenantModels(conn);
    const result = await migrateHelpdeskTickets(models.HelpdeskTicket);
    scanned += result.scanned;
    updated += result.updated;
    repairedNumbers += result.repairedNumbers;
    console.log(`[helpdesk] ${tenant.code || tenant.dbName}: scanned=${result.scanned} updated=${result.updated} ticketNumbersRepaired=${result.repairedNumbers}`);
  }

  await Promise.allSettled(connections.map((conn) => conn.close()));
  await platformConnection.close();
  await mongoose.disconnect().catch(() => {});
  console.log(`Helpdesk migration complete: tenants=${selected.length} scanned=${scanned} updated=${updated} ticketNumbersRepaired=${repairedNumbers}`);
}

main().catch(async (err) => {
  console.error('Helpdesk migration failed:', err.message || err);
  await platformConnection.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

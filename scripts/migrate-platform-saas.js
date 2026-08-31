require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { platformConnection, waitForPlatform } = require('../src/config/db');
const { migratePlatformSaas } = require('./lib/migratePlatformSaas');

const platformModelNames = ['Tenant', 'Plan', 'PlatformSubscription', 'PlatformPayment'];
function loadModels() {
  for (const name of platformModelNames) require(`../src/models/platform/${name}`)(platformConnection);
  return platformConnection.models;
}

async function main() {
  await waitForPlatform();
  const result = await migratePlatformSaas(loadModels());
  console.log(JSON.stringify(result, null, 2));
  await platformConnection.close();
  await mongoose.disconnect().catch(() => {});
}

main().catch(async (err) => {
  console.error('Platform SaaS migration failed:', err?.message || err);
  await platformConnection.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

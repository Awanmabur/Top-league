const { platformConnection, waitForPlatform } = require("../src/config/db");
const { migratePlatformOperations } = require("./lib/migratePlatformOperations");

const platformModelNames = [
  "PlatformConfig",
  "PlatformSetting",
  "PlatformUser",
  "SupportTicket",
  "AuditLog",
  "PlatformBooking",
];

async function main() {
  await waitForPlatform();
  const models = {};
  for (const name of platformModelNames) {
    models[name] = require(`../src/models/platform/${name}`)(platformConnection);
  }
  const result = await migratePlatformOperations(models);
  console.log(JSON.stringify(result, null, 2));
  await platformConnection.close();
}

main().catch(async (error) => {
  console.error(error?.stack || error);
  try { await platformConnection.close(); } catch (_) {}
  process.exitCode = 1;
});

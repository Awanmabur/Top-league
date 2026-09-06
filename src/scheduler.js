require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  require('./config/productionReadiness').assertProductionReadiness(process.env);
}
process.env.SCHEDULER_PROCESS = '1';

const { waitForPlatform, platformConnection } = require('./config/db');
const { connectRedis, closeRedis } = require('./config/redis');
const { startAnnouncementScheduler, stopAnnouncementScheduler } = require('./services/tenant/announcementScheduler');
const { startMessageScheduler, stopMessageScheduler } = require('./services/tenant/messageScheduler');
const { startEventScheduler, stopEventScheduler } = require('./services/tenant/eventScheduler');
const { startLeaveScheduler, stopLeaveScheduler } = require('./services/tenant/leaveScheduler');
const { startBackupScheduler, stopBackupScheduler } = require('./services/tenant/backupScheduler');
const { startPlatformSubscriptionScheduler, stopPlatformSubscriptionScheduler } = require('./services/platformSubscriptionScheduler');
const { startGoogleCalendarHealthScheduler, stopGoogleCalendarHealthScheduler } = require('./services/googleCalendarHealthScheduler');

function startAll() {
  startAnnouncementScheduler();
  startMessageScheduler();
  startEventScheduler();
  startLeaveScheduler();
  startBackupScheduler();
  startPlatformSubscriptionScheduler();
  startGoogleCalendarHealthScheduler();
}
function stopAll() {
  stopAnnouncementScheduler();
  stopMessageScheduler();
  stopEventScheduler();
  stopLeaveScheduler();
  stopBackupScheduler();
  stopPlatformSubscriptionScheduler();
  stopGoogleCalendarHealthScheduler();
}

(async () => {
  try {
    await Promise.all([waitForPlatform(), connectRedis()]);
    startAll();
    console.log('Classic Academy scheduler worker running');
    const shutdown = async (signal) => {
      console.log(`${signal} received, stopping scheduler worker...`);
      stopAll();
      await Promise.allSettled([closeRedis(), platformConnection.close()]);
      process.exit(0);
    };
    process.once('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
    process.once('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)); });
  } catch (err) {
    console.error('Scheduler worker startup failed:', err);
    process.exit(1);
  }
})();

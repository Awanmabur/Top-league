const googleCalendar = require('./googleCalendarAuthService');
const { boundedNumber, initialDelayMs } = require('./schedulerTiming');

let timer = null;
let firstTimer = null;
let running = false;
let lastState = '';

function healthIntervalMs() {
  return boundedNumber('GOOGLE_CALENDAR_HEALTH_INTERVAL_MS', 6 * 60 * 60 * 1000, 15 * 60 * 1000, 24 * 60 * 60 * 1000);
}

async function checkGoogleCalendarHealth() {
  if (running || !googleCalendar.configured()) return { checked: false, reason: running ? 'busy' : 'not_configured' };
  running = true;
  try {
    const status = await googleCalendar.connectionStatus();
    if (!status.connected && status.authMode !== 'service_account') {
      const state = status.status || 'disconnected';
      if (state !== lastState) console.warn(`Google Calendar health: ${state}`);
      lastState = state;
      return { checked: false, reason: state };
    }
    await googleCalendar.testConnection();
    if (lastState && lastState !== 'connected') console.log('Google Calendar health: connected');
    lastState = 'connected';
    return { checked: true, ok: true };
  } catch (error) {
    const state = error?.code === 'GOOGLE_CALENDAR_RECONNECT_REQUIRED' ? 'reconnect_required' : 'error';
    if (state !== lastState) console.error(`Google Calendar health: ${state}`, error?.message || error);
    lastState = state;
    return { checked: true, ok: false, reason: state };
  } finally {
    running = false;
  }
}

function startGoogleCalendarHealthScheduler() {
  if (timer || firstTimer || !googleCalendar.configured()) return;
  const interval = healthIntervalMs();
  const delay = initialDelayMs('GOOGLE_CALENDAR_HEALTH_INITIAL_DELAY_MS', 90_000, interval);
  const begin = () => {
    firstTimer = null;
    checkGoogleCalendarHealth().catch(() => {});
    timer = setInterval(() => checkGoogleCalendarHealth().catch(() => {}), interval);
    timer.unref?.();
  };
  firstTimer = setTimeout(begin, delay);
  firstTimer.unref?.();
}

function stopGoogleCalendarHealthScheduler() {
  if (firstTimer) clearTimeout(firstTimer);
  if (timer) clearInterval(timer);
  firstTimer = null;
  timer = null;
  running = false;
  lastState = '';
}

module.exports = {
  healthIntervalMs,
  checkGoogleCalendarHealth,
  startGoogleCalendarHealthScheduler,
  stopGoogleCalendarHealthScheduler,
};

function boundedNumber(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function initialDelayMs(name, fallback, intervalMs) {
  const max = Math.max(0, Math.min(Number(intervalMs || 0) - 1000, 60_000));
  if (max <= 0) return 0;
  return boundedNumber(name, Math.min(fallback, max), 0, max);
}

function shouldRunSchedulersInWeb() {
  const raw = String(process.env.RUN_SCHEDULERS_IN_WEB || '').trim().toLowerCase();
  if (!raw) return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

module.exports = { boundedNumber, initialDelayMs, shouldRunSchedulersInWeb };

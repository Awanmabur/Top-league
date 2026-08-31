const crypto = require('crypto');

function str(v, max = 500) { return String(v ?? '').trim().slice(0, max); }
function escapeRegex(v) { return String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function safeFilename(v, fallback = 'report.csv') {
  const clean = String(v || '').replace(/[\r\n\0]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '').replace(/^-+|-+$/g, '').slice(0, 120);
  return clean || fallback;
}
function neutralizeFormula(v) {
  const text = String(v ?? '');
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}
function csvCell(v) {
  const s = neutralizeFormula(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function splitCsvRecords(text) {
  const records = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { i += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (!quoted && (ch === '\n' || ch === '\r')) {
      const row = text.slice(start, i);
      if (row.trim()) records.push(row);
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      start = i + 1;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  const tail = text.slice(start);
  if (tail.trim()) records.push(tail);
  return records;
}
function countCsvFields(record) {
  let count = 1;
  let quoted = false;
  for (let i = 0; i < record.length; i += 1) {
    const ch = record[i];
    if (ch === '"') {
      if (quoted && record[i + 1] === '"') { i += 1; continue; }
      quoted = !quoted;
    } else if (ch === ',' && !quoted) count += 1;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  return count;
}
function validateCsvBuffer(buffer, opts = {}) {
  const maxBytes = Number(opts.maxBytes || 2 * 1024 * 1024);
  const maxRows = Number(opts.maxRows || 5000);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('CSV file is empty.');
  if (buffer.length > maxBytes) throw new Error(`CSV file exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`);
  if (buffer.includes(0)) throw new Error('CSV file contains invalid binary data.');
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const records = splitCsvRecords(text);
  const allowHeaderOnly = opts.allowHeaderOnly === true;
  if (!records.length) throw new Error('CSV file has no header.');
  if (records.length < 2 && !allowHeaderOnly) throw new Error('CSV file contains no data rows.');
  if (records.length - 1 > maxRows) throw new Error(`CSV file exceeds ${maxRows} data rows.`);
  const headerCount = countCsvFields(records[0]);
  if (!headerCount || headerCount > 100) throw new Error('CSV header is invalid.');
  for (const row of records.slice(0, 100)) if (row.length > 100000) throw new Error('CSV row is too large.');
  return { text, rowsCount: records.length - 1, headerCount };
}
function positiveRevision(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}
async function readBoundedResponse(response, maxBytes = 20 * 1024 * 1024) {
  const limit = Math.max(1, Number(maxBytes) || 1);
  const declared = Number(response?.headers?.get?.('content-length') || 0);
  if (declared && declared > limit) throw new Error('Report artifact exceeds the allowed size.');
  if (!response?.body?.getReader) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > limit) throw new Error('Report artifact exceeds the allowed size.');
    return buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > limit) { try { await reader.cancel(); } catch (_) {} throw new Error('Report artifact exceeds the allowed size.'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function tenantDateParts(date, timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
}
function timezoneOffsetMinutes(date, timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === '24' ? 0 : p.hour), +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}
function dateOnlyBoundary(value, timezone = 'UTC', end = false) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const hour = end ? 23 : 0, minute = end ? 59 : 0, second = end ? 59 : 0, ms = end ? 999 : 0;
  let guess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], hour, minute, second, ms));
  for (let i = 0; i < 3; i++) {
    const off = timezoneOffsetMinutes(guess, timezone);
    guess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], hour, minute, second, ms) - off * 60000);
  }
  return guess;
}
function buildDateMatch(from, to, timezone = 'UTC', field = 'createdAt') {
  const start = dateOnlyBoundary(from, timezone, false);
  const finish = dateOnlyBoundary(to, timezone, true);
  if (!start && !finish) return {};
  const range = {};
  if (start) range.$gte = start;
  if (finish) range.$lte = finish;
  return { [field]: range };
}
function currentYear(timezone = 'UTC', now = new Date()) { return tenantDateParts(now, timezone).year; }
function strictModelScope(Model, value) {
  const v = str(value, 100);
  if (!v || v === 'all') return {};
  const has = (p) => { try { return !!Model?.schema?.path(p); } catch (_) { return false; } };
  if (has('schoolUnitCode')) return { schoolUnitCode: v };
  if (has('schoolUnitName')) return { schoolUnitName: new RegExp(`^${escapeRegex(v)}$`, 'i') };
  if (has('schoolUnitId')) return /^[a-f\d]{24}$/i.test(v) ? { schoolUnitId: v } : { _id: { $exists: false } };
  return { _id: { $exists: false } };
}
module.exports = { str, escapeRegex, safeFilename, neutralizeFormula, csvCell, sha256, splitCsvRecords, validateCsvBuffer, positiveRevision, readBoundedResponse, dateOnlyBoundary, buildDateMatch, currentYear, strictModelScope };

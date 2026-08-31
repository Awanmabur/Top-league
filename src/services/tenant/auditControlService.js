const crypto = require('crypto');
const SENSITIVE = /(pass(word|code)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|client[-_]?secret|refresh|otp|pin|credential|session)/i;
function maskIp(ip) {
  const s = String(ip || '').trim(); if (!s) return '';
  if (s.includes('.')) { const p=s.split('.'); if (p.length===4) return `${p[0]}.${p[1]}.${p[2]}.x`; }
  if (s.includes(':')) return `${s.split(':').slice(0,3).join(':')}::`;
  return '';
}
function ipHash(ip, salt='') { const s=String(ip||'').trim(); return s ? crypto.createHash('sha256').update(`${salt}|${s}`).digest('hex') : ''; }
function redact(value, depth = 0, key = '') {
  if (SENSITIVE.test(String(key || ''))) return '[redacted]';
  if (depth > 4) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {}; let count = 0;
    for (const [k,v] of Object.entries(value)) { if (count++ >= 60) { out._truncated='[truncated]'; break; } out[String(k).slice(0,80)] = redact(v, depth + 1, k); }
    return out;
  }
  return String(value).slice(0, 1000);
}
function csvCell(v) { let s=String(v??''); if (/^[\s]*[=+\-@]/.test(s)) s=`'${s}`; return `"${s.replace(/"/g,'""')}"`; }
function parseIds(value, max = 100) { return String(Array.isArray(value)?value.join(','):value||'').split(',').map(x=>x.trim()).filter(x=>/^[a-f\d]{24}$/i.test(x)).slice(0,max); }
module.exports = { redact, maskIp, ipHash, csvCell, parseIds, SENSITIVE };

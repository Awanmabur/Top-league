const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skipDirs = new Set(['node_modules', '.git', '.cache', 'coverage']);
const forbiddenNames = new Set(['.env', '.env.production', '.env.local', 'id_rsa', 'id_ed25519']);
const forbiddenExtensions = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.dump', '.bak']);
const forbiddenMarkers = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /-----BEGIN PRIVATE KEY-----/,
  /-----BEGIN ENCRYPTED PRIVATE KEY-----/,
];
const failures = [];
let scanned = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    scanned += 1;
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const lower = entry.name.toLowerCase();
    const ext = path.extname(lower);
    if (forbiddenNames.has(lower) || forbiddenExtensions.has(ext) || /(?:npm-debug|yarn-error).*\.log$/i.test(lower)) {
      failures.push(`forbidden release artifact: ${rel}`);
      continue;
    }
    // Runtime backup/export artifacts do not belong in a source release.
    if (/\.(?:zip|tgz|tar|gz)$/i.test(lower) && !rel.startsWith('public/')) {
      failures.push(`archive/runtime artifact inside source tree: ${rel}`);
      continue;
    }
    if (rel === 'scripts/check-release-hygiene.js') continue;
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.size > 2 * 1024 * 1024 || /\.(?:png|jpe?g|webp|gif|ico|pdf|woff2?|mp4|mp3)$/i.test(lower)) continue;
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    if (forbiddenMarkers.some((pattern) => pattern.test(text))) failures.push(`private-key material detected: ${rel}`);
  }
}

walk(root);
if (failures.length) {
  console.error('Release hygiene: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Release hygiene: PASS (${scanned} files scanned)`);

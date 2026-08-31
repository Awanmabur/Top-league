'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const viewRoots = ['views/platform', 'views/tenant', 'views/students', 'views/parents', 'views/staff'];
const formRe = /<form\b(?=[^>]*\bmethod\s*=\s*["']post["'])[^>]*>([\s\S]*?)<\/form>/gi;
const failures = [];
let checked = 0;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.ejs')) out.push(full);
  }
  return out;
}

for (const base of viewRoots) {
  for (const file of walk(path.join(root, base))) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    // Anonymous public review/inquiry/application submissions use dedicated
    // public abuse controls and cannot rely on an authenticated CSRF session.
    if (rel.includes('/public/')) continue;
    const text = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = formRe.exec(text))) {
      checked += 1;
      const body = match[1] || '';
      if (!body.includes('_csrf') && !body.includes('csrfToken')) {
        const line = text.slice(0, match.index).split('\n').length;
        failures.push(`${rel}:${line} POST form is missing a CSRF token`);
      }
    }
  }
}

if (failures.length) {
  console.error('Authenticated form CSRF: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Authenticated form CSRF: PASS (${checked} POST forms checked)`);

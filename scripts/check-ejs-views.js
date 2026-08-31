'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const viewsRoot = path.join(root, 'views');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.ejs')) files.push(full);
  }
}
walk(viewsRoot);
files.sort();

const failures = [];
for (const file of files) {
  try {
    ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });
  } catch (error) {
    failures.push({ file: path.relative(root, file), error: error?.stack || error?.message || String(error) });
  }
}
if (failures.length) {
  console.error(`EJS compile: FAIL (${failures.length}/${files.length} templates)`);
  for (const failure of failures) console.error(`\n${failure.file}\n${failure.error}`);
  process.exit(1);
}
console.log(`EJS compile: PASS (${files.length}/${files.length} templates)`);

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const roots = ['src', 'scripts', 'tests', 'public'];
const skipDirs = new Set(['node_modules', '.git', '.cache', 'coverage', 'vendor']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = roots.flatMap((dir) => walk(path.join(root, dir))).sort();
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push({ file: path.relative(root, file), output: String(result.stderr || result.stdout || '').trim() });
  }
}

if (failures.length) {
  console.error(`JavaScript syntax: FAIL (${failures.length}/${files.length} files)`);
  for (const failure of failures) {
    console.error(`\n${failure.file}\n${failure.output}`);
  }
  process.exit(1);
}
console.log(`JavaScript syntax: PASS (${files.length}/${files.length} files)`);

try { require('dotenv').config({ quiet: true }); } catch (_) {}
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateProductionReadiness, PINNED_NODE_VERSION } = require('../src/config/productionReadiness');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function main() {
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockPath = path.join(root, 'package-lock.json');
  const readiness = validateProductionReadiness(process.env);
  const engine = pkg.engines?.node || '';
  const lockHash = sha256(lockPath);
  const payload = {
    ok: readiness.ok && engine === PINNED_NODE_VERSION,
    node: { current: process.versions.node, required: PINNED_NODE_VERSION, packageEngine: engine },
    dependencyLockSha256: lockHash,
    checks: readiness.checks,
    warnings: readiness.warnings,
    errors: [
      ...(engine === PINNED_NODE_VERSION ? [] : [`package.json engines.node must remain exactly ${PINNED_NODE_VERSION}.`]),
      ...readiness.errors,
    ],
  };

  if (process.argv.includes('--json')) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Classic Academy production readiness: ${payload.ok ? 'PASS' : 'FAIL'}`);
    console.log(`Node: ${payload.node.current} (required ${payload.node.required})`);
    console.log(`package-lock SHA-256: ${payload.dependencyLockSha256}`);
    for (const warning of payload.warnings) console.log(`WARN: ${warning}`);
    for (const error of payload.errors) console.error(`FAIL: ${error}`);
  }
  if (!payload.ok) process.exitCode = 1;
}

main();

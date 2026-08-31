const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));

function versionParts(v) { return String(v || "0").split(".").map((x) => Number(x.replace(/\D.*$/, "")) || 0); }
function atLeast(v, wanted) {
  const a = versionParts(v), b = versionParts(wanted);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
}

function locked(name) { return lock.packages?.[`node_modules/${name}`]?.version || ""; }

test("release removes unused vulnerable image/utility direct dependencies and upgrades Nodemailer", () => {
  assert.equal(pkg.dependencies.sharp, undefined);
  assert.equal(pkg.dependencies.lodash, undefined);
  assert.match(pkg.dependencies.nodemailer, /^\^9\./);
  assert.ok(atLeast(locked("nodemailer"), "9.0.6"));
});

test("release lock carries patched production dependency minimums", () => {
  const minimums = {
    multer: "2.2.0", mongoose: "8.24.1", joi: "18.2.1", morgan: "1.10.2",
    "express-rate-limit": "8.5.1", qs: "6.15.2", "path-to-regexp": "8.4.0",
    "ip-address": "10.3.1", "brace-expansion": "2.1.4",
  };
  for (const [name, minimum] of Object.entries(minimums)) assert.ok(atLeast(locked(name), minimum), `${name} ${locked(name)} < ${minimum}`);
});

test("archived csurf resolves its cookie parser to the patched compatible line", () => {
  assert.equal(pkg.overrides?.cookie, "0.7.2");
  assert.ok(atLeast(locked("cookie"), "0.7.0"));
  assert.equal(lock.packages?.["node_modules/csurf/node_modules/cookie"], undefined);
});

test("mailer disables Nodemailer file/URL content access and normalizes header strings", () => {
  const src = read("src/utils/mailer.js");
  assert.match(src, /disableFileAccess: true/);
  assert.match(src, /disableUrlAccess: true/);
  assert.match(src, /replace\(\/\[\\r\\n\\u2028\\u2029\]\+\/g/);
  assert.match(src, /mailBody\(html/);
  assert.match(src, /mailBody\(text/);
});

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const rel = (...parts) => path.join(root, ...parts);
const jsFiles = [
  'src/models/tenant/HelpdeskTicket.js',
  'src/models/tenant/HelpdeskTemplate.js',
  'src/models/tenant/loadModels.js',
  'src/services/tenant/helpdeskService.js',
  'src/controllers/tenant/students/supportController.js',
  'src/controllers/tenant/parents/supportController.js',
  'src/controllers/tenant/staff/supportController.js',
  'src/controllers/tenant/admin/helpdeskController.js',
  'src/routes/tenant/students/support.js',
  'src/routes/tenant/parents/support.js',
  'src/routes/tenant/staff/support.js',
  'src/routes/tenant/admin/helpdesk.js',
  'public/js/helpdesk.js',
  'src/utils/tenantPlanAccess.js',
  'scripts/seedPlatformPlans.js',
  'scripts/lib/migrateHelpdeskTickets.js',
  'scripts/migrate-helpdesk.js',
  'scripts/create-indexes.js',
];
const ejsFiles = [
  'views/students/support.ejs',
  'views/parents/support.ejs',
  'views/staff/support.ejs',
  'views/tenant/helpdesk/index.ejs',
  'views/tenant/helpdesk/templates.ejs',
  'views/platform/plans/create.ejs',
  'views/platform/plans/edit.ejs',
];

for (const file of jsFiles) {
  execFileSync(process.execPath, ['--check', rel(file)], { stdio: 'pipe' });
}
for (const file of ejsFiles) {
  const src = fs.readFileSync(rel(file), 'utf8');
  ejs.compile(src, { filename: rel(file) });
}

const requesterSources = [
  'src/controllers/tenant/students/supportController.js',
  'src/controllers/tenant/parents/supportController.js',
  'src/controllers/tenant/staff/supportController.js',
  'src/routes/tenant/students/index.js',
  'src/routes/tenant/parents/index.js',
  'src/routes/tenant/staff/index.js',
].map((file) => fs.readFileSync(rel(file), 'utf8')).join('\n');
if (/SupportTicket|createdByUserId/.test(requesterSources)) {
  throw new Error('Legacy Helpdesk contract reference detected.');
}

console.log(`Helpdesk verification passed: ${jsFiles.length} JavaScript files syntax-checked, ${ejsFiles.length} EJS views compiled, legacy requester contract scan clean.`);

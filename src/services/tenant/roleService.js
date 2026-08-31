const ROLE_PERMISSION_CATALOG = Object.freeze([
  { key: "dashboard", label: "Dashboard", permission: "dashboard.view" },
  { key: "admissions", label: "Admissions", permission: "admissions.manage" },
  { key: "students", label: "Students", permission: "students.manage" },
  { key: "parents", label: "Parents", permission: "parents.manage" },
  { key: "promotions", label: "Promotions", permission: "promotions.manage" },
  { key: "subjects", label: "Subjects", permission: "subjects.manage" },
  { key: "classes", label: "Classes", permission: "classes.manage" },
  { key: "sections", label: "Sections", permission: "sections.manage" },
  { key: "streams", label: "Streams", permission: "streams.manage" },
  { key: "exams", label: "Exams", permission: "exams.manage" },
  { key: "results", label: "Results", permission: "results.manage" },
  { key: "transcripts", label: "Transcripts", permission: "transcripts.manage" },
  { key: "assignments", label: "Assignments", permission: "assignments.manage" },
  { key: "attendance", label: "Attendance", permission: "attendance.manage" },
  { key: "timetable", label: "Timetable", permission: "timetable.manage" },
  { key: "academicCalendar", label: "Academic Calendar", permission: "academicCalendar.manage" },
  { key: "finance", label: "Finance", permission: "finance.manage" },
  { key: "staff", label: "Staff", permission: "staff.manage" },
  { key: "users", label: "Users", permission: "users.manage" },
  { key: "roles", label: "Roles", permission: "roles.manage" },
  { key: "leave", label: "Leave", permission: "leave.manage" },
  { key: "payroll", label: "Payroll", permission: "payroll.manage" },
  { key: "studentDocs", label: "Student Documents", permission: "studentDocs.manage" },
  { key: "discipline", label: "Discipline", permission: "discipline.manage" },
  { key: "notifications", label: "Notifications", permission: "notifications.manage" },
  { key: "announcements", label: "Announcements", permission: "announcements.manage" },
  { key: "messaging", label: "Messaging", permission: "messaging.manage" },
  { key: "inquiries", label: "Inquiries", permission: "inquiries.manage" },
  { key: "library", label: "Library", permission: "library.manage" },
  { key: "hostels", label: "Hostels", permission: "hostels.manage" },
  { key: "transport", label: "Transport", permission: "transport.manage" },
  { key: "assets", label: "Assets", permission: "assets.manage" },
  { key: "events", label: "Events", permission: "events.manage" },
  { key: "helpdesk", label: "Helpdesk", permission: "helpdesk.manage" },
  { key: "reports", label: "Reports", permission: "reports.view" },
  { key: "auditlogs", label: "Audit Logs", permission: "auditlogs.view" },
  { key: "backups", label: "Backups", permission: "backups.manage" },
  { key: "system", label: "System Health", permission: "system.manage" },
  { key: "settings", label: "Settings", permission: "settings.manage" },
  { key: "integrations", label: "API Integrations", permission: "integrations.manage" },
]);

const CANONICAL_PERMISSIONS = new Set(ROLE_PERMISSION_CATALOG.map((item) => item.permission));

const LEGACY_PERMISSION_MAP = Object.freeze({
  dashboard: "dashboard.view",
  admissions: "admissions.manage",
  students: "students.manage",
  parents: "parents.manage",
  promotions: "promotions.manage",
  staff: "staff.manage",
  users: "users.manage",
  roles: "roles.manage",
  leave: "leave.manage",
  payroll: "payroll.manage",
  programs: "admissions.manage",
  courses: "subjects.manage",
  subjects: "subjects.manage",
  classes: "classes.manage",
  sections: "sections.manage",
  streams: "streams.manage",
  exams: "exams.manage",
  attendance: "attendance.manage",
  results: "results.manage",
  transcripts: "transcripts.manage",
  assignments: "assignments.manage",
  timetable: "timetable.manage",
  academicCalendar: "academicCalendar.manage",
  finance: "finance.manage",
  invoices: "finance.manage",
  payments: "finance.manage",
  studentStatements: "finance.manage",
  feeStructures: "finance.manage",
  scholarships: "finance.manage",
  financeReports: "finance.manage",
  expenses: "finance.manage",
  studentDocs: "studentDocs.manage",
  discipline: "discipline.manage",
  notifications: "notifications.manage",
  library: "library.manage",
  hostels: "hostels.manage",
  transport: "transport.manage",
  assets: "assets.manage",
  events: "events.manage",
  announcements: "announcements.manage",
  messaging: "messaging.manage",
  helpdesk: "helpdesk.manage",
  inquiries: "inquiries.manage",
  reports: "reports.view",
  auditlogs: "auditlogs.view",
  backups: "backups.manage",
  system: "system.manage",
  settings: "settings.manage",
  integrations: "integrations.manage",
});

function normalizeRoleCode(value) {
  const clean = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return clean || null;
}

function normalizePermission(value) {
  const clean = String(value || "").trim();
  if (!clean || clean === "*") return null;
  if (CANONICAL_PERMISSIONS.has(clean)) return clean;
  if (LEGACY_PERMISSION_MAP[clean]) return LEGACY_PERMISSION_MAP[clean];
  return null;
}

function normalizePermissionList(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const permission = normalizePermission(item);
    if (!permission || seen.has(permission)) continue;
    seen.add(permission);
    out.push(permission);
  }
  return out.sort();
}

function parsePermissionForm(body = {}) {
  const selected = [];
  for (const item of ROLE_PERMISSION_CATALOG) {
    const raw = String(body[`perm_${item.key}`] || "").trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(raw)) selected.push(item.permission);
  }
  return normalizePermissionList(selected);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = {
  ROLE_PERMISSION_CATALOG,
  LEGACY_PERMISSION_MAP,
  normalizeRoleCode,
  normalizePermission,
  normalizePermissionList,
  parsePermissionForm,
  escapeRegex,
  csvCell,
};

const mongoose = require("mongoose");

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "confirmpassword",
  "currentpassword",
  "newpassword",
  "token",
  "jwttoken",
  "authorization",
  "secret",
]);

const MODULE_LABELS = {
  "academic-calendar": "Academic Calendar",
  "admissions": "Admissions",
  "announcements": "Announcements",
  "api": "API",
  "auditlogs": "Audit Logs",
  "backups": "Backups",
  "classes": "Classes",
  "discipline": "Discipline",
  "fee-structures": "Fee Structures",
  "finance": "Finance",
  "finance-reports": "Finance Reports",
  "hostels": "Hostels",
  "inquiries": "Inquiries",
  "integrations": "Integrations",
  "invoices": "Invoices",
  "messaging": "Messaging",
  "notifications": "Notifications",
  "parents": "Parents",
  "payroll": "Payroll",
  "promotions": "Promotions",
  "reports": "Reports",
  "roles": "Roles",
  "sections": "Sections",
  "settings": "Settings",
  "staff": "Staff",
  "staff-leave": "Staff Leave",
  "student-docs": "Student Documents",
  "student-statements": "Student Statements",
  "students": "Students",
  "subjects": "Subjects",
  "system": "System Health",
  "timetable": "Timetable",
  "transport": "Transport",
  "users": "Users",
};

function titleize(value = "") {
  return String(value || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getActorUserId(req) {
  const raw = req.user?.userId || req.user?._id || req.session?.tenantUser?.id;
  return raw && mongoose.Types.ObjectId.isValid(String(raw))
    ? new mongoose.Types.ObjectId(String(raw))
    : null;
}

function normalizeBody(body) {
  if (!body || typeof body !== "object") return {};

  return Object.fromEntries(
    Object.entries(body).slice(0, 40).map(([key, value]) => {
      const normalizedKey = String(key || "").toLowerCase();
      if (SENSITIVE_KEYS.has(normalizedKey)) return [key, "[redacted]"];
      if (Array.isArray(value)) return [key, value.slice(0, 10).map((x) => String(x).slice(0, 120))];
      if (value && typeof value === "object") return [key, "[object]"];
      return [key, String(value ?? "").slice(0, 250)];
    }),
  );
}

function parseAdminPath(req) {
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  const segments = path.split("/").filter(Boolean);
  const adminIndex = segments.indexOf("admin");
  const afterAdmin = adminIndex >= 0 ? segments.slice(adminIndex + 1) : segments;
  const moduleKey = afterAdmin[0] || "dashboard";
  const actionHint = afterAdmin.length > 1 ? afterAdmin[afterAdmin.length - 1] : "";
  const entityId = afterAdmin.find((part) => mongoose.Types.ObjectId.isValid(String(part)));

  return {
    path,
    moduleKey,
    moduleName: MODULE_LABELS[moduleKey] || titleize(moduleKey || "Admin"),
    actionHint,
    entityId: entityId ? new mongoose.Types.ObjectId(String(entityId)) : null,
  };
}

function actionLabel(method, actionHint, moduleName) {
  const hint = String(actionHint || "").trim();
  if (hint && !mongoose.Types.ObjectId.isValid(hint)) {
    return `${titleize(hint)} ${moduleName}`.trim();
  }

  if (method === "POST") return `Saved ${moduleName}`;
  if (method === "PUT" || method === "PATCH") return `Updated ${moduleName}`;
  if (method === "DELETE") return `Deleted ${moduleName}`;
  return `${method} ${moduleName}`.trim();
}

function severityFor(method, actionHint, statusCode) {
  const hint = String(actionHint || "").toLowerCase();
  if (statusCode >= 500) return "Critical";
  if (method === "DELETE" || hint.includes("delete") || hint.includes("void") || hint.includes("archive")) {
    return "Warning";
  }
  if (hint.includes("status") || hint.includes("approve") || hint.includes("reject") || hint.includes("bulk")) {
    return "Warning";
  }
  return "Info";
}

module.exports = function auditAdminActions(req, res, next) {
  const method = String(req.method || "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return next();
  if (!req.models?.AuditLog) return next();

  const startedAt = Date.now();
  const { path, moduleName, actionHint, entityId } = parseAdminPath(req);

  res.on("finish", () => {
    if (res.statusCode >= 400) return;

    const AuditLog = req.models?.AuditLog;
    if (!AuditLog) return;

    const payload = {
      actorUserId: getActorUserId(req),
      actorName: req.user?.fullName || req.user?.name || req.user?.email || "Admin",
      actorEmail: req.user?.email || "",
      action: actionLabel(method, actionHint, moduleName),
      module: moduleName,
      entityType: moduleName,
      entityId,
      entityLabel: entityId ? String(entityId) : "",
      severity: severityFor(method, actionHint, res.statusCode),
      ipAddress: req.ip || "",
      source: "admin",
      metadata: {
        method,
        path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        body: normalizeBody(req.body),
      },
    };

    AuditLog.create(payload).catch((err) => {
      console.error("tenant audit log failed:", err.message || err);
    });
  });

  return next();
};
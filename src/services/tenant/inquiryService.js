const VALID_STATUSES = new Set(["new", "read", "resolved"]);

function str(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeRegex(value) {
  return str(value, 200).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeStatus(value, fallback = "new") {
  const status = str(value, 32).toLowerCase();
  return VALID_STATUSES.has(status) ? status : fallback;
}

function buildInquiryFilter(query = {}) {
  const clauses = [{ isDeleted: { $ne: true } }];
  const q = str(query.q, 200);
  const status = str(query.status || "all", 32).toLowerCase();

  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    clauses.push({
      $or: [
        { name: rx },
        { contact: rx },
        { message: rx },
        { schoolCode: rx },
      ],
    });
  }

  if (status === "new") {
    clauses.push({
      $or: [
        { status: "new" },
        { status: { $exists: false } },
        { status: null },
        { status: "" },
      ],
    });
  } else if (status === "read" || status === "resolved") {
    clauses.push({ status });
  }

  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function actorUserId(req) {
  return req?.user?._id || req?.session?.user?._id || req?.session?.userId || null;
}

function canMarkRead(status) {
  const normalized = normalizeStatus(status);
  return normalized === "new" || normalized === "read";
}

function canResolve(status) {
  const normalized = normalizeStatus(status);
  return normalized !== "resolved";
}

module.exports = {
  VALID_STATUSES,
  str,
  escapeRegex,
  normalizeStatus,
  buildInquiryFilter,
  csvCell,
  actorUserId,
  canMarkRead,
  canResolve,
};

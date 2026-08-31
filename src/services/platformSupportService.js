const crypto = require("crypto");

const STATUSES = new Set(["open", "pending", "resolved", "closed"]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const CATEGORIES = new Set(["billing", "technical", "account", "setup", "feature_request", "other"]);

const TRANSITIONS = {
  open: new Set(["pending", "resolved", "closed"]),
  pending: new Set(["open", "resolved", "closed"]),
  resolved: new Set(["open", "closed"]),
  closed: new Set(["open"]),
};

function text(value, max = 5000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function positiveRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) throw new Error("A current positive revision is required.");
  return revision;
}

function ticketNumber(now = new Date()) {
  const date = new Date(now);
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  return `TKT-${stamp}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function normalizeStatus(value, fallback = "open") {
  const status = text(value, 32).toLowerCase();
  return STATUSES.has(status) ? status : fallback;
}

function normalizePriority(value, fallback = "medium") {
  const priority = text(value, 32).toLowerCase();
  return PRIORITIES.has(priority) ? priority : fallback;
}

function normalizeCategory(value, fallback = "technical") {
  const category = text(value, 40).toLowerCase();
  return CATEGORIES.has(category) ? category : fallback;
}

function validateRequesterEmail(value) {
  const email = text(value, 180).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Requester email is invalid.");
  return email;
}

function assertStatusTransition(from, to) {
  const source = normalizeStatus(from, "");
  const target = normalizeStatus(to, "");
  if (!source || !target) throw new Error("Support ticket status is invalid.");
  if (source === target) return true;
  if (!TRANSITIONS[source]?.has(target)) throw new Error(`Support ticket cannot move from ${source} to ${target}.`);
  return true;
}

function statusDates(from, to, current = {}, now = new Date()) {
  const target = normalizeStatus(to);
  const patch = {};
  if (target === "resolved") patch.resolvedAt = current.resolvedAt || new Date(now);
  if (target === "closed") patch.closedAt = current.closedAt || new Date(now);
  if (target === "open" && from !== "open") {
    patch.resolvedAt = null;
    patch.closedAt = null;
  }
  return patch;
}

module.exports = {
  STATUSES,
  PRIORITIES,
  CATEGORIES,
  TRANSITIONS,
  text,
  positiveRevision,
  ticketNumber,
  normalizeStatus,
  normalizePriority,
  normalizeCategory,
  validateRequesterEmail,
  assertStatusTransition,
  statusDates,
};

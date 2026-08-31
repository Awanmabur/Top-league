const crypto = require("crypto");
const mongoose = require("mongoose");
const { assertProgramAssignment } = require("./organizationCatalogService");

const STATUSES = new Set(["Active", "Inactive", "Archived"]);

function str(v, max = 1000) { return String(v || "").trim().slice(0, max); }
function isValidId(v) { return mongoose.Types.ObjectId.isValid(String(v || "").trim()); }
function escapeRegex(v) { return String(v || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function money(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, n) : 0; }
function bool(v) { return ["1", "true", "yes", "on"].includes(String(v || "").toLowerCase()); }
function actorId(req) { return req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null; }

function structureCodeCandidate(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `FS-${date}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function parseItems(body = {}) {
  const arr = (v) => Array.isArray(v) ? v : [v];
  const titles = arr(body.itemTitle);
  const categories = arr(body.itemCategory);
  const amounts = arr(body.itemAmount);
  const requireds = arr(body.itemRequired);
  const notes = arr(body.itemNote);
  const max = Math.min(100, Math.max(titles.length, categories.length, amounts.length, requireds.length, notes.length));
  const items = [];
  for (let i = 0; i < max; i += 1) {
    const title = str(titles[i], 160);
    if (!title) continue;
    items.push({
      title,
      category: str(categories[i] || "Other", 80) || "Other",
      amount: money(amounts[i]),
      required: bool(requireds[i]),
      note: str(notes[i], 300),
    });
  }
  return items;
}

function normalizeStatus(value, fallback = "Active") {
  const raw = str(value, 20);
  return STATUSES.has(raw) ? raw : fallback;
}

function parsePayload(body = {}) {
  const items = parseItems(body);
  return {
    name: str(body.name, 180),
    programId: isValidId(body.programId) ? body.programId : null,
    classId: isValidId(body.classId) ? body.classId : null,
    intakeId: isValidId(body.intakeId) ? body.intakeId : null,
    academicYear: str(body.academicYear, 40),
    term: str(body.term, 80),
    status: normalizeStatus(body.status),
    items,
    notes: str(body.notes, 2000),
    totalAmount: items.reduce((sum, item) => sum + money(item.amount), 0),
  };
}

function validatePayload(payload) {
  if (!payload.name) throw new Error("Structure name is required.");
  if (!payload.items.length) throw new Error("Add at least one fee item.");
  if (!(payload.totalAmount > 0)) throw new Error("Structure total must be greater than zero.");
  return payload;
}

async function assertReference(Model, id, label) {
  if (!id) return;
  if (!Model || !(await Model.exists({ _id: id }))) throw new Error(`Select a valid ${label}.`);
}

async function validateReferences(models, payload, currentProgramId = null) {
  if (payload.programId) payload.programId = await assertProgramAssignment(models.Program, payload.programId, currentProgramId);
  await assertReference(models.Class, payload.classId, "class");
  await assertReference(models.Intake, payload.intakeId, "intake");
}

async function createStructure(FeeStructure, data, maxAttempts = 8) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await FeeStructure.create({ ...data, structureCode: structureCodeCandidate() });
    } catch (err) {
      if (err?.code === 11000 && (err?.keyPattern?.structureCode || err?.keyValue?.structureCode)) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique fee structure code.");
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function serialize(doc = {}) {
  const program = doc.programId || null;
  const cls = doc.classId || null;
  const intake = doc.intakeId || null;
  const name = (x) => x?.title || x?.shortTitle || x?.name || x?.code || "—";
  return {
    id: String(doc._id || ""),
    code: doc.structureCode || "",
    name: doc.name || "",
    programId: program?._id ? String(program._id) : String(doc.programId || ""),
    programName: name(program),
    classId: cls?._id ? String(cls._id) : String(doc.classId || ""),
    className: name(cls),
    intakeId: intake?._id ? String(intake._id) : String(doc.intakeId || ""),
    intakeName: name(intake),
    academicYear: doc.academicYear || "",
    term: doc.term || "",
    status: doc.status || "Inactive",
    items: Array.isArray(doc.items) ? doc.items.map((x) => ({
      title: x.title || "", category: x.category || "Other", amount: Number(x.amount || 0), required: x.required !== false, note: x.note || "",
    })) : [],
    totalAmount: Number(doc.totalAmount || 0),
    itemsCount: Number(doc.itemsCount ?? doc.items?.length ?? 0),
    requiredItemsCount: Number(doc.requiredItemsCount ?? (doc.items || []).filter((x) => x.required !== false).length),
    notes: doc.notes || "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString().slice(0, 10) : "",
  };
}

module.exports = {
  str, isValidId, escapeRegex, money, actorId, structureCodeCandidate, parseItems, normalizeStatus,
  parsePayload, validatePayload, validateReferences, createStructure, csvCell, serialize,
};

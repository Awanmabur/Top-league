const mongoose = require("mongoose");

const id = (v) => String(v?._id || v || "").trim();
const validId = (v) => mongoose.Types.ObjectId.isValid(id(v));
const text = (v, max = 2000) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

function normalizeCode(v, fallback = "") {
  return String(v || fallback || "")
    .trim().toUpperCase().replace(/&/g, "AND").replace(/[^A-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
}

function parseRevision(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error("A valid record revision is required. Reload and try again.");
  return n;
}

function normalizeProgramInput(input = {}) {
  const name = text(input.name || input.title, 180);
  const code = normalizeCode(input.code, input.shortTitle || name);
  if (!name || !code) throw new Error("Program name and code are required.");
  const levelType = ["nursery", "primary", "secondary", "mixed", "other"].includes(String(input.levelType || "").toLowerCase())
    ? String(input.levelType).toLowerCase() : "mixed";
  const status = ["active", "inactive", "archived"].includes(String(input.status || "").toLowerCase())
    ? String(input.status).toLowerCase() : "active";
  const rawLevels = Array.isArray(input.classLevels) ? input.classLevels : String(input.classLevels || "").split(/[\n,|]+/);
  const classLevels = [...new Set(rawLevels.map((v) => text(v, 20).toUpperCase()).filter(Boolean))].slice(0, 30);
  return {
    name, title: name, shortTitle: text(input.shortTitle, 80), code,
    schoolUnitId: text(input.schoolUnitId, 80), schoolUnitName: text(input.schoolUnitName, 180),
    schoolUnitCode: normalizeCode(input.schoolUnitCode), levelType, classLevels,
    description: text(input.description, 2000), status,
  };
}

function normalizeDepartmentInput(input = {}) {
  const name = text(input.name, 180);
  const code = normalizeCode(input.code, name);
  if (!name || !code) throw new Error("Department name and code are required.");
  const status = ["active", "inactive", "archived"].includes(String(input.status || "").toLowerCase())
    ? String(input.status).toLowerCase() : "active";
  return {
    name, code, description: text(input.description, 2000), costCenter: text(input.costCenter, 80),
    schoolUnitId: text(input.schoolUnitId, 80), schoolUnitName: text(input.schoolUnitName, 180), status,
  };
}

async function assertActiveProgram(Program, value) {
  if (!value) return null;
  if (!Program || !validId(value)) throw new Error("Invalid academic program.");
  const row = await Program.findOne({ _id: value, isDeleted: { $ne: true }, status: "active" }).select("_id").lean();
  if (!row) throw new Error("Selected academic program is inactive or unavailable.");
  return row._id;
}

async function assertActiveDepartment(Department, value) {
  if (!value) return null;
  if (!Department || !validId(value)) throw new Error("Invalid department.");
  const row = await Department.findOne({ _id: value, isDeleted: { $ne: true }, status: "active" }).select("_id").lean();
  if (!row) throw new Error("Selected department is inactive or unavailable.");
  return row._id;
}


async function assertProgramAssignment(Program, value, currentValue = null) {
  if (!value) return null;
  if (!Program || !validId(value)) throw new Error("Invalid academic program.");
  if (currentValue && id(value) === id(currentValue)) {
    const row = await Program.findOne({ _id: value, isDeleted: { $ne: true } }).select("_id").lean();
    if (row) return row._id;
  }
  return assertActiveProgram(Program, value);
}

async function assertDepartmentAssignment(Department, value, currentValue = null) {
  if (!value) return null;
  if (!Department || !validId(value)) throw new Error("Invalid department.");
  if (currentValue && id(value) === id(currentValue)) {
    const row = await Department.findOne({ _id: value, isDeleted: { $ne: true } }).select("_id").lean();
    if (row) return row._id;
  }
  return assertActiveDepartment(Department, value);
}

async function count(Model, filter) {
  if (!Model) return 0;
  return Number(await Model.countDocuments(filter));
}

async function groupedReferenceCounts(Model, field, ids) {
  if (!Model || !ids.length) return new Map();
  const objectIds = ids.filter(validId).map((value) => new mongoose.Types.ObjectId(id(value)));
  if (!objectIds.length) return new Map();
  const rows = await Model.aggregate([
    { $match: { [field]: { $in: objectIds }, isDeleted: { $ne: true } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [id(row._id), Number(row.count || 0)]));
}

async function programReferenceCountsMany(models, programIds = []) {
  const ids = [...new Set(programIds.map(id).filter(validId))];
  const [students, invoices, payments, feeStructures, scholarships, scholarshipApplications] = await Promise.all([
    groupedReferenceCounts(models.Student, "programId", ids),
    groupedReferenceCounts(models.Invoice, "programId", ids),
    groupedReferenceCounts(models.Payment, "programId", ids),
    groupedReferenceCounts(models.FeeStructure, "programId", ids),
    groupedReferenceCounts(models.Scholarship, "programId", ids),
    groupedReferenceCounts(models.ScholarshipApplication, "program", ids),
  ]);
  const result = new Map();
  for (const programId of ids) {
    const row = {
      students: students.get(programId) || 0,
      invoices: invoices.get(programId) || 0,
      payments: payments.get(programId) || 0,
      feeStructures: feeStructures.get(programId) || 0,
      scholarships: scholarships.get(programId) || 0,
      scholarshipApplications: scholarshipApplications.get(programId) || 0,
    };
    row.total = Object.values(row).reduce((sum, value) => sum + Number(value || 0), 0);
    result.set(programId, row);
  }
  return result;
}

async function departmentReferenceCountsMany(models, departmentIds = []) {
  const ids = [...new Set(departmentIds.map(id).filter(validId))];
  const [staff, payrollRuns, payrollItems] = await Promise.all([
    groupedReferenceCounts(models.Staff, "departmentId", ids),
    groupedReferenceCounts(models.PayrollRun, "departmentId", ids),
    groupedReferenceCounts(models.PayrollItem, "departmentId", ids),
  ]);
  const result = new Map();
  for (const departmentId of ids) {
    const row = {
      staff: staff.get(departmentId) || 0,
      payrollRuns: payrollRuns.get(departmentId) || 0,
      payrollItems: payrollItems.get(departmentId) || 0,
    };
    row.total = Object.values(row).reduce((sum, value) => sum + Number(value || 0), 0);
    result.set(departmentId, row);
  }
  return result;
}

async function programReferenceCounts(models, programId) {
  const filter = (field) => ({ [field]: programId, isDeleted: { $ne: true } });
  const [students, invoices, payments, feeStructures, scholarships, scholarshipApplications] = await Promise.all([
    count(models.Student, filter("programId")), count(models.Invoice, filter("programId")),
    count(models.Payment, filter("programId")), count(models.FeeStructure, filter("programId")),
    count(models.Scholarship, filter("programId")), count(models.ScholarshipApplication, filter("program")),
  ]);
  return { students, invoices, payments, feeStructures, scholarships, scholarshipApplications,
    total: students + invoices + payments + feeStructures + scholarships + scholarshipApplications };
}

async function departmentReferenceCounts(models, departmentId) {
  const filter = (field) => ({ [field]: departmentId, isDeleted: { $ne: true } });
  const [staff, payrollRuns, payrollItems] = await Promise.all([
    count(models.Staff, filter("departmentId")), count(models.PayrollRun, filter("departmentId")), count(models.PayrollItem, filter("departmentId")),
  ]);
  return { staff, payrollRuns, payrollItems, total: staff + payrollRuns + payrollItems };
}

async function updateProgram(models, programId, revision, input, actorUserId = null) {
  if (!validId(programId)) throw new Error("Invalid program ID.");
  const expected = parseRevision(revision);
  const patch = normalizeProgramInput(input);
  if (patch.status === "archived") {
    const refs = await programReferenceCounts(models, programId);
    if (refs.total) throw new Error("Program cannot be archived while students or financial records still reference it.");
  }
  const row = await models.Program.findOneAndUpdate(
    { _id: programId, isDeleted: { $ne: true }, revision: expected },
    { $set: { ...patch, updatedBy: actorUserId || null }, $inc: { revision: 1 } },
    { new: true, runValidators: true }
  );
  if (!row) throw new Error("Program changed in another session. Reload and try again.");
  return row;
}

async function updateDepartment(models, departmentId, revision, input, actorUserId = null) {
  if (!validId(departmentId)) throw new Error("Invalid department ID.");
  const expected = parseRevision(revision);
  const patch = normalizeDepartmentInput(input);
  if (patch.status === "archived") {
    const refs = await departmentReferenceCounts(models, departmentId);
    if (refs.total) throw new Error("Department cannot be archived while staff or payroll records still reference it.");
  }
  const row = await models.Department.findOneAndUpdate(
    { _id: departmentId, isDeleted: { $ne: true }, revision: expected },
    { $set: { ...patch, updatedBy: actorUserId || null }, $inc: { revision: 1 } },
    { new: true, runValidators: true }
  );
  if (!row) throw new Error("Department changed in another session. Reload and try again.");
  return row;
}

async function setProgramStatus(models, programId, revision, status, actorUserId = null) {
  if (!validId(programId)) throw new Error("Invalid program ID.");
  const expected = parseRevision(revision);
  const next = String(status || "").toLowerCase();
  if (!["active", "inactive", "archived"].includes(next)) throw new Error("Invalid program status.");
  if (next === "archived") {
    const refs = await programReferenceCounts(models, programId);
    if (refs.total) throw new Error("Program cannot be archived while students or financial records still reference it.");
  }
  const row = await models.Program.findOneAndUpdate(
    { _id: programId, isDeleted: { $ne: true }, revision: expected },
    { $set: { status: next, updatedBy: actorUserId || null }, $inc: { revision: 1 } },
    { new: true, runValidators: true }
  );
  if (!row) throw new Error("Program changed in another session. Reload and try again.");
  return row;
}

async function setDepartmentStatus(models, departmentId, revision, status, actorUserId = null) {
  if (!validId(departmentId)) throw new Error("Invalid department ID.");
  const expected = parseRevision(revision);
  const next = String(status || "").toLowerCase();
  if (!["active", "inactive", "archived"].includes(next)) throw new Error("Invalid department status.");
  if (next === "archived") {
    const refs = await departmentReferenceCounts(models, departmentId);
    if (refs.total) throw new Error("Department cannot be archived while staff or payroll records still reference it.");
  }
  const row = await models.Department.findOneAndUpdate(
    { _id: departmentId, isDeleted: { $ne: true }, revision: expected },
    { $set: { status: next, updatedBy: actorUserId || null }, $inc: { revision: 1 } },
    { new: true, runValidators: true }
  );
  if (!row) throw new Error("Department changed in another session. Reload and try again.");
  return row;
}

async function deleteProgram(models, programId, revision, actorUserId = null) {
  const refs = await programReferenceCounts(models, programId);
  if (refs.total) throw new Error("Program cannot be deleted while students or financial records still reference it.");
  const expected = parseRevision(revision);
  const row = await models.Program.findOneAndUpdate(
    { _id: programId, isDeleted: { $ne: true }, revision: expected },
    { $set: { isDeleted: true, deletedAt: new Date(), status: "archived", updatedBy: actorUserId || null }, $inc: { revision: 1 } },
    { new: true }
  );
  if (!row) throw new Error("Program changed in another session. Reload and try again.");
  return row;
}

async function deleteDepartment(models, departmentId, revision, actorUserId = null) {
  const refs = await departmentReferenceCounts(models, departmentId);
  if (refs.total) throw new Error("Department cannot be deleted while staff or payroll records still reference it.");
  const expected = parseRevision(revision);
  const row = await models.Department.findOneAndUpdate(
    { _id: departmentId, isDeleted: { $ne: true }, revision: expected },
    { $set: { isDeleted: true, deletedAt: new Date(), status: "archived", updatedBy: actorUserId || null }, $inc: { revision: 1 } },
    { new: true }
  );
  if (!row) throw new Error("Department changed in another session. Reload and try again.");
  return row;
}

module.exports = {
  validId, normalizeCode, normalizeProgramInput, normalizeDepartmentInput, parseRevision,
  assertActiveProgram, assertActiveDepartment, assertProgramAssignment, assertDepartmentAssignment, programReferenceCounts, departmentReferenceCounts, programReferenceCountsMany, departmentReferenceCountsMany,
  updateProgram, updateDepartment, setProgramStatus, setDepartmentStatus, deleteProgram, deleteDepartment,
};

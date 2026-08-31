const mongoose = require("mongoose");
const { normalizeCode } = require("../../src/services/tenant/organizationCatalogService");

const oid = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const id = (v) => String(v?._id || v || "");
const text = (v, max = 180) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

async function referencedIds(models, pairs) {
  const out = new Set();
  for (const [name, field] of pairs) {
    const Model = models?.[name];
    if (!Model) continue;
    // distinct reads the persisted values regardless of the current ref target.
    const values = await Model.distinct(field, { [field]: { $ne: null }, isDeleted: { $ne: true } }).catch(() => []);
    values.filter(oid).forEach((v) => out.add(id(v)));
  }
  return [...out];
}

async function uniqueCode(Model, preferred, suffix) {
  const base = normalizeCode(preferred) || `LEGACY-${suffix}`;
  const existing = await Model.findOne({ code: base, isDeleted: { $ne: true } }).select("_id").lean().catch(() => null);
  if (!existing) return base;
  return normalizeCode(`${base}-${suffix}`) || `LEGACY-${suffix}`;
}

async function migratePrograms(models, stats) {
  const { Program, Subject } = models || {};
  if (!Program) throw new Error("Organization catalog migration requires Program.");
  const ids = await referencedIds(models, [
    ["Student", "programId"], ["Invoice", "programId"], ["Payment", "programId"],
    ["FeeStructure", "programId"], ["Scholarship", "programId"], ["ScholarshipApplication", "program"],
  ]);
  stats.programReferences = ids.length;
  for (const programId of ids) {
    if (await Program.exists({ _id: programId })) continue;
    const subject = Subject ? await Subject.findById(programId).lean().catch(() => null) : null;
    const suffix = programId.slice(-8).toUpperCase();
    if (subject) {
      const programCode = await uniqueCode(Program, subject.code || subject.shortTitle || subject.title, suffix);
      await Program.create({
        _id: subject._id,
        name: text(subject.title || subject.shortTitle || subject.code || `Legacy Program ${suffix}`),
        title: text(subject.title || subject.shortTitle || subject.code || `Legacy Program ${suffix}`),
        shortTitle: text(subject.shortTitle, 80), code: programCode,
        schoolUnitId: text(subject.schoolUnitId, 80), schoolUnitName: text(subject.schoolUnitName), schoolUnitCode: text(subject.schoolUnitCode, 48),
        levelType: ["nursery", "primary", "secondary"].includes(subject.levelType) ? subject.levelType : "mixed",
        classLevels: [text(subject.classLevel, 20).toUpperCase()].filter(Boolean),
        status: subject.status === "active" ? "active" : "inactive", description: text(subject.description, 2000),
        legacySubjectId: subject._id, revision: 1,
      });
      stats.programsProjectedFromSubjects += 1;
    } else {
      const programCode = await uniqueCode(Program, `LEGACY-PROG-${suffix}`, suffix);
      await Program.create({
        _id: new mongoose.Types.ObjectId(programId), name: `Recovered Program ${suffix}`, title: `Recovered Program ${suffix}`,
        code: programCode, status: "inactive", levelType: "other", revision: 1,
        migrationQuarantinedAt: new Date(), migrationReason: "Referenced historical program ID had no matching Program or Subject record.",
      });
      stats.programsQuarantined += 1;
    }
  }
}

async function departmentNameForId(models, departmentId) {
  if (models.PayrollItem) {
    const item = await models.PayrollItem.findOne({ departmentId, departmentName: { $nin: [null, ""] } }).select("departmentName").lean().catch(() => null);
    if (item?.departmentName) return text(item.departmentName);
  }
  const raw = models.Staff?.collection ? await models.Staff.collection.findOne({ departmentId: new mongoose.Types.ObjectId(departmentId) }, { projection: { departmentName: 1, department: 1 } }).catch(() => null) : null;
  return text(raw?.departmentName || raw?.department);
}

async function migrateReferencedDepartments(models, stats) {
  const { Department } = models || {};
  if (!Department) throw new Error("Organization catalog migration requires Department.");
  const ids = await referencedIds(models, [["Staff","departmentId"],["PayrollRun","departmentId"],["PayrollItem","departmentId"]]);
  stats.departmentReferences = ids.length;
  for (const departmentId of ids) {
    if (await Department.exists({ _id: departmentId })) continue;
    const suffix = departmentId.slice(-8).toUpperCase();
    const recoveredName = await departmentNameForId(models, departmentId) || `Recovered Department ${suffix}`;
    const departmentCode = await uniqueCode(Department, recoveredName, suffix);
    await Department.create({
      _id: new mongoose.Types.ObjectId(departmentId), name: recoveredName, code: departmentCode, status: "inactive", revision: 1,
      migrationQuarantinedAt: new Date(), migrationReason: "Historical staff/payroll department reference had no canonical Department record.",
    });
    stats.departmentsQuarantined += 1;
  }
}

async function migrateLegacyStaffStrings(models, stats) {
  const { Staff, Department } = models || {};
  if (!Staff?.collection || !Department) return;
  const cursor = Staff.collection.find({
    $and: [
      { $or: [{ departmentId: null }, { departmentId: { $exists: false } }] },
      { $or: [{ departmentName: { $type: "string", $ne: "" } }, { department: { $type: "string", $ne: "" } }] },
      { isDeleted: { $ne: true } },
    ],
  }, { projection: { departmentName: 1, department: 1 } }).limit(10000);
  for await (const row of cursor) {
    const name = text(row.departmentName || row.department);
    if (!name) continue;
    let dep = await Department.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), isDeleted: { $ne: true } }).select("_id").lean();
    if (!dep) {
      const suffix = String(row._id).slice(-8).toUpperCase();
      dep = await Department.create({ name, code: await uniqueCode(Department, name, suffix), status: "inactive", revision: 1,
        migrationQuarantinedAt: new Date(), migrationReason: "Recovered from legacy free-text Staff department field; Admin review required before new assignment." });
      stats.departmentsFromStaffText += 1;
    }
    await Staff.collection.updateOne({ _id: row._id, $or: [{ departmentId: null }, { departmentId: { $exists: false } }] }, { $set: { departmentId: dep._id } });
    stats.staffDepartmentLinksBackfilled += 1;
  }
}

async function migrateOrganizationCatalog(models) {
  const stats = { programReferences:0, programsProjectedFromSubjects:0, programsQuarantined:0, departmentReferences:0, departmentsQuarantined:0, departmentsFromStaffText:0, staffDepartmentLinksBackfilled:0 };
  await migratePrograms(models, stats);
  await migrateReferencedDepartments(models, stats);
  await migrateLegacyStaffStrings(models, stats);
  return stats;
}

module.exports = { migrateOrganizationCatalog, referencedIds, migratePrograms, migrateReferencedDepartments, migrateLegacyStaffStrings };

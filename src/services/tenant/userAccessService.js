const mongoose = require("mongoose");
const { normalizeTenantRoles, getPrimaryTenantRole } = require("../../utils/tenantRoles");
const PROFILE_ROLES = new Set(["student", "parent", "staff", "lecturer"]);
const ALLOWED_ROLES = new Set(["admin", "staff", "lecturer", "finance", "librarian", "hostel", "student", "parent", "registrar"]);
function str(v) { return String(v ?? "").trim(); }
function email(v) { return str(v).toLowerCase(); }
function role(v) { return getPrimaryTenantRole(normalizeTenantRoles(v)); }
function objectId(v) { return mongoose.Types.ObjectId.isValid(String(v || "")) ? String(v) : null; }
function requireRole(raw) { const r = str(raw).toLowerCase(); if (!ALLOWED_ROLES.has(r)) throw new Error("Invalid role selected."); return r; }
function profileKindForRole(r) { if (r === "student") return "Student"; if (r === "parent") return "Parent"; if (r === "staff" || r === "lecturer") return "Staff"; return null; }
async function queryOne(Model, filter, session) {
  let q = Model.findOne(filter);
  if (session && q.session) q = q.session(session);
  return q;
}
async function loadProfileForLink(models, r, profileId, accountEmail, session = null) {
  const kind = profileKindForRole(r);
  if (!kind) return null;
  const id = objectId(profileId);
  if (!id) throw new Error(`${kind} profile is required for the ${r} role.`);
  const Model = models?.[kind];
  if (!Model) throw new Error(`${kind} model is required.`);
  const filter = { _id: id, isDeleted: { $ne: true }, $or: [{ userId: null }, { userId: { $exists: false } }] };
  if (kind === "Student") filter.status = { $nin: ["suspended", "archived"] };
  if (kind === "Parent") filter.status = { $in: ["active", "on_hold"] };
  if (kind === "Staff") filter.status = { $nin: ["Suspended", "Exited"] };
  const doc = await queryOne(Model, filter, session);
  if (!doc) throw new Error(`${kind} profile is unavailable or already linked.`);
  const profileEmail = email(doc.email);
  if (profileEmail && profileEmail !== email(accountEmail)) throw new Error(`${kind} profile email must match the User account email.`);
  return { kind, doc };
}
async function linkProfile(models, user, linked, session = null, actorId = null) {
  if (!linked) return user;
  const opts = session ? { session } : undefined;
  const { kind, doc } = linked;
  const set = { userId: user._id, updatedBy: actorId || user.createdBy || null };
  if (!doc.email && user.email) set.email = user.email;
  const result = await models[kind].updateOne({ _id: doc._id, $or: [{ userId: null }, { userId: { $exists: false } }] }, { $set: set }, opts);
  if (Number(result.modifiedCount || 0) !== 1) throw new Error(`${kind} profile was linked by another request. Reload and try again.`);
  const userSet = {};
  if (kind === "Student") userSet.studentId = doc._id;
  if (kind === "Staff") userSet.staffId = doc._id;
  if (kind === "Parent") userSet.childrenStudentIds = Array.isArray(doc.childrenStudentIds) ? doc.childrenStudentIds : [];
  if (Object.keys(userSet).length) await models.User.updateOne({ _id: user._id }, { $set: userSet }, opts);
  Object.assign(user, userSet);
  return user;
}
async function assertRoleProfileCompatibility(models, user, nextRoles) {
  const r = role(nextRoles);
  if (!PROFILE_ROLES.has(r)) return true;
  if (r === "student") {
    if (!user.studentId || !models.Student) throw new Error("Student role requires a linked Student profile.");
    const row = await models.Student.findOne({ _id: user.studentId, userId: user._id, isDeleted: { $ne: true }, status: { $nin: ["suspended", "archived"] } }).select("_id").lean();
    if (!row) throw new Error("Linked Student profile is unavailable.");
  } else if (r === "parent") {
    if (!models.Parent) throw new Error("Parent model is required.");
    const row = await models.Parent.findOne({ userId: user._id, isDeleted: { $ne: true }, status: { $in: ["active", "on_hold"] } }).select("_id").lean();
    if (!row) throw new Error("Parent role requires a linked active Parent profile.");
  } else {
    if (!user.staffId || !models.Staff) throw new Error(`${r} role requires a linked Staff profile.`);
    const row = await models.Staff.findOne({ _id: user.staffId, userId: user._id, isDeleted: { $ne: true }, status: { $nin: ["Suspended", "Exited"] } }).select("_id").lean();
    if (!row) throw new Error("Linked Staff profile is unavailable.");
  }
  return true;
}
async function detachProfiles(models, user, session = null, actorId = null) {
  const opts = session ? { session } : undefined;
  if (models.Student && user.studentId) await models.Student.updateOne({ _id: user.studentId, userId: user._id }, { $set: { userId: null, updatedBy: actorId || null } }, opts);
  if (models.Staff && user.staffId) await models.Staff.updateOne({ _id: user.staffId, userId: user._id }, { $set: { userId: null, updatedBy: actorId || null } }, opts);
  if (models.Parent) await models.Parent.updateMany({ userId: user._id, isDeleted: { $ne: true } }, { $set: { userId: null, updatedBy: actorId || null } }, opts);
}
module.exports = { ALLOWED_ROLES, PROFILE_ROLES, email, requireRole, profileKindForRole, loadProfileForLink, linkProfile, assertRoleProfileCompatibility, detachProfiles };

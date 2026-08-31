const mongoose = require("mongoose");
const { normalizeTenantRoles, getPrimaryTenantRole } = require("../../../utils/tenantRoles");
const { invalidateTenantUserCache } = require("../../../middleware/tenant/requireTenantAuth");
const { createSetPasswordInvite } = require("../../../utils/inviteService");
const {
  email,
  requireRole,
  loadProfileForLink,
  linkProfile,
  assertRoleProfileCompatibility,
  detachProfiles,
} = require("../../../services/tenant/userAccessService");

const USER_STATUS = { INVITED: "invited", ACTIVE: "active", SUSPENDED: "suspended" };
const PROFILE_REQUIRED_ROLES = new Set(["student", "parent", "staff", "lecturer"]);
const ACTIVE_OWNERSHIP_RESET = { staffAccessSuspended: false, studentAccessSuspended: false, studentAccessPreviousStatus: null, parentAccessSuspended: false, parentAccessPreviousStatus: null };
const SUSPENDED_OWNERSHIP_RESET = { staffAccessSuspended: false, studentAccessSuspended: false, studentAccessPreviousStatus: null, parentAccessSuspended: false, parentAccessPreviousStatus: null };
const ROLE_OWNERSHIP_RESET = { staffAccessSuspended: false, studentAccessSuspended: false, studentAccessPreviousStatus: null, parentAccessSuspended: false, parentAccessPreviousStatus: null };
function actorUserId(req) { return req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null; }
function escapeRegex(v) { return String(v ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function txUnsupported(err) { return /Transaction|replica set|not supported|Transaction numbers/i.test(String(err?.message || "")); }
function mutableSnapshot(user) {
  const src = typeof user?.toObject === "function" ? user.toObject() : (user || {});
  return {
    status: src.status,
    roles: Array.isArray(src.roles) ? [...src.roles] : [],
    deletedAt: src.deletedAt || null,
    staffId: src.staffId || null,
    studentId: src.studentId || null,
    childrenStudentIds: Array.isArray(src.childrenStudentIds) ? [...src.childrenStudentIds] : [],
    staffAccessSuspended: !!src.staffAccessSuspended,
    studentAccessSuspended: !!src.studentAccessSuspended,
    studentAccessPreviousStatus: src.studentAccessPreviousStatus || null,
    parentAccessSuspended: !!src.parentAccessSuspended,
    parentAccessPreviousStatus: src.parentAccessPreviousStatus || null,
    tokenVersion: Number(src.tokenVersion || 0),
  };
}

async function isLastActiveAdmin(User, userId) {
  const target = await User.findOne({ _id: userId, deletedAt: null, status: USER_STATUS.ACTIVE, roles: "admin" }).select("_id").lean();
  if (!target) return false;
  return (await User.countDocuments({ _id: { $ne: userId }, deletedAt: null, status: USER_STATUS.ACTIVE, roles: "admin" })) === 0;
}

async function loadProfiles(req) {
  const { Student, Staff, Parent } = req.models || {};
  const [students, staffProfiles, parentProfiles] = await Promise.all([
    Student ? Student.find({ isDeleted: { $ne: true }, status: { $nin: ["suspended", "archived"] }, $or: [{ userId: null }, { userId: { $exists: false } }] }).select("_id regNo fullName firstName lastName email classLevel").sort({ fullName: 1 }).limit(500).lean() : [],
    Staff ? Staff.find({ isDeleted: { $ne: true }, status: { $nin: ["Suspended", "Exited"] }, $or: [{ userId: null }, { userId: { $exists: false } }] }).select("_id employeeId firstName lastName email jobTitle").sort({ firstName: 1, lastName: 1 }).limit(500).lean() : [],
    Parent ? Parent.find({ isDeleted: { $ne: true }, status: { $in: ["active", "on_hold"] }, $or: [{ userId: null }, { userId: { $exists: false } }] }).select("_id firstName lastName email phone relationship").sort({ firstName: 1, lastName: 1 }).limit(500).lean() : [],
  ]);
  return { students, staffProfiles, parentProfiles };
}
function buildUserFilter(req) {
  const filter = { deletedAt: null };
  const q = String(req.query?.q || "").trim();
  const status = String(req.query?.status || "all").trim().toLowerCase();
  const role = String(req.query?.role || "all").trim().toLowerCase();
  if (q) { const rx = new RegExp(escapeRegex(q), "i"); filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }]; }
  if (["invited", "active", "suspended"].includes(status)) filter.status = status;
  if (["admin", "staff", "lecturer", "finance", "librarian", "hostel", "student", "parent", "registrar"].includes(role)) filter.roles = role;
  return filter;
}
async function loadUsersPageData(req) {
  const { User, Parent } = req.models;
  const filter = buildUserFilter(req);
  const [usersRaw, profiles, total, invited, active, suspended] = await Promise.all([
    User.find(filter).select("+passwordHash").sort({ createdAt: -1 }).limit(500).lean(),
    loadProfiles(req),
    User.countDocuments({ deletedAt: null }),
    User.countDocuments({ deletedAt: null, status: USER_STATUS.INVITED }),
    User.countDocuments({ deletedAt: null, status: USER_STATUS.ACTIVE }),
    User.countDocuments({ deletedAt: null, status: USER_STATUS.SUSPENDED }),
  ]);
  const ids = usersRaw.map((u) => u._id);
  const linkedParents = Parent && ids.length ? await Parent.find({ userId: { $in: ids }, isDeleted: { $ne: true } }).select("userId").lean() : [];
  const parentUsers = new Set(linkedParents.map((p) => String(p.userId)));
  const users = usersRaw.map((u) => {
    const primary = getPrimaryTenantRole(u.roles) || "—";
    const profileKind = u.studentId ? "Student" : u.staffId ? "Staff" : parentUsers.has(String(u._id)) ? "Parent" : PROFILE_REQUIRED_ROLES.has(primary) ? "Missing" : "None";
    return {
      id: String(u._id), _id: String(u._id), firstName: u.firstName || "", lastName: u.lastName || "",
      fullName: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || "—", email: u.email || "", phone: u.phone || "",
      roles: Array.isArray(u.roles) ? u.roles : [], rolesText: primary, status: u.status || USER_STATUS.INVITED,
      hasPassword: !!u.passwordHash, staffId: u.staffId ? String(u.staffId) : null, studentId: u.studentId ? String(u.studentId) : null,
      profileKind, createdAtRaw: u.createdAt || null, createdAt: u.createdAt ? new Date(u.createdAt).toLocaleString() : "—",
    };
  });
  return { users, ...profiles, kpis: { total, invited, active, suspended } };
}
async function renderIndex(req, res, extra = {}) {
  const base = await loadUsersPageData(req);
  return res.render("tenant/users/index", { ...base, csrfToken: res.locals.csrfToken || req.csrfToken?.() || "", error: null, values: {}, inviteResult: null, openModal: null, query: { q: req.query?.q || "", status: req.query?.status || "all", role: req.query?.role || "all" }, ...extra });
}

async function tryTransaction(req, fn) {
  if (!req.tenantConnection?.startSession) return { used: false, value: null };
  const session = await req.tenantConnection.startSession();
  try {
    let value;
    await session.withTransaction(async () => { value = await fn(session); });
    return { used: true, value };
  } catch (err) {
    if (!txUnsupported(err)) throw err;
    return { used: false, value: null };
  } finally { await session.endSession().catch(() => {}); }
}

async function createAccount(req, session = null, tracker = null) {
  const { User, InviteToken } = req.models;
  const role = requireRole(req.body.role);
  const cleanEmail = email(req.body.email);
  const firstName = String(req.body.firstName || "").trim();
  const lastName = String(req.body.lastName || "").trim();
  if (!firstName || !lastName || !cleanEmail) throw new Error("First name, last name, email and role are required.");
  const profileId = role === "student" ? req.body.studentProfileId : role === "parent" ? req.body.parentProfileId : ["staff", "lecturer"].includes(role) ? req.body.staffProfileId : null;
  const linked = await loadProfileForLink(req.models, role, profileId, cleanEmail, session);
  const actor = actorUserId(req);
  const opts = session ? { session } : undefined;
  const docs = await User.create([{ firstName, lastName, email: cleanEmail, phone: String(req.body.phone || "").trim() || null, roles: normalizeTenantRoles(role), status: USER_STATUS.INVITED, deletedAt: null, passwordHash: null, tokenVersion: 0, staffAccessSuspended: false, studentAccessSuspended: false, studentAccessPreviousStatus: null, parentAccessSuspended: false, parentAccessPreviousStatus: null, createdBy: actor, updatedBy: actor }], opts);
  const user = docs[0];
  if (tracker) tracker.user = user;
  await linkProfile(req.models, user, linked, session, actor);
  const invite = await createSetPasswordInvite({ req, InviteToken, userId: user._id, createdBy: actor, session });
  return { user, invite };
}
async function createAccountWithCompensation(req) {
  const { User, Student, Staff, Parent, InviteToken } = req.models;
  const tracker = { user: null };
  try { return await createAccount(req, null, tracker); }
  catch (err) {
    const uid = tracker.user?._id;
    if (uid) {
      await InviteToken?.deleteMany({ userId: uid }).catch(() => {});
      await Student?.updateMany({ userId: uid }, { $set: { userId: null } }).catch(() => {});
      await Staff?.updateMany({ userId: uid }, { $set: { userId: null } }).catch(() => {});
      await Parent?.updateMany({ userId: uid }, { $set: { userId: null } }).catch(() => {});
      await User.deleteOne({ _id: uid }).catch(() => {});
    }
    throw err;
  }
}
async function requireUserForMutation(req, selectPassword = false) {
  const { User } = req.models;
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw Object.assign(new Error("Invalid user ID"), { statusCode: 404 });
  let q = User.findOne({ _id: req.params.id, deletedAt: null });
  if (selectPassword) q = q.select("+passwordHash");
  const user = await q;
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });
  return user;
}
async function restoreUserState(User, userId, snapshot, match = {}) {
  await User.updateOne({ _id: userId, ...match }, { $set: snapshot }).catch(() => {});
}
async function captureProfileLinks(models, user) {
  const [student, staff, parents] = await Promise.all([
    models.Student && user.studentId ? models.Student.findOne({ _id: user.studentId, userId: user._id }).select("_id userId updatedBy").lean() : null,
    models.Staff && user.staffId ? models.Staff.findOne({ _id: user.staffId, userId: user._id }).select("_id userId updatedBy").lean() : null,
    models.Parent ? models.Parent.find({ userId: user._id, isDeleted: { $ne: true } }).select("_id userId updatedBy").lean() : [],
  ]);
  return { student, staff, parents };
}
async function restoreProfileLinks(models, links) {
  if (links.student && models.Student) await models.Student.updateOne({ _id: links.student._id }, { $set: { userId: links.student.userId, updatedBy: links.student.updatedBy || null } }).catch(() => {});
  if (links.staff && models.Staff) await models.Staff.updateOne({ _id: links.staff._id }, { $set: { userId: links.staff.userId, updatedBy: links.staff.updatedBy || null } }).catch(() => {});
  if (models.Parent) for (const p of links.parents || []) await models.Parent.updateOne({ _id: p._id }, { $set: { userId: p.userId, updatedBy: p.updatedBy || null } }).catch(() => {});
}
async function setStatus(req, user, status, session = null) {
  const { User } = req.models;
  if (![USER_STATUS.INVITED, USER_STATUS.ACTIVE, USER_STATUS.SUSPENDED].includes(status)) throw new Error("Invalid status");
  if (status === USER_STATUS.SUSPENDED && await isLastActiveAdmin(User, user._id)) throw new Error("You cannot suspend the only remaining admin.");
  if (status === USER_STATUS.ACTIVE && !user.passwordHash) throw new Error("Invited users must set a password before activation.");
  const update = { $set: { status, ...(status === USER_STATUS.SUSPENDED ? SUSPENDED_OWNERSHIP_RESET : ACTIVE_OWNERSHIP_RESET), updatedBy: actorUserId(req) } };
  if (status === USER_STATUS.SUSPENDED) update.$inc = { tokenVersion: 1 };
  const result = await User.updateOne({ _id: user._id, deletedAt: null, updatedAt: user.updatedAt }, update, session ? { session } : undefined);
  if (Number(result.modifiedCount || 0) !== 1) throw new Error("User changed in another session. Reload and try again.");
}
async function fallbackStatus(req, user, status) {
  const snap = mutableSnapshot(user);
  try { await setStatus(req, user, status, null); }
  catch (err) { await restoreUserState(req.models.User, user._id, snap); throw err; }
}
async function deleteUserCore(req, user, session = null, deletionTime = null) {
  const { User, InviteToken } = req.models;
  const deletedAt = deletionTime || new Date();
  const actor = actorUserId(req);
  const result = await User.updateOne(
    { _id: user._id, deletedAt: null, updatedAt: user.updatedAt },
    { $set: { deletedAt, status: USER_STATUS.SUSPENDED, staffId: null, studentId: null, childrenStudentIds: [], staffAccessSuspended: false, studentAccessSuspended: false, studentAccessPreviousStatus: null, parentAccessSuspended: false, parentAccessPreviousStatus: null, updatedBy: actor }, $inc: { tokenVersion: 1 } },
    session ? { session } : undefined,
  );
  if (Number(result.modifiedCount || 0) !== 1) throw new Error("User changed in another session. Reload and try again.");
  await detachProfiles(req.models, user, session, actor);
  await InviteToken?.updateMany({ userId: user._id, usedAt: null, revokedAt: null }, { $set: { revokedAt: deletedAt } }, session ? { session } : undefined);
  return deletedAt;
}
async function deleteUserWithCompensation(req, user) {
  const snap = mutableSnapshot(user);
  const links = await captureProfileLinks(req.models, user);
  const deletedAt = new Date();
  try { await deleteUserCore(req, user, null, deletedAt); }
  catch (err) {
    if (deletedAt) await req.models.InviteToken?.updateMany({ userId: user._id, revokedAt: deletedAt, usedAt: null }, { $set: { revokedAt: null } }).catch(() => {});
    await restoreProfileLinks(req.models, links);
    await restoreUserState(req.models.User, user._id, snap);
    throw err;
  }
  return { snap, links, deletedAt };
}
async function rollbackDeletedUser(req, user, state) {
  if (!state) return;
  await req.models.InviteToken?.updateMany({ userId: user._id, revokedAt: state.deletedAt, usedAt: null }, { $set: { revokedAt: null } }).catch(() => {});
  await restoreProfileLinks(req.models, state.links);
  await restoreUserState(req.models.User, user._id, state.snap, { deletedAt: state.deletedAt });
}

module.exports = {
  list: async (req, res) => renderIndex(req, res),
  newForm: async (req, res) => res.redirect("/admin/users"),
  view: async (req, res) => res.redirect("/admin/users"),
  create: async (req, res) => {
    try {
      const tx = await tryTransaction(req, (session) => createAccount(req, session));
      const result = tx.used ? tx.value : await createAccountWithCompensation(req);
      const { user, invite } = result;
      return renderIndex(req, res, { inviteResult: { userId: String(user._id), fullName: [user.firstName, user.lastName].filter(Boolean).join(" "), email: user.email || "", roles: user.roles || [], inviteLink: invite.inviteLink, mode: "created" }, openModal: "mInvite" });
    } catch (err) {
      return renderIndex(req, res, { error: err?.code === 11000 ? "Email or linked profile already exists." : (err?.message || "Failed to create user."), values: req.body, openModal: "mEdit" });
    }
  },
  resendInvite: async (req, res) => {
    try {
      const user = await requireUserForMutation(req, true);
      if (user.status === USER_STATUS.SUSPENDED) throw new Error("Suspended users cannot receive password invitations.");
      if (user.passwordHash || user.status === USER_STATUS.ACTIVE) throw new Error("Password is already set. Use the password-reset workflow instead of resending an invitation.");
      const invite = await createSetPasswordInvite({ req, InviteToken: req.models.InviteToken, userId: user._id, createdBy: actorUserId(req) });
      return renderIndex(req, res, { inviteResult: { userId: String(user._id), fullName: [user.firstName, user.lastName].filter(Boolean).join(" "), email: user.email || "", roles: user.roles || [], inviteLink: invite.inviteLink, mode: "resent" }, openModal: "mInvite" });
    } catch (err) { req.flash?.("error", err.message); return res.redirect("/admin/users"); }
  },
  updateStatus: async (req, res) => {
    try {
      const user = await requireUserForMutation(req, true);
      const status = String(req.body.status || "");
      const tx = await tryTransaction(req, (session) => setStatus(req, user, status, session));
      if (!tx.used) await fallbackStatus(req, user, status);
      invalidateTenantUserCache(req.tenant?.code, req.params.id);
    } catch (err) { req.flash?.("error", err.message); }
    return res.redirect("/admin/users");
  },
  updateRoles: async (req, res) => {
    try {
      const user = await requireUserForMutation(req, false);
      let roles = req.body.roles; if (typeof roles === "string") roles = roles.split(",").map((x) => x.trim()).filter(Boolean);
      roles = normalizeTenantRoles(roles);
      if (!roles.length) throw new Error("Roles required");
      if (!roles.includes("admin") && await isLastActiveAdmin(req.models.User, user._id)) throw new Error("You cannot remove admin from the only remaining admin.");
      await assertRoleProfileCompatibility(req.models, user, roles);
      const result = await req.models.User.updateOne({ _id: user._id, deletedAt: null, updatedAt: user.updatedAt }, { $set: { roles, ...ROLE_OWNERSHIP_RESET, updatedBy: actorUserId(req) }, $inc: { tokenVersion: 1 } });
      if (Number(result.modifiedCount || 0) !== 1) throw new Error("User changed in another session. Reload and try again.");
      invalidateTenantUserCache(req.tenant?.code, req.params.id);
    } catch (err) { req.flash?.("error", err.message); }
    return res.redirect("/admin/users");
  },
  softDelete: async (req, res) => {
    try {
      const user = await requireUserForMutation(req, false);
      if (await isLastActiveAdmin(req.models.User, user._id)) throw new Error("You cannot delete the only remaining admin.");
      const tx = await tryTransaction(req, (session) => deleteUserCore(req, user, session));
      if (!tx.used) await deleteUserWithCompensation(req, user);
      invalidateTenantUserCache(req.tenant?.code, req.params.id);
    } catch (err) { req.flash?.("error", err.message); }
    return res.redirect("/admin/users");
  },
  bulk: async (req, res) => {
    const ids = String(req.body.ids || "").split(",").map((x) => x.trim()).filter((x) => mongoose.Types.ObjectId.isValid(x));
    const action = String(req.body.action || "");
    if (!ids.length) return res.redirect("/admin/users");
    if (ids.length > 100) return res.status(400).send("Bulk actions are limited to 100 users.");
    if (!["activate", "suspend", "delete"].includes(action)) return res.status(400).send("Invalid bulk action");
    try {
      const users = await req.models.User.find({ _id: { $in: ids }, deletedAt: null }).select(action === "activate" ? "+passwordHash" : "");
      if (users.length !== ids.length) throw new Error("One or more selected users no longer exist. Reload and try again.");
      if (["suspend", "delete"].includes(action)) {
        const selectedActiveAdmins = users.filter((u) => u.status === USER_STATUS.ACTIVE && (u.roles || []).includes("admin")).length;
        if (selectedActiveAdmins > 0) {
          const remainingActiveAdmins = await req.models.User.countDocuments({ _id: { $nin: ids }, deletedAt: null, status: USER_STATUS.ACTIVE, roles: "admin" });
          if (remainingActiveAdmins === 0) throw new Error("Bulk action would remove the only remaining active admin.");
        }
      }
      const tx = await tryTransaction(req, async (session) => {
        for (const user of users) {
          if (action === "activate") await setStatus(req, user, USER_STATUS.ACTIVE, session);
          else if (action === "suspend") await setStatus(req, user, USER_STATUS.SUSPENDED, session);
          else await deleteUserCore(req, user, session);
        }
      });
      if (!tx.used) {
        const applied = [];
        try {
          for (const user of users) {
            if (action === "delete") {
              const state = await deleteUserWithCompensation(req, user);
              applied.push({ user, action, state });
            } else {
              const snap = mutableSnapshot(user);
              await setStatus(req, user, action === "activate" ? USER_STATUS.ACTIVE : USER_STATUS.SUSPENDED, null);
              applied.push({ user, action, snap });
            }
          }
        } catch (err) {
          for (const row of applied.reverse()) {
            if (row.action === "delete") await rollbackDeletedUser(req, row.user, row.state);
            else await restoreUserState(req.models.User, row.user._id, row.snap, { status: row.action === "activate" ? USER_STATUS.ACTIVE : USER_STATUS.SUSPENDED });
          }
          throw err;
        }
      }
      ids.forEach((id) => invalidateTenantUserCache(req.tenant?.code, id));
    } catch (err) { req.flash?.("error", err.message); }
    return res.redirect("/admin/users");
  },
};

const mongoose = require("mongoose");
const { escapeRegex } = require("../../../services/tenant/roleService");
const { invalidateTenantUserCache } = require("../../../middleware/tenant/requireTenantAuth");
const { assertActiveDepartment, assertDepartmentAssignment } = require("../../../services/tenant/organizationCatalogService");
const {
  assertTenantLimitAvailable,
  compensateIfTenantLimitExceeded,
} = require("../../../utils/checkTenantLimit");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

const STAFF_STATUSES = new Set(["Active", "On Leave", "Suspended", "Exited"]);
const EMPLOYMENT_TYPES = new Set(["Full Time", "Part Time", "Contract", "Temporary", "Intern"]);

function normalizeStaffStatus(value, fallback = "Active") {
  const status = str(value || fallback);
  if (!STAFF_STATUSES.has(status)) throw new Error("Invalid staff status.");
  return status;
}

function normalizeEmploymentType(value, fallback = "Full Time") {
  const type = str(value || fallback);
  if (!EMPLOYMENT_TYPES.has(type)) throw new Error("Invalid employment type.");
  return type;
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const departmentId = str(query.departmentId || "all");
  const employmentType = str(query.employmentType || "all");
  const mongo = { isDeleted: { $ne: true } };

  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 160)), "i");
    mongo.$or = [
      { firstName: rx }, { lastName: rx }, { middleName: rx }, { email: rx },
      { phone: rx }, { employeeId: rx }, { jobTitle: rx }, { payrollNumber: rx },
    ];
  }

  if (status !== "all") mongo.status = status;
  if (employmentType !== "all") mongo.employmentType = employmentType;
  if (departmentId !== "all" && isValidId(departmentId)) mongo.departmentId = departmentId;

  return {
    mongo,
    clean: { q, status, departmentId, employmentType },
  };
}

function serializeStaff(doc) {
  return {
    id: String(doc._id),
    userId: doc.userId?._id ? String(doc.userId._id) : (doc.userId ? String(doc.userId) : ""),
    employeeId: doc.employeeId || "—",
    fullName: [doc.firstName, doc.middleName, doc.lastName].filter(Boolean).join(" "),
    firstName: doc.firstName || "",
    lastName: doc.lastName || "",
    middleName: doc.middleName || "",
    email: doc.email || "",
    phone: doc.phone || "",
    gender: doc.gender || "",
    departmentId: doc.departmentId?._id ? String(doc.departmentId._id) : (doc.departmentId ? String(doc.departmentId) : ""),
    departmentName: doc.departmentId?.name || "—",
    roleId: doc.roleId?._id ? String(doc.roleId._id) : (doc.roleId ? String(doc.roleId) : ""),
    roleName: doc.roleId?.name || doc.jobTitle || "—",
    jobTitle: doc.jobTitle || "",
    employmentType: doc.employmentType || "Full Time",
    salary: Number(doc.salary || 0),
    payrollNumber: doc.payrollNumber || "",
    joinDate: doc.joinDate ? new Date(doc.joinDate).toISOString().slice(0, 10) : "",
    status: doc.status || "Active",
    bankName: doc.bankName || "",
    bankAccountName: doc.bankAccountName || "",
    bankAccountNumber: doc.bankAccountNumber || "",
    emergencyContactName: doc.emergencyContactName || "",
    emergencyContactPhone: doc.emergencyContactPhone || "",
    address: doc.address || "",
    notes: doc.notes || "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
  };
}

function computeKpis(list = []) {
  return {
    total: list.length,
    active: list.filter((x) => x.status === "Active").length,
    onLeave: list.filter((x) => x.status === "On Leave").length,
    suspended: list.filter((x) => x.status === "Suspended").length,
    exited: list.filter((x) => x.status === "Exited").length,
  };
}

async function loadLookups(req) {
  const { Department, StaffRole, User } = req.models || {};
  const departments = Department ? await Department.find({ isDeleted: { $ne: true }, status: { $ne: "archived" } }).sort({ name: 1 }).lean() : [];
  const roles = StaffRole ? await StaffRole.find({ isDeleted: { $ne: true }, status: "Active" }).sort({ name: 1 }).lean() : [];
  const users = User ? await User.find({ deletedAt: null }).sort({ firstName: 1, lastName: 1 }).lean() : [];
  return { departments, roles, users };
}

async function validateActiveRole(req, roleId) {
  if (!roleId) return null;
  if (!isValidId(roleId) || !req.models?.StaffRole) throw new Error("Invalid staff role.");
  const role = await req.models.StaffRole.findOne({ _id: roleId, isDeleted: { $ne: true }, status: "Active" }).select("_id").lean();
  if (!role) throw new Error("Selected staff role is inactive or unavailable.");
  return role._id;
}

async function validateLinkedUser(req, userId, excludeStaffId = null) {
  if (!userId) return null;
  if (!isValidId(userId) || !req.models?.User) throw new Error("Invalid linked user.");
  const user = await req.models.User.findOne({ _id: userId, deletedAt: null }).select("_id roles staffId").lean();
  if (!user) throw new Error("Linked user was not found.");
  const primaryRole = Array.isArray(user.roles) ? String(user.roles[0] || "") : "";
  if (["student", "parent"].includes(primaryRole)) throw new Error("Student/parent accounts cannot be linked as staff.");
  const query = { userId: user._id, isDeleted: { $ne: true } };
  if (excludeStaffId && isValidId(excludeStaffId)) query._id = { $ne: excludeStaffId };
  const duplicate = await req.models.Staff.findOne(query).select("_id").lean();
  if (duplicate) throw new Error("That portal user is already linked to another staff record.");
  return user._id;
}

async function syncStaffUserLink(req, staff, previousUserId = null) {
  const User = req.models?.User;
  if (!User || !staff?._id) return;
  const nextUserId = staff.userId?._id || staff.userId || null;
  if (previousUserId && String(previousUserId) !== String(nextUserId || "")) {
    const previous = await User.findOne({ _id: previousUserId, deletedAt: null })
      .select("_id staffId status staffAccessSuspended")
      .lean();
    if (previous && String(previous.staffId || "") === String(staff._id)) {
      const set = { staffId: null };
      if (previous.staffAccessSuspended === true) {
        set.status = "active";
        set.staffAccessSuspended = false;
      }
      await User.updateOne(
        { _id: previousUserId, staffId: staff._id },
        { $set: set, $inc: { tokenVersion: 1 } },
      );
      invalidateTenantUserCache(req.tenant?.code, String(previousUserId));
    }
  }
  if (nextUserId) {
    await User.updateOne({ _id: nextUserId, deletedAt: null }, { $set: { staffId: staff._id } });
    invalidateTenantUserCache(req.tenant?.code, String(nextUserId));
  }
}


async function linkedUserWouldBeLastActiveAdmin(req, userId) {
  const User = req.models?.User;
  if (!User || !userId || !isValidId(userId)) return false;
  const target = await User.findOne({
    _id: userId,
    deletedAt: null,
    status: "active",
    roles: "admin",
  }).select("_id").lean();
  if (!target) return false;
  const others = await User.countDocuments({
    _id: { $ne: userId },
    deletedAt: null,
    status: "active",
    roles: "admin",
  });
  return others === 0;
}

async function assertStaffAccessChangeSafe(req, staffRows, nextStatus, deleting = false) {
  if (!deleting && !["Suspended", "Exited"].includes(nextStatus)) return;
  for (const staff of staffRows || []) {
    const userId = staff?.userId?._id || staff?.userId;
    if (await linkedUserWouldBeLastActiveAdmin(req, userId)) {
      throw new Error("This action would disable the only remaining active tenant admin.");
    }
  }
}

async function syncLinkedUserAccess(req, staff, nextStatus, deleting = false) {
  const User = req.models?.User;
  const userId = staff?.userId?._id || staff?.userId;
  if (!User || !userId || !isValidId(userId)) return;

  const user = await User.findOne({ _id: userId, deletedAt: null })
    .select("_id status staffAccessSuspended")
    .lean();
  if (!user) return;

  if (deleting || ["Suspended", "Exited"].includes(nextStatus)) {
    // Only mark the account as staff-lifecycle suspended when it was not
    // already manually suspended for another reason.
    const patch = { staffAccessSuspended: user.status !== "suspended" || user.staffAccessSuspended === true };
    const update = { $set: patch };
    if (user.status !== "suspended") {
      patch.status = "suspended";
      update.$inc = { tokenVersion: 1 };
    }
    await User.updateOne({ _id: userId, deletedAt: null }, update);
    invalidateTenantUserCache(req.tenant?.code, String(userId));
    return;
  }

  if (["Active", "On Leave"].includes(nextStatus) && user.staffAccessSuspended === true) {
    await User.updateOne(
      { _id: userId, deletedAt: null, staffAccessSuspended: true },
      { $set: { status: "active", staffAccessSuspended: false }, $inc: { tokenVersion: 1 } },
    );
    invalidateTenantUserCache(req.tenant?.code, String(userId));
  }
}

module.exports = {
  index: async (req, res) => {
    const { Staff } = req.models;
    const { mongo, clean } = buildFilters(req.query);

    const [staff, lookups] = await Promise.all([
      Staff.find(mongo)
        .populate("departmentId", "name")
        .populate("roleId", "name code")
        .populate("userId", "firstName lastName email")
        .sort({ createdAt: -1 })
        .lean(),
      loadLookups(req),
    ]);

    const data = staff.map(serializeStaff);
    const kpis = computeKpis(data);

    return res.render("tenant/staff/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      staff: data,
      kpis,
      query: clean,
      departments: lookups.departments,
      roles: lookups.roles,
      users: lookups.users,
      messages: {
        success: req.flash?.("success") || [],
        error: req.flash?.("error") || [],
      },
    });
  },

  create: async (req, res) => {
    const { Staff } = req.models;
    let roleId = null;
    let userId = null;
    let departmentId = null;
    let status = "Active";
    let employmentType = "Full Time";
    try {
      roleId = await validateActiveRole(req, str(req.body.roleId));
      userId = await validateLinkedUser(req, str(req.body.userId));
      departmentId = await assertActiveDepartment(req.models?.Department, str(req.body.departmentId));
      status = normalizeStaffStatus(req.body.status);
      employmentType = normalizeEmploymentType(req.body.employmentType);
    } catch (err) {
      req.flash?.("error", err.message || "Invalid staff access assignment.");
      return res.redirect("/admin/staff");
    }

    const doc = {
      userId,
      employeeId: str(req.body.employeeId),
      firstName: str(req.body.firstName),
      lastName: str(req.body.lastName),
      middleName: str(req.body.middleName),
      email: str(req.body.email).toLowerCase(),
      phone: str(req.body.phone),
      gender: str(req.body.gender),
      departmentId,
      roleId,
      employmentType,
      jobTitle: str(req.body.jobTitle),
      joinDate: asDate(req.body.joinDate),
      salary: num(req.body.salary),
      payrollNumber: str(req.body.payrollNumber),
      bankName: str(req.body.bankName),
      bankAccountName: str(req.body.bankAccountName),
      bankAccountNumber: str(req.body.bankAccountNumber),
      status,
      address: str(req.body.address),
      emergencyContactName: str(req.body.emergencyContactName),
      emergencyContactPhone: str(req.body.emergencyContactPhone),
      notes: str(req.body.notes),
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    };

    if (!doc.firstName || !doc.lastName) {
      req.flash?.("error", "First name and last name are required.");
      return res.redirect("/admin/staff");
    }

    await assertTenantLimitAvailable({
      model: Staff,
      tenantAccess: req.tenantAccess,
      kind: "staff",
      filter: { isDeleted: { $ne: true } },
    });

    const created = await Staff.create(doc);
    await compensateIfTenantLimitExceeded({
      model: Staff,
      tenantAccess: req.tenantAccess,
      kind: "staff",
      filter: { isDeleted: { $ne: true } },
      createdId: created._id,
    });
    await syncStaffUserLink(req, created);
    await syncLinkedUserAccess(req, created, created.status, false);
    req.flash?.("success", "Staff record created successfully.");
    return res.redirect("/admin/staff");
  },

  update: async (req, res) => {
    const { Staff } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid staff ID.");
      return res.redirect("/admin/staff");
    }

    const existing = await Staff.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!existing) {
      req.flash?.("error", "Staff record not found.");
      return res.redirect("/admin/staff");
    }

    const previousUserId = existing.userId?._id || existing.userId || null;
    try {
      existing.userId = await validateLinkedUser(req, str(req.body.userId), existing._id);
      existing.roleId = await validateActiveRole(req, str(req.body.roleId));
      existing.departmentId = await assertDepartmentAssignment(req.models?.Department, str(req.body.departmentId), existing.departmentId);
      existing.status = normalizeStaffStatus(req.body.status);
      existing.employmentType = normalizeEmploymentType(req.body.employmentType);
    } catch (err) {
      req.flash?.("error", err.message || "Invalid staff access assignment.");
      return res.redirect("/admin/staff");
    }
    existing.employeeId = str(req.body.employeeId);
    existing.firstName = str(req.body.firstName);
    existing.lastName = str(req.body.lastName);
    existing.middleName = str(req.body.middleName);
    existing.email = str(req.body.email).toLowerCase();
    existing.phone = str(req.body.phone);
    existing.gender = str(req.body.gender);
    existing.jobTitle = str(req.body.jobTitle);
    existing.joinDate = asDate(req.body.joinDate);
    existing.salary = num(req.body.salary);
    existing.payrollNumber = str(req.body.payrollNumber);
    existing.bankName = str(req.body.bankName);
    existing.bankAccountName = str(req.body.bankAccountName);
    existing.bankAccountNumber = str(req.body.bankAccountNumber);
    existing.address = str(req.body.address);
    existing.emergencyContactName = str(req.body.emergencyContactName);
    existing.emergencyContactPhone = str(req.body.emergencyContactPhone);
    existing.notes = str(req.body.notes);
    if (existing.status === "Exited" && !existing.endDate) existing.endDate = new Date();
    if (existing.status !== "Exited") existing.endDate = null;
    existing.updatedBy = actorUserId(req);

    if (!existing.firstName || !existing.lastName) {
      req.flash?.("error", "First name and last name are required.");
      return res.redirect("/admin/staff");
    }

    await existing.save();
    await syncStaffUserLink(req, existing, previousUserId);
    await syncLinkedUserAccess(req, existing, existing.status, false);
    req.flash?.("success", "Staff record updated successfully.");
    return res.redirect("/admin/staff");
  },

  updateStatus: async (req, res) => {
    const { Staff } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid staff ID.");
      return res.redirect("/admin/staff");
    }

    let status;
    try {
      status = normalizeStaffStatus(req.body.status);
    } catch (err) {
      req.flash?.("error", err.message);
      return res.redirect("/admin/staff");
    }

    const staff = await Staff.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!staff) {
      req.flash?.("error", "Staff record not found.");
      return res.redirect("/admin/staff");
    }
    try {
      await assertStaffAccessChangeSafe(req, [staff], status, false);
    } catch (err) {
      req.flash?.("error", err.message);
      return res.redirect("/admin/staff");
    }
    staff.status = status;
    if (status === "Exited" && !staff.endDate) staff.endDate = new Date();
    if (status !== "Exited") staff.endDate = null;
    staff.updatedBy = actorUserId(req);
    await staff.save();
    await syncLinkedUserAccess(req, staff, status, false);

    req.flash?.("success", "Staff status updated.");
    return res.redirect("/admin/staff");
  },

  delete: async (req, res) => {
    const { Staff } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid staff ID.");
      return res.redirect("/admin/staff");
    }

    const staff = await Staff.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!staff) return res.redirect("/admin/staff");
    try {
      await assertStaffAccessChangeSafe(req, [staff], "Exited", true);
    } catch (err) {
      req.flash?.("error", err.message);
      return res.redirect("/admin/staff");
    }
    staff.isDeleted = true;
    staff.deletedAt = new Date();
    staff.status = "Exited";
    if (!staff.endDate) staff.endDate = new Date();
    staff.updatedBy = actorUserId(req);
    await staff.save();
    await syncLinkedUserAccess(req, staff, "Exited", true);

    req.flash?.("success", "Staff record deleted and linked portal access suspended.");
    return res.redirect("/admin/staff");
  },

  bulkAction: async (req, res) => {
    const { Staff } = req.models;

    const ids = [...new Set(str(req.body.ids)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x)))];

    if (!ids.length) {
      req.flash?.("error", "No staff selected.");
      return res.redirect("/admin/staff");
    }

    const action = str(req.body.action);
    const statusByAction = {
      activate: "Active",
      leave: "On Leave",
      suspend: "Suspended",
      exit: "Exited",
      delete: "Exited",
    };
    const nextStatus = statusByAction[action];
    if (!nextStatus) {
      req.flash?.("error", "Invalid bulk action.");
      return res.redirect("/admin/staff");
    }

    const staffRows = await Staff.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
    try {
      await assertStaffAccessChangeSafe(req, staffRows, nextStatus, action === "delete");
    } catch (err) {
      req.flash?.("error", err.message);
      return res.redirect("/admin/staff");
    }
    let changed = 0;
    for (const staff of staffRows) {
      staff.status = nextStatus;
      if (nextStatus === "Exited") {
        if (!staff.endDate) staff.endDate = new Date();
      } else {
        staff.endDate = null;
      }
      if (action === "delete") {
        staff.isDeleted = true;
        staff.deletedAt = new Date();
      }
      staff.updatedBy = actorUserId(req);
      await staff.save();
      await syncLinkedUserAccess(req, staff, nextStatus, action === "delete");
      changed += 1;
    }

    req.flash?.("success", `${changed} staff record${changed === 1 ? "" : "s"} updated.`);
    return res.redirect("/admin/staff");
  },
};
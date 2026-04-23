const mongoose = require("mongoose");

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

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const departmentId = str(query.departmentId || "all");
  const employmentType = str(query.employmentType || "all");
  const mongo = { isDeleted: { $ne: true } };

  if (q) {
    mongo.$or = [
      { firstName: new RegExp(q, "i") },
      { lastName: new RegExp(q, "i") },
      { middleName: new RegExp(q, "i") },
      { email: new RegExp(q, "i") },
      { phone: new RegExp(q, "i") },
      { employeeId: new RegExp(q, "i") },
      { jobTitle: new RegExp(q, "i") },
      { payrollNumber: new RegExp(q, "i") },
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
  const departments = Department ? await Department.find().sort({ name: 1 }).lean() : [];
  const roles = StaffRole ? await StaffRole.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean() : [];
  const users = User ? await User.find({ deletedAt: null }).sort({ firstName: 1, lastName: 1 }).lean() : [];
  return { departments, roles, users };
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

    const doc = {
      userId: isValidId(req.body.userId) ? req.body.userId : null,
      employeeId: str(req.body.employeeId),
      firstName: str(req.body.firstName),
      lastName: str(req.body.lastName),
      middleName: str(req.body.middleName),
      email: str(req.body.email).toLowerCase(),
      phone: str(req.body.phone),
      gender: str(req.body.gender),
      departmentId: isValidId(req.body.departmentId) ? req.body.departmentId : null,
      roleId: isValidId(req.body.roleId) ? req.body.roleId : null,
      employmentType: str(req.body.employmentType || "Full Time"),
      jobTitle: str(req.body.jobTitle),
      joinDate: asDate(req.body.joinDate),
      salary: num(req.body.salary),
      payrollNumber: str(req.body.payrollNumber),
      bankName: str(req.body.bankName),
      bankAccountName: str(req.body.bankAccountName),
      bankAccountNumber: str(req.body.bankAccountNumber),
      status: str(req.body.status || "Active"),
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

    await Staff.create(doc);
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

    existing.userId = isValidId(req.body.userId) ? req.body.userId : null;
    existing.employeeId = str(req.body.employeeId);
    existing.firstName = str(req.body.firstName);
    existing.lastName = str(req.body.lastName);
    existing.middleName = str(req.body.middleName);
    existing.email = str(req.body.email).toLowerCase();
    existing.phone = str(req.body.phone);
    existing.gender = str(req.body.gender);
    existing.departmentId = isValidId(req.body.departmentId) ? req.body.departmentId : null;
    existing.roleId = isValidId(req.body.roleId) ? req.body.roleId : null;
    existing.employmentType = str(req.body.employmentType || "Full Time");
    existing.jobTitle = str(req.body.jobTitle);
    existing.joinDate = asDate(req.body.joinDate);
    existing.salary = num(req.body.salary);
    existing.payrollNumber = str(req.body.payrollNumber);
    existing.bankName = str(req.body.bankName);
    existing.bankAccountName = str(req.body.bankAccountName);
    existing.bankAccountNumber = str(req.body.bankAccountNumber);
    existing.status = str(req.body.status || "Active");
    existing.address = str(req.body.address);
    existing.emergencyContactName = str(req.body.emergencyContactName);
    existing.emergencyContactPhone = str(req.body.emergencyContactPhone);
    existing.notes = str(req.body.notes);
    existing.updatedBy = actorUserId(req);

    if (!existing.firstName || !existing.lastName) {
      req.flash?.("error", "First name and last name are required.");
      return res.redirect("/admin/staff");
    }

    await existing.save();
    req.flash?.("success", "Staff record updated successfully.");
    return res.redirect("/admin/staff");
  },

  updateStatus: async (req, res) => {
    const { Staff } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid staff ID.");
      return res.redirect("/admin/staff");
    }

    const status = str(req.body.status);
    if (!["Active", "On Leave", "Suspended", "Exited"].includes(status)) {
      req.flash?.("error", "Invalid staff status.");
      return res.redirect("/admin/staff");
    }

    await Staff.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status, updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Staff status updated.");
    return res.redirect("/admin/staff");
  },

  delete: async (req, res) => {
    const { Staff } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid staff ID.");
      return res.redirect("/admin/staff");
    }

    await Staff.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Staff record deleted.");
    return res.redirect("/admin/staff");
  },

  bulkAction: async (req, res) => {
    const { Staff } = req.models;

    const ids = str(req.body.ids)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    if (!ids.length) {
      req.flash?.("error", "No staff selected.");
      return res.redirect("/admin/staff");
    }

    const action = str(req.body.action);
    const patch = { updatedBy: actorUserId(req) };

    if (action === "activate") patch.status = "Active";
    else if (action === "leave") patch.status = "On Leave";
    else if (action === "suspend") patch.status = "Suspended";
    else if (action === "exit") patch.status = "Exited";
    else if (action === "delete") {
      patch.isDeleted = true;
      patch.deletedAt = new Date();
    } else {
      req.flash?.("error", "Invalid bulk action.");
      return res.redirect("/admin/staff");
    }

    await Staff.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/staff");
  },
};
const mongoose = require("mongoose");
const {
  ROLE_PERMISSION_CATALOG,
  normalizeRoleCode,
  normalizePermissionList,
  parsePermissionForm,
  escapeRegex,
  csvCell,
} = require("../../../services/tenant/roleService");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

function buildFilters(query = {}) {
  const q = str(query.q).slice(0, 160);
  const status = ["Active", "Inactive"].includes(str(query.status)) ? str(query.status) : "all";
  const view = ["list", "permissions", "summary"].includes(str(query.view)) ? str(query.view) : "list";
  const mongo = { isDeleted: { $ne: true } };

  if (status !== "all") mongo.status = status;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    mongo.$or = [{ name: rx }, { code: rx }, { description: rx }, { permissions: rx }];
  }

  return { mongo, clean: { q, status, view } };
}

function serializeRole(doc, usersCount = 0) {
  return {
    id: String(doc._id),
    name: doc.name || "",
    code: doc.code || "",
    description: doc.description || "",
    status: doc.status || "Active",
    permissions: normalizePermissionList(doc.permissions),
    usersCount: Number(usersCount || 0),
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
  };
}

function computeKpis(list = []) {
  return {
    total: list.length,
    active: list.filter((x) => x.status === "Active").length,
    inactive: list.filter((x) => x.status === "Inactive").length,
    permissions: list.reduce((sum, x) => sum + Number((x.permissions || []).length), 0),
  };
}

async function assignedCounts(Staff, roleIds) {
  const counts = new Map();
  if (!Staff || !roleIds.length) return counts;
  const rows = await Staff.aggregate([
    { $match: { roleId: { $in: roleIds }, isDeleted: { $ne: true } } },
    { $group: { _id: "$roleId", count: { $sum: 1 } } },
  ]);
  rows.forEach((row) => counts.set(String(row._id), Number(row.count || 0)));
  return counts;
}

function flashMessages(req) {
  return {
    success: req.flash?.("success") || [],
    error: req.flash?.("error") || [],
  };
}

async function roleIsAssigned(Staff, roleId) {
  if (!Staff) return false;
  return (await Staff.countDocuments({ roleId, isDeleted: { $ne: true } })) > 0;
}

function duplicateMessage(err) {
  if (err?.code !== 11000) return null;
  if (err?.keyPattern?.code) return "Role code already exists.";
  return "Role name already exists.";
}

module.exports = {
  index: async (req, res) => {
    const { StaffRole, Staff } = req.models;
    const { mongo, clean } = buildFilters(req.query);
    const roleDocs = await StaffRole.find(mongo).sort({ createdAt: -1 }).lean();
    const counts = await assignedCounts(Staff, roleDocs.map((r) => r._id));
    const roles = roleDocs.map((doc) => serializeRole(doc, counts.get(String(doc._id)) || 0));

    return res.render("tenant/staff/roles", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      roles,
      kpis: computeKpis(roles),
      query: clean,
      permissionCatalog: ROLE_PERMISSION_CATALOG,
      messages: flashMessages(req),
    });
  },

  create: async (req, res) => {
    const { StaffRole } = req.models;
    const name = str(req.body.name).slice(0, 120);
    const code = normalizeRoleCode(req.body.code || name);
    const description = str(req.body.description).slice(0, 3000);
    const status = ["Active", "Inactive"].includes(str(req.body.status)) ? str(req.body.status) : "Active";
    const permissions = parsePermissionForm(req.body);

    if (!name) {
      req.flash?.("error", "Role name is required.");
      return res.redirect("/admin/roles");
    }

    try {
      await StaffRole.create({
        name,
        code,
        description,
        status,
        permissions,
        usersCount: 0,
        createdBy: actorUserId(req),
        updatedBy: actorUserId(req),
      });
      req.flash?.("success", "Role created successfully.");
    } catch (err) {
      const msg = duplicateMessage(err);
      if (!msg) throw err;
      req.flash?.("error", msg);
    }
    return res.redirect("/admin/roles");
  },

  update: async (req, res) => {
    const { StaffRole } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid role ID.");
      return res.redirect("/admin/roles");
    }

    const role = await StaffRole.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!role) {
      req.flash?.("error", "Role not found.");
      return res.redirect("/admin/roles");
    }

    const name = str(req.body.name).slice(0, 120);
    if (!name) {
      req.flash?.("error", "Role name is required.");
      return res.redirect("/admin/roles");
    }

    role.name = name;
    role.code = normalizeRoleCode(req.body.code || name);
    role.description = str(req.body.description).slice(0, 3000);
    role.status = ["Active", "Inactive"].includes(str(req.body.status)) ? str(req.body.status) : role.status;
    role.permissions = parsePermissionForm(req.body);
    role.updatedBy = actorUserId(req);

    try {
      await role.save();
      req.flash?.("success", "Role updated successfully.");
    } catch (err) {
      const msg = duplicateMessage(err);
      if (!msg) throw err;
      req.flash?.("error", msg);
    }
    return res.redirect("/admin/roles");
  },

  activate: async (req, res) => {
    const { StaffRole } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/roles");
    await StaffRole.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Active", updatedBy: actorUserId(req) } },
    );
    req.flash?.("success", "Role activated.");
    return res.redirect("/admin/roles");
  },

  deactivate: async (req, res) => {
    const { StaffRole } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/roles");
    await StaffRole.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Inactive", updatedBy: actorUserId(req) } },
    );
    req.flash?.("success", "Role deactivated. Assigned non-admin users lose custom-role access immediately.");
    return res.redirect("/admin/roles");
  },

  delete: async (req, res) => {
    const { StaffRole, Staff } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/roles");
    if (await roleIsAssigned(Staff, req.params.id)) {
      req.flash?.("error", "Role is assigned to staff and cannot be deleted. Reassign those staff first.");
      return res.redirect("/admin/roles");
    }
    await StaffRole.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), status: "Inactive", updatedBy: actorUserId(req) } },
    );
    req.flash?.("success", "Role deleted.");
    return res.redirect("/admin/roles");
  },

  bulkAction: async (req, res) => {
    const { StaffRole, Staff } = req.models;
    const ids = str(req.body.ids).split(",").map((x) => x.trim()).filter(isValidId);
    const action = str(req.body.action);
    if (!ids.length) {
      req.flash?.("error", "No roles selected.");
      return res.redirect("/admin/roles");
    }
    if (!["activate", "deactivate", "delete"].includes(action)) {
      req.flash?.("error", "Invalid bulk action.");
      return res.redirect("/admin/roles");
    }

    if (action === "delete") {
      const assigned = Staff ? await Staff.distinct("roleId", { roleId: { $in: ids }, isDeleted: { $ne: true } }) : [];
      const assignedSet = new Set(assigned.map(String));
      const deletable = ids.filter((id) => !assignedSet.has(String(id)));
      if (deletable.length) {
        await StaffRole.updateMany(
          { _id: { $in: deletable }, isDeleted: { $ne: true } },
          { $set: { isDeleted: true, deletedAt: new Date(), status: "Inactive", updatedBy: actorUserId(req) } },
        );
      }
      const skipped = ids.length - deletable.length;
      req.flash?.(skipped ? "error" : "success", skipped
        ? `${deletable.length} role(s) deleted; ${skipped} assigned role(s) were kept.`
        : `${deletable.length} role(s) deleted.`);
      return res.redirect("/admin/roles");
    }

    await StaffRole.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: { status: action === "activate" ? "Active" : "Inactive", updatedBy: actorUserId(req) } },
    );
    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/roles");
  },

  exportCsv: async (req, res) => {
    const { StaffRole, Staff } = req.models;
    const { mongo } = buildFilters(req.query);
    const roleDocs = await StaffRole.find(mongo).sort({ createdAt: -1 }).lean();
    const counts = await assignedCounts(Staff, roleDocs.map((r) => r._id));
    const rows = roleDocs.map((doc) => serializeRole(doc, counts.get(String(doc._id)) || 0));
    const lines = [["Role", "Code", "Status", "Assigned Staff", "Permissions", "Description", "Created At"].map(csvCell).join(",")];
    rows.forEach((role) => lines.push([
      role.name,
      role.code,
      role.status,
      role.usersCount,
      role.permissions.join(" | "),
      role.description,
      role.createdAt,
    ].map(csvCell).join(",")));

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="staff-roles.csv"');
    return res.send(`\uFEFF${lines.join("\r\n")}`);
  },
};

const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

function parsePermissions(body = {}) {
  const all = [
    "dashboard",
    "students",
    "parents",
    "staff",
    "users",
    "roles",
    "leave",
    "payroll",
    "programs",
    "courses",
    "classes",
    "attendance",
    "results",
    "transcripts",
    "finance",
    "invoices",
    "payments",
    "studentStatements",
    "feeStructures",
    "scholarships",
    "financeReports",
    "expenses",
    "library",
    "hostels",
    "assets",
    "events",
    "announcements",
    "messaging",
    "reports",
    "settings",
  ];

  return all.filter((key) =>
    ["1", "true", "yes", "on"].includes(String(body[`perm_${key}`] || "").toLowerCase())
  );
}

function serializeRole(doc) {
  return {
    id: String(doc._id),
    name: doc.name || "",
    code: doc.code || "",
    description: doc.description || "",
    status: doc.status || "Active",
    permissions: Array.isArray(doc.permissions) ? doc.permissions : [],
    usersCount: Number(doc.usersCount || 0),
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

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const view = str(query.view || "list") || "list";

  const mongo = { isDeleted: { $ne: true } };

  if (status !== "all") mongo.status = status;

  if (q) {
    mongo.$or = [
      { name: new RegExp(q, "i") },
      { code: new RegExp(q, "i") },
      { description: new RegExp(q, "i") },
      { status: new RegExp(q, "i") },
      { permissions: new RegExp(q, "i") },
    ];
  }

  return { mongo, clean: { q, status, view } };
}

module.exports = {
  index: async (req, res) => {
    const { StaffRole } = req.models;

    const { mongo, clean } = buildFilters(req.query);

    const roleDocs = await StaffRole.find(mongo)
      .sort({ createdAt: -1 })
      .lean();

    const roles = roleDocs.map(serializeRole);
    const kpis = computeKpis(roles);

    return res.render("tenant/staff/roles", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      roles,
      kpis,
      query: clean,
    });
  },

  create: async (req, res) => {
    const { StaffRole } = req.models;

    const name = str(req.body.name);
    const code = str(req.body.code);
    const description = str(req.body.description);
    const status = str(req.body.status || "Active");
    const permissions = parsePermissions(req.body);

    if (!name) {
      req.flash?.("error", "Role name is required.");
      return res.redirect("/admin/roles");
    }

    await StaffRole.create({
      name,
      code,
      description,
      status: ["Active", "Inactive"].includes(status) ? status : "Active",
      permissions,
      usersCount: 0,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Role created successfully.");
    return res.redirect("/admin/roles");
  },

  update: async (req, res) => {
    const { StaffRole } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid role ID.");
      return res.redirect("/admin/roles");
    }

    const role = await StaffRole.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!role) {
      req.flash?.("error", "Role not found.");
      return res.redirect("/admin/roles");
    }

    const name = str(req.body.name);
    const code = str(req.body.code);
    const description = str(req.body.description);
    const status = str(req.body.status || role.status || "Active");
    const permissions = parsePermissions(req.body);

    if (!name) {
      req.flash?.("error", "Role name is required.");
      return res.redirect("/admin/roles");
    }

    role.name = name;
    role.code = code;
    role.description = description;
    role.status = ["Active", "Inactive"].includes(status) ? status : role.status;
    role.permissions = permissions;
    role.updatedBy = actorUserId(req);

    await role.save();

    req.flash?.("success", "Role updated successfully.");
    return res.redirect("/admin/roles");
  },

  activate: async (req, res) => {
    const { StaffRole } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid role ID.");
      return res.redirect("/admin/roles");
    }

    await StaffRole.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Active", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Role activated.");
    return res.redirect("/admin/roles");
  },

  deactivate: async (req, res) => {
    const { StaffRole } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid role ID.");
      return res.redirect("/admin/roles");
    }

    await StaffRole.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Inactive", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Role deactivated.");
    return res.redirect("/admin/roles");
  },

  delete: async (req, res) => {
    const { StaffRole } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid role ID.");
      return res.redirect("/admin/roles");
    }

    await StaffRole.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Role deleted.");
    return res.redirect("/admin/roles");
  },

  bulkAction: async (req, res) => {
    const { StaffRole } = req.models;

    const ids = str(req.body.ids)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    if (!ids.length) {
      req.flash?.("error", "No roles selected.");
      return res.redirect("/admin/roles");
    }

    const action = str(req.body.action);
    const patch = { updatedBy: actorUserId(req) };

    if (action === "activate") patch.status = "Active";
    if (action === "deactivate") patch.status = "Inactive";
    if (action === "delete") {
      patch.isDeleted = true;
      patch.deletedAt = new Date();
    }

    await StaffRole.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/roles");
  },
};
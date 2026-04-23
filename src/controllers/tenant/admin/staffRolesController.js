const mongoose = require("mongoose");
const isValidId = (id) => !!id && mongoose.Types.ObjectId.isValid(String(id));

function safeJsonArray(v) {
  try {
    const a = JSON.parse(String(v || "[]"));
    return Array.isArray(a) ? a.slice(0, 300).map(String) : [];
  } catch (e) {
    return [];
  }
}

module.exports = {
  index: async (req, res) => {
    const { StaffRole } = req.models;
    const q = String(req.query.q || "").trim();

    const query = { isDeleted: { $ne: true } };
    if (q) query.$or = [{ title: new RegExp(q, "i") }, { slug: new RegExp(q, "i") }];

    const roles = await StaffRole.find(query).sort({ sort: 1, title: 1 }).lean();

    return res.render("tenant/staff/roles", {
      tenant: req.tenant,
      roles,
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      query: { q },
      flash: req.flash ? { success: req.flash("success")[0], error: req.flash("error")[0] } : null,
    });
  },

  create: async (req, res) => {
    const { StaffRole } = req.models;

    const title = String(req.body.title || "").trim();
    const slug = String(req.body.slug || "").trim().toLowerCase();
    const description = String(req.body.description || "").trim();
    const sort = Number(req.body.sort || 0);
    const isActive = String(req.body.isActive || "true") === "true";
    const permissions = safeJsonArray(req.body.permissionsJson);

    if (!title) {
      if (req.flash) req.flash("error", "Role title is required.");
      return res.redirect("/admin/staff/roles");
    }

    await StaffRole.create({ title, slug: slug || undefined, description, sort, isActive, permissions });
    if (req.flash) req.flash("success", "Role created.");
    return res.redirect("/admin/staff/roles");
  },

  update: async (req, res) => {
    const { StaffRole } = req.models;
    const id = String(req.params.id || "");
    if (!isValidId(id)) return res.redirect("/admin/staff/roles");

    const title = String(req.body.title || "").trim();
    const slug = String(req.body.slug || "").trim().toLowerCase();
    const description = String(req.body.description || "").trim();
    const sort = Number(req.body.sort || 0);
    const isActive = String(req.body.isActive || "true") === "true";
    const permissions = safeJsonArray(req.body.permissionsJson);

    const role = await StaffRole.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!role) {
      if (req.flash) req.flash("error", "Role not found.");
      return res.redirect("/admin/staff/roles");
    }

    role.title = title || role.title;
    role.slug = slug || role.slug;
    role.description = description;
    role.sort = Number.isFinite(sort) ? sort : role.sort;
    role.isActive = isActive;
    role.permissions = permissions;

    await role.save();

    if (req.flash) req.flash("success", "Role updated.");
    return res.redirect("/admin/staff/roles");
  },

  toggle: async (req, res) => {
    const { StaffRole } = req.models;
    const id = String(req.params.id || "");
    if (!isValidId(id)) return res.redirect("/admin/staff/roles");

    const role = await StaffRole.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!role) return res.redirect("/admin/staff/roles");

    role.isActive = !role.isActive;
    await role.save();

    if (req.flash) req.flash("success", "Role status updated.");
    return res.redirect("/admin/staff/roles");
  },

  remove: async (req, res) => {
    const { StaffRole } = req.models;
    const id = String(req.params.id || "");
    if (!isValidId(id)) return res.redirect("/admin/staff/roles");

    const role = await StaffRole.findOne({ _id: id, isDeleted: { $ne: true } });
    if (role) await role.softDelete();

    if (req.flash) req.flash("success", "Role deleted.");
    return res.redirect("/admin/staff/roles");
  },
};

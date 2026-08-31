const { getParent, loadLinkedChildren } = require("./_helpers");
const {
  assertParentEmailOwnership,
  syncParentIdentity,
} = require("../../../services/tenant/parentLifecycleService");

function clean(v, max = 200) {
  return String(v || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function lower(v) {
  return clean(v, 120).toLowerCase();
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ""));
}

module.exports = {
  async index(req, res) {
    try {
      const { Student } = req.models || {};
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const children = await loadLinkedChildren(req, parent);


      return res.render("parents/profile", {
        tenant: req.tenant,
        user,
        parent,
        children,
        formData: {
          firstName: parent?.firstName || user?.firstName || "",
          lastName: parent?.lastName || user?.lastName || "",
          email: parent?.email || user?.email || "",
          phone: parent?.phone || user?.phone || "",
          relationship: parent?.relationship || "Guardian",
          addressLine1: parent?.addressLine1 || "",
          addressLine2: parent?.addressLine2 || "",
          city: parent?.city || "",
          country: parent?.country || "",
          occupation: parent?.occupation || "",
          notes: parent?.notes || "",
        },
        success: req.flash?.("success") || [],
        error: req.flash?.("error") || [],
      });
    } catch (err) {
      console.error("PARENT PROFILE INDEX ERROR:", err);
      return res.status(500).send("Failed to load parent profile page");
    }
  },

  async update(req, res) {
    try {
      const { Parent } = req.models || {};
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");
      if (!Parent || !parent?._id) {
        req.flash?.("error", "Parent profile not found. Contact admin.");
        return res.redirect("/parent/profile");
      }

      const firstName = clean(req.body?.firstName, 80);
      const lastName = clean(req.body?.lastName, 80);
      const email = lower(req.body?.email);
      const phone = clean(req.body?.phone, 40);
      const relationship = clean(req.body?.relationship, 60) || "Guardian";
      const addressLine1 = clean(req.body?.addressLine1, 160);
      const addressLine2 = clean(req.body?.addressLine2, 160);
      const city = clean(req.body?.city, 100);
      const country = clean(req.body?.country, 100);
      const occupation = clean(req.body?.occupation, 120);
      const notes = clean(req.body?.notes, 1200);

      if (!firstName || !lastName) throw new Error("First name and last name are required.");
      if (!validEmail(email)) throw new Error("A valid email is required.");
      await assertParentEmailOwnership(req, parent, email);

      const previous = { ...parent };
      await Parent.updateOne(
        { _id: parent._id, isDeleted: { $ne: true }, status: { $in: ["active", "on_hold"] } },
        { $set: { firstName, lastName, email, phone, relationship, addressLine1, addressLine2, city, country, occupation, notes, updatedBy: user._id } },
        { runValidators: true },
      );
      const updated = await Parent.findById(parent._id);
      if (!updated) throw new Error("Parent profile not found.");
      await syncParentIdentity(req, updated, previous);

      req.flash?.("success", "Parent profile updated successfully.");
      return res.redirect("/parent/profile");
    } catch (err) {
      console.error("PARENT PROFILE UPDATE ERROR:", err);
      req.flash?.("error", err?.message || "Failed to update parent profile.");
      return res.redirect("/parent/profile");
    }
  },
};

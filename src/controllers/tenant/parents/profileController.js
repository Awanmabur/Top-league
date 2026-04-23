const { getParent } = require("./_helpers");

function clean(v) {
  return String(v || "").trim();
}

function lower(v) {
  return clean(v).toLowerCase();
}

module.exports = {
  async index(req, res) {
    const log = (...a) =>
      console.log(
        `[PARENT-PROFILE] tenant=${req.tenant?.code || req.tenant?._id || "?"}`,
        ...a
      );

    try {
      const { Student } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const childIds = Array.isArray(parent?.childrenStudentIds)
        ? parent.childrenStudentIds
        : [];

      const children =
        parent && Student && childIds.length
          ? await Student.find({ _id: { $in: childIds }, deletedAt: null })
              .select("firstName lastName middleName fullName regNo classGroup program yearLevel academicYear semester status")
              .populate({ path: "classGroup", select: "code name title" })
              .populate({ path: "program", select: "code name title" })
              .sort({ firstName: 1, lastName: 1 })
              .lean()
              .catch(() => [])
          : [];

      log(
        "user:",
        user ? { id: user._id, email: user.email, roles: user.roles } : null
      );
      log(
        "parent:",
        parent
          ? { id: parent._id, email: parent.email, kids: (parent.childrenStudentIds || []).length }
          : null
      );

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

      const firstName = clean(req.body?.firstName);
      const lastName = clean(req.body?.lastName);
      const email = lower(req.body?.email);
      const phone = clean(req.body?.phone);
      const relationship = clean(req.body?.relationship) || "Guardian";
      const addressLine1 = clean(req.body?.addressLine1);
      const addressLine2 = clean(req.body?.addressLine2);
      const city = clean(req.body?.city);
      const country = clean(req.body?.country);
      const occupation = clean(req.body?.occupation);
      const notes = clean(req.body?.notes);

      if (!firstName || !lastName) {
        req.flash?.("error", "First name and last name are required.");
        return res.redirect("/parent/profile");
      }

      if (!email) {
        req.flash?.("error", "Email is required.");
        return res.redirect("/parent/profile");
      }

      await Parent.updateOne(
        { _id: parent._id, deletedAt: null },
        {
          $set: {
            firstName,
            lastName,
            email,
            phone,
            relationship,
            addressLine1,
            addressLine2,
            city,
            country,
            occupation,
            notes,
            updatedAt: new Date(),
          },
        }
      );

      req.flash?.("success", "Parent profile updated successfully.");
      return res.redirect("/parent/profile");
    } catch (err) {
      console.error("PARENT PROFILE UPDATE ERROR:", err);
      req.flash?.("error", err?.message || "Failed to update parent profile.");
      return res.redirect("/parent/profile");
    }
  },
};
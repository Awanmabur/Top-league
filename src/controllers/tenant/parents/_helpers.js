const mongoose = require("mongoose");

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function lowerEmail(v) {
  return String(v || "").trim().toLowerCase();
}

/**
 * JWT-only: requireTenantAuth sets req.user = { userId, email, roles, tenantCode }
 */
async function getAuthUser(req) {
  const { User } = req.models || {};
  const userId = req.user?.userId;

  if (!User || !userId || !isValidId(userId)) return null;

  return User.findOne({ _id: userId, deletedAt: null })
    .select("_id email roles status firstName lastName childrenStudentIds")
    .lean()
    .catch(() => null);
}

/**
 * Always returns:
 * - user: User doc
 * - parent: Parent doc OR null (never a User doc)
 *
 * If you want to auto-create Parent doc, set AUTO_CREATE_PARENT_PROFILE=1
 */
async function getParent(req) {
  const { Parent } = req.models || {};
  const user = await getAuthUser(req);

  if (!user) return { user: null, parent: null };

  if (!Parent) {
    return { user, parent: null };
  }

  const email = lowerEmail(user.email);

  let parent = await Parent.findOne({ userId: user._id }).lean().catch(() => null);
  if (!parent && email) parent = await Parent.findOne({ email }).lean().catch(() => null);

  const auto = String(process.env.AUTO_CREATE_PARENT_PROFILE || "") === "1";
  const isParentRole = Array.isArray(user.roles) && user.roles.includes("parent");

  if (!parent && auto && isParentRole && email) {
    try {
      parent = await Parent.findOneAndUpdate(
        { email },
        {
          $setOnInsert: {
            userId: user._id,
            firstName: user.firstName || "Parent",
            lastName: user.lastName || "",
            email,
            phone: "",
            relationship: "Guardian",
            status: "pending",
            childrenStudentIds: [],
          },
          $set: { userId: user._id },
          $addToSet: { childrenStudentIds: { $each: user.childrenStudentIds || [] } },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
        .lean()
        .catch((e) => {
          console.error("Parent profile upsert failed:", e?.message || e);
          return null;
        });
    } catch (e) {
      console.error("Parent profile auto-create error:", e?.message || e);
      parent = null;
    }
  }

  return { user, parent: parent || null };
}

function canAccessChild(parent, studentId) {
  const sid = String(studentId || "");
  if (!sid) return false;

  const ids = (parent?.childrenStudentIds || []).map(String);
  return ids.includes(sid);
}

function renderError(res, view, data, message) {
  return res.status(400).render(view, { ...data, error: message });
}

module.exports = {
  isValidId,
  getAuthUser,
  getParent,
  canAccessChild,
  renderError,
};

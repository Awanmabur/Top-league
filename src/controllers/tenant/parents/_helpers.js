const mongoose = require("mongoose");

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function lowerEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function dbg(req) {
  return String(req.query?.debug || "") === "1" || String(process.env.DEBUG_PARENT || "") === "1";
}
function log(req, ...a) {
  if (dbg(req)) console.log("[GET-PARENT]", ...a);
}
function warn(req, ...a) {
  console.warn("[GET-PARENT]", ...a);
}
function err(req, ...a) {
  console.error("[GET-PARENT]", ...a);
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

  log(req, "req.user:", req.user);
  log(req, "auth user:", user ? { _id: String(user._id), email: user.email, roles: user.roles } : null);

  if (!user) return { user: null, parent: null };

  // If Parent model is not loaded in tenant models, you will NEVER see Parent docs in Atlas
  if (!Parent) {
    warn(req, "Parent model missing from req.models. Returning parent=null.");
    return { user, parent: null };
  }

  const email = lowerEmail(user.email);

  let parent = await Parent.findOne({ userId: user._id }).lean().catch(() => null);
  if (!parent && email) parent = await Parent.findOne({ email }).lean().catch(() => null);

  log(req, "parent doc:", parent ? { _id: String(parent._id), email: parent.email } : null);

  // Optional auto-create
  const auto = String(process.env.AUTO_CREATE_PARENT_PROFILE || "") === "1";
  const isParentRole = Array.isArray(user.roles) && user.roles.includes("parent");

  if (!parent && auto && isParentRole && email) {
    log(req, "Parent doc missing -> auto-creating:", email);

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
          err(req, "Parent upsert failed:", e?.message, "code:", e?.code);
          return null;
        });

      log(req, "parent after upsert:", parent ? { _id: String(parent._id), email: parent.email } : null);
    } catch (e) {
      err(req, "Parent auto-create error:", e?.message);
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

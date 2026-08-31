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
    .select("_id email phone roles status firstName lastName childrenStudentIds")
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

  const accessFilter = { isDeleted: { $ne: true }, status: { $in: ["active", "on_hold"] } };
  let parent = await Parent.findOne({ userId: user._id, ...accessFilter }).lean().catch(() => null);
  if (!parent && email) parent = await Parent.findOne({ email, ...accessFilter }).lean().catch(() => null);

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
            status: "active",
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


const LINKED_CHILD_SELECT = [
  "firstName", "lastName", "middleName", "fullName", "regNo", "studentNo",
  "programId", "classId", "className", "classCode", "classLevel", "schoolLevel",
  "sectionId", "section", "streamId", "stream", "academicYear", "term", "status",
  "photoUrl", "guardianName", "guardianPhone", "guardianEmail", "financeBalance",
  "averageScore", "avgScore", "cgpa", "latestResult", "latestAnnouncement",
  "lastAttendanceDate", "nextEvent", "campusId", "campusName", "homeroomTeacher",
  "parentRelationship", "dob", "dateOfBirth", "gender", "admissionDate"
].join(" ");

async function loadLinkedChildren(req, parent, options = {}) {
  const { Student, Program } = req.models || {};
  const childIds = Array.isArray(parent?.childrenStudentIds) ? parent.childrenStudentIds : [];
  if (!parent || !Student || !childIds.length) return [];

  const filter = {
    _id: { $in: childIds },
    isDeleted: { $ne: true },
    status: { $ne: "archived" },
  };
  if (options.studentId) {
    if (!canAccessChild(parent, options.studentId)) return [];
    filter._id = options.studentId;
  }

  let query = Student.find(filter).select(`${LINKED_CHILD_SELECT} ${String(options.extraSelect || "").trim()}`.trim());
  if (Program) query = query.populate({ path: "programId", model: Program, select: "code name title shortTitle levelType status" });
  query = query.sort(options.sort || { firstName: 1, lastName: 1 });
  if (Number(options.limit) > 0) query = query.limit(Math.min(500, Number(options.limit)));
  return query.lean();
}

async function loadLinkedChild(req, parent, studentId, options = {}) {
  const rows = await loadLinkedChildren(req, parent, { ...options, studentId, limit: 1 });
  return rows[0] || null;
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
  loadLinkedChildren,
  loadLinkedChild,
};

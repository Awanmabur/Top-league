const { normalizeRoleCode, normalizePermissionList } = require("../../src/services/tenant/roleService");

function uniqueCode(base, id, used) {
  const cleanBase = normalizeRoleCode(base) || "ROLE";
  if (!used.has(cleanBase)) return cleanBase;
  const suffix = String(id || "").replace(/[^a-f0-9]/gi, "").slice(-8).toUpperCase() || "LEGACY";
  const trimmed = cleanBase.slice(0, Math.max(1, 80 - suffix.length - 1));
  let candidate = `${trimmed}_${suffix}`;
  let n = 2;
  while (used.has(candidate)) {
    const extra = `_${n++}`;
    candidate = `${trimmed.slice(0, 80 - suffix.length - extra.length - 1)}_${suffix}${extra}`;
  }
  return candidate;
}

function statusRank(status) {
  if (status === "Active") return 0;
  if (status === "On Leave") return 1;
  if (status === "Suspended") return 2;
  return 3;
}

async function migrateStaffRoles(models = {}) {
  const { StaffRole, Staff, User } = models;
  let rolesScanned = 0;
  let rolesNormalized = 0;
  let codesRepaired = 0;
  let permissionsNormalized = 0;
  let userCountsSynced = 0;
  let duplicateStaffLinksCleared = 0;
  let userStaffLinksSynced = 0;

  if (StaffRole) {
    const roles = await StaffRole.find({ isDeleted: { $ne: true } })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    rolesScanned = roles.length;
    const used = new Set();

    for (const row of roles) {
      const patch = {};
      const code = uniqueCode(row.code || row.name, row._id, used);
      used.add(code);
      if (row.code !== code) {
        patch.code = code;
        codesRepaired += 1;
      }

      const permissions = normalizePermissionList(row.permissions);
      const before = Array.isArray(row.permissions) ? row.permissions.map(String).sort() : [];
      if (JSON.stringify(before) !== JSON.stringify(permissions)) {
        patch.permissions = permissions;
        permissionsNormalized += 1;
      }

      if (!["Active", "Inactive"].includes(row.status)) patch.status = "Inactive";

      if (Staff) {
        const usersCount = await Staff.countDocuments({
          roleId: row._id,
          isDeleted: { $ne: true },
        });
        if (Number(row.usersCount || 0) !== usersCount) {
          patch.usersCount = usersCount;
          userCountsSynced += 1;
        }
      }

      if (Object.keys(patch).length) {
        await StaffRole.updateOne({ _id: row._id }, { $set: patch });
        rolesNormalized += 1;
      }
    }
  }

  if (Staff) {
    const staffRows = await Staff.find({
      isDeleted: { $ne: true },
      userId: { $ne: null },
    })
      .select("_id userId status createdAt")
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    const groups = new Map();
    for (const row of staffRows) {
      const key = String(row.userId || "");
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    for (const [userId, rows] of groups.entries()) {
      let user = null;
      if (User) user = await User.findOne({ _id: userId, deletedAt: null }).select("_id staffId").lean();

      rows.sort((a, b) => {
        const aMatches = user?.staffId && String(user.staffId) === String(a._id) ? -1 : 0;
        const bMatches = user?.staffId && String(user.staffId) === String(b._id) ? -1 : 0;
        if (aMatches !== bMatches) return aMatches - bMatches;
        const statusDiff = statusRank(a.status) - statusRank(b.status);
        if (statusDiff) return statusDiff;
        return String(a._id).localeCompare(String(b._id));
      });

      const keep = rows[0];
      for (const duplicate of rows.slice(1)) {
        await Staff.updateOne({ _id: duplicate._id, userId }, { $set: { userId: null } });
        duplicateStaffLinksCleared += 1;
      }

      if (User && user && String(user.staffId || "") !== String(keep._id)) {
        await User.updateOne({ _id: user._id, deletedAt: null }, { $set: { staffId: keep._id } });
        userStaffLinksSynced += 1;
      }
    }
  }

  return {
    rolesScanned,
    rolesNormalized,
    codesRepaired,
    permissionsNormalized,
    userCountsSynced,
    duplicateStaffLinksCleared,
    userStaffLinksSynced,
  };
}

module.exports = { migrateStaffRoles, uniqueCode };

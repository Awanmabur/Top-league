// src/controllers/tenant/usersController.js
const mongoose = require("mongoose");
const crypto = require("crypto");
const { normalizeTenantRoles, getPrimaryTenantRole } = require("../../../utils/tenantRoles");

const USER_STATUS = {
  INVITED: "invited",
  ACTIVE: "active",
  SUSPENDED: "suspended",
};

const STAFF_STATUS = {
  ACTIVE: "Active",
  ON_LEAVE: "On Leave",
  SUSPENDED: "Suspended",
  EXITED: "Exited",
};

function inviteSecret() {
  const secret = process.env.INVITE_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing INVITE_TOKEN_SECRET (or JWT_SECRET fallback)");
  return secret;
}

function hmacToken(token) {
  return crypto.createHmac("sha256", inviteSecret()).update(String(token)).digest("hex");
}

function makeInviteToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function nowPlusHours(h) {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

function getProto(req) {
  return (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim();
}

function buildInviteLink(req, rawToken) {
  const proto = getProto(req);
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}/set-password?token=${encodeURIComponent(rawToken)}`;
}

async function loadProgramsAndDepartments(req) {
  const { Program, Department, ClassGroup } = req.models || {};
  const programs = Program ? await Program.find().sort({ name: 1 }).lean() : [];
  const departments = Department ? await Department.find().sort({ name: 1 }).lean() : [];
  const classGroups = ClassGroup ? await ClassGroup.find().sort({ name: 1 }).lean() : [];
  return { programs, departments, classGroups };
}

async function loadUsersPageData(req) {
  const { User } = req.models;
  const { programs, departments, classGroups } = await loadProgramsAndDepartments(req);

  const usersRaw = await User.find({ deletedAt: null }).sort({ createdAt: -1 }).lean();

  const users = usersRaw.map((u) => ({
    id: String(u._id),
    _id: String(u._id),
    firstName: u.firstName || "",
    lastName: u.lastName || "",
    fullName: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || "—",
    email: u.email || "",
    phone: u.phone || "",
    roles: Array.isArray(u.roles) ? u.roles : [],
    rolesText: getPrimaryTenantRole(u.roles) || "—",
    status: u.status || USER_STATUS.INVITED,
    hasPassword: !!u.passwordHash,
    staffId: u.staffId ? String(u.staffId) : null,
    studentId: u.studentId ? String(u.studentId) : null,
    createdAtRaw: u.createdAt || null,
    createdAt: u.createdAt ? new Date(u.createdAt).toLocaleString() : "—",
  }));

  const kpis = {
    total: users.length,
    invited: users.filter((u) => u.status === USER_STATUS.INVITED).length,
    active: users.filter((u) => u.status === USER_STATUS.ACTIVE).length,
    suspended: users.filter((u) => u.status === USER_STATUS.SUSPENDED).length,
  };

  return { users, programs, departments, classGroups, kpis };
}

async function renderIndex(req, res, extra = {}) {
  const base = await loadUsersPageData(req);
  return res.render("tenant/users/index", {
    ...base,
    error: null,
    values: {},
    inviteResult: null,
    openModal: null,
    query: {
      q: req.query?.q || "",
      status: req.query?.status || "all",
      role: req.query?.role || "all",
    },
    ...extra,
  });
}

module.exports = {
  list: async (req, res) => {
    return renderIndex(req, res);
  },

  newForm: async (req, res) => {
    return res.redirect("/admin/users");
  },

  view: async (req, res) => {
    return res.redirect("/admin/users");
  },

  create: async (req, res) => {
    const { User, Student, Staff, InviteToken } = req.models;

    if (!InviteToken) {
      return res.status(500).send("InviteToken model not loaded in req.models");
    }

    const sessionCapable = !!req.tenantConnection?.startSession;

    const run = async (session) => {
      const {
        firstName,
        lastName,
        email,
        phone,
        role,
        regNo,
        programId,
        departmentId,
        classGroupId,
      } = req.body;

      const cleanEmail = String(email || "").trim().toLowerCase();

      if (!firstName || !lastName || !cleanEmail || !role) {
        return renderIndex(req, res, {
          error: "First name, last name, email and role are required.",
          values: req.body,
          openModal: "mEdit",
        });
      }

      const allowedRoles = [
        "admin",
        "staff",
        "lecturer",
        "finance",
        "librarian",
        "hostel",
        "student",
        "registrar",
      ];

      if (!allowedRoles.includes(role)) {
        return renderIndex(req, res, {
          error: "Invalid role selected.",
          values: req.body,
          openModal: "mEdit",
        });
      }

      let deptId = null;
      if (departmentId) {
        if (!mongoose.Types.ObjectId.isValid(departmentId)) {
          return renderIndex(req, res, {
            error: "Please select a valid department.",
            values: req.body,
            openModal: "mEdit",
          });
        }
        deptId = departmentId;
      }

      const createdArr = await User.create(
        [
          {
            firstName: String(firstName).trim(),
            lastName: String(lastName).trim(),
            email: cleanEmail,
            phone: phone ? String(phone).trim() : null,
            roles: normalizeTenantRoles(role),
            status: USER_STATUS.INVITED,
            deletedAt: null,
            passwordHash: null,
            tokenVersion: 0,
          },
        ],
        session ? { session } : undefined
      );

      const createdUser = Array.isArray(createdArr) ? createdArr[0] : createdArr;

      if (role === "student" && Student) {
        const reg = String(regNo || "").trim();
        const progOk = programId && mongoose.Types.ObjectId.isValid(programId);
        const classOk = classGroupId && mongoose.Types.ObjectId.isValid(classGroupId);

        if (reg && progOk && classOk) {
          const stArr = await Student.create(
            [
              {
                regNo: reg,
                program: programId,
                classGroup: classGroupId,
                email: createdUser.email,
                firstName: createdUser.firstName,
                lastName: createdUser.lastName,
                status: "active",
                createdBy: req.user?.userId || null,
              },
            ],
            session ? { session } : undefined
          );

          await User.updateOne(
            { _id: createdUser._id },
            { studentId: stArr[0]._id },
            session ? { session } : undefined
          );
        }
      }

      if (role !== "student" && Staff) {
        const sfArr = await Staff.create(
          [
            {
              userId: createdUser._id,
              firstName: createdUser.firstName,
              lastName: createdUser.lastName,
              email: createdUser.email,
              phone: createdUser.phone || "",
              departmentId: deptId,
              jobTitle: role,
              status: STAFF_STATUS.ACTIVE,
              createdBy: req.user?.userId || null,
            },
          ],
          session ? { session } : undefined
        );

        await User.updateOne(
          { _id: createdUser._id },
          { staffId: sfArr[0]._id },
          session ? { session } : undefined
        );
      }

      await InviteToken.updateMany(
        {
          userId: createdUser._id,
          purpose: "set_password",
          usedAt: null,
          revokedAt: null,
        },
        { revokedAt: new Date() },
        session ? { session } : undefined
      );

      const rawToken = makeInviteToken();
      const tokenHash = hmacToken(rawToken);

      await InviteToken.create(
        [
          {
            userId: createdUser._id,
            tokenHash,
            purpose: "set_password",
            expiresAt: nowPlusHours(24),
            usedAt: null,
            revokedAt: null,
            createdBy: req.user?.userId || null,
            createdIp: req.ip,
            createdUa: req.get("user-agent") || null,
          },
        ],
        session ? { session } : undefined
      );

      const inviteLink = buildInviteLink(req, rawToken);

      return renderIndex(req, res, {
        inviteResult: {
          userId: String(createdUser._id),
          fullName: [createdUser.firstName, createdUser.lastName].filter(Boolean).join(" "),
          email: createdUser.email || "",
          roles: Array.isArray(createdUser.roles) ? createdUser.roles : [],
          inviteLink,
          mode: "created",
        },
        openModal: "mInvite",
      });
    };

    if (sessionCapable) {
      const session = await req.tenantConnection.startSession();
      try {
        let result;
        await session.withTransaction(async () => {
          result = await run(session);
        });
        return result;
      } catch (err) {
        const msg = String(err?.message || "");
        const txNotSupported =
          msg.includes("Transaction") ||
          msg.includes("replica set") ||
          msg.includes("not supported");

        if (!txNotSupported) throw err;
      } finally {
        await session.endSession().catch(() => {});
      }
    }

    try {
      return await run(null);
    } catch (err) {
      console.error("CREATE USER ERROR:", err);

      if (err && err.code === 11000) {
        return renderIndex(req, res, {
          error: "Email already exists.",
          values: req.body,
          openModal: "mEdit",
        });
      }

      return renderIndex(req, res, {
        error: err?.message || "Failed to create user.",
        values: req.body,
        openModal: "mEdit",
      });
    }
  },

  resendInvite: async (req, res) => {
    const { User, InviteToken } = req.models || {};
    if (!InviteToken || !User) return res.status(500).send("Models not loaded");

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).send("Invalid user ID");
    }

    const user = await User.findOne({ _id: req.params.id, deletedAt: null });
    if (!user) return res.status(404).send("User not found");

    await InviteToken.updateMany(
      {
        userId: user._id,
        purpose: "set_password",
        usedAt: null,
        revokedAt: null,
      },
      { revokedAt: new Date() }
    );

    const rawToken = makeInviteToken();
    const tokenHash = hmacToken(rawToken);

    await InviteToken.create({
      userId: user._id,
      tokenHash,
      purpose: "set_password",
      expiresAt: nowPlusHours(24),
      usedAt: null,
      revokedAt: null,
      createdBy: req.user?.userId || null,
      createdIp: req.ip,
      createdUa: req.get("user-agent") || null,
    });

    const inviteLink = buildInviteLink(req, rawToken);

    return renderIndex(req, res, {
      inviteResult: {
        userId: String(user._id),
        fullName: [user.firstName, user.lastName].filter(Boolean).join(" "),
        email: user.email || "",
        roles: Array.isArray(user.roles) ? user.roles : [],
        inviteLink,
        mode: "resent",
      },
      openModal: "mInvite",
    });
  },

  updateStatus: async (req, res) => {
    const { User } = req.models;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).send("Invalid user ID");
    }

    if (![USER_STATUS.INVITED, USER_STATUS.ACTIVE, USER_STATUS.SUSPENDED].includes(status)) {
      return res.status(400).send("Invalid status");
    }

    await User.updateOne(
      { _id: req.params.id, deletedAt: null },
      { status }
    );

    return res.redirect("/admin/users");
  },

  updateRoles: async (req, res) => {
    const { User } = req.models;
    let { roles } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).send("Invalid user ID");
    }

    if (typeof roles === "string") {
      roles = roles.split(",").map((r) => r.trim()).filter(Boolean);
    }

    if (!Array.isArray(roles) || roles.length === 0) {
      return res.status(400).send("Roles required");
    }

    roles = normalizeTenantRoles(roles);

    await User.updateOne(
      { _id: req.params.id, deletedAt: null },
      { roles }
    );

    return res.redirect("/admin/users");
  },

  softDelete: async (req, res) => {
    const { User } = req.models;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).send("Invalid user ID");
    }

    await User.updateOne(
      { _id: req.params.id, deletedAt: null },
      { deletedAt: new Date(), status: USER_STATUS.SUSPENDED }
    );

    return res.redirect("/admin/users");
  },

  bulk: async (req, res) => {
    const { User } = req.models;

    const ids = String(req.body.ids || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => mongoose.Types.ObjectId.isValid(x));

    const action = String(req.body.action || "");

    if (!ids.length) return res.redirect("/admin/users");

    if (action === "activate") {
      await User.updateMany(
        { _id: { $in: ids }, deletedAt: null },
        { status: USER_STATUS.ACTIVE }
      );
    } else if (action === "suspend") {
      await User.updateMany(
        { _id: { $in: ids }, deletedAt: null },
        { status: USER_STATUS.SUSPENDED }
      );
    } else if (action === "delete") {
      await User.updateMany(
        { _id: { $in: ids }, deletedAt: null },
        { deletedAt: new Date(), status: USER_STATUS.SUSPENDED }
      );
    }

    return res.redirect("/admin/users");
  },
};

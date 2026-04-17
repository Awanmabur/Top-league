const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

const { sendMail } = require("../../../utils/mailer");
const { createSetPasswordInvite } = require("../../../utils/inviteService");
const { setupPasswordEmail } = require("../../../utils/emailTemplates");

/* -----------------------
   Helpers
------------------------ */
const cleanStr = (v, max = 2000) => String(v || "").trim().slice(0, max);
const cleanEmail = (v) => String(v || "").trim().toLowerCase();
const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

function splitName(full) {
  const parts = String(full || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);

  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ") || "",
  };
}

function uniqRolesAdd(existingRoles, role) {
  const roles = new Set(Array.isArray(existingRoles) ? existingRoles : []);
  if (role) roles.add(role);
  return Array.from(roles);
}

function normalizeParentStatus(v) {
  const s = String(v || "").trim().toLowerCase();
  const allowed = new Set(["active", "on_hold", "suspended", "archived"]);
  return allowed.has(s) ? s : null;
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out.map((x) => String(x || "").trim());
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((x) => x.trim());

  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function cleanChildrenIds(v) {
  const parts = Array.isArray(v)
    ? v
    : String(v || "")
        .split(",")
        .map((x) => x.trim());

  return parts
    .map((x) => String(x || "").trim())
    .filter((x) => isObjId(x))
    .slice(0, 200);
}

async function findOrCreateParentUser({ req, ParentDoc, User }) {
  const email = cleanEmail(ParentDoc?.email);
  if (!email) return null;

  if (ParentDoc?.userId && isObjId(ParentDoc.userId)) {
    const linked = await User.findOne({ _id: ParentDoc.userId, deletedAt: null }).select(
      "+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds",
    );
    if (linked) return linked;
  }

  let user = await User.findOne({ email, deletedAt: null }).select(
    "+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds",
  );
  if (user) return user;

  const firstName = cleanStr(ParentDoc?.firstName, 60) || "Parent";
  const lastName = cleanStr(ParentDoc?.lastName, 60) || "Account";

  user = await User.create({
    firstName,
    lastName,
    email,
    phone: ParentDoc?.phone || null,
    roles: ["parent"],
    status: "invited",
    passwordHash: null,
    tokenVersion: 0,
    childrenStudentIds: Array.isArray(ParentDoc?.childrenStudentIds)
      ? ParentDoc.childrenStudentIds
      : [],
    deletedAt: null,
    createdBy: actorUserId(req) || undefined,
  });

  await req.models.Parent.updateOne(
    { _id: ParentDoc._id },
    { $set: { userId: user._id } },
  ).catch(() => {});

  return user;
}

const parentRules = [
  body("fullName")
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage("Full name is required (2-120 chars)."),

  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email is required.")
    .customSanitizer((v) => cleanEmail(v)),

  body("phone")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 40 })
    .withMessage("Phone must be 40 chars or less."),

  body("relationship")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 60 })
    .withMessage("Relationship must be 60 chars or less."),

  body("status")
    .optional({ checkFalsy: true })
    .custom((v) => !!normalizeParentStatus(v))
    .withMessage("Invalid status."),

  body("notes")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 1200 })
    .withMessage("Notes must be 1200 chars or less."),
];

module.exports = {
  parentRules,

  list: async (req, res) => {
    try {
      const { Parent } = req.models;
      if (!Parent) return res.status(500).send("Tenant models missing.");

      const q = cleanStr(req.query.q, 120);
      const status = cleanStr(req.query.status, 30);
      const page = Math.max(parseInt(String(req.query.page || "1"), 10) || 1, 1);
      const perPage = 10;

      const filter = {};

      if (q) {
        filter.$or = [
          { firstName: { $regex: q, $options: "i" } },
          { lastName: { $regex: q, $options: "i" } },
          { email: { $regex: q, $options: "i" } },
          { phone: { $regex: q, $options: "i" } },
          { relationship: { $regex: q, $options: "i" } },
        ];
      }

      if (status && normalizeParentStatus(status)) {
        filter.status = status;
      }

      const total = await Parent.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const parents = await Parent.find(filter)
        .select("firstName lastName email phone relationship status childrenStudentIds notes createdAt userId")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const kpis = {
        total,
        active: await Parent.countDocuments({ ...filter, status: "active" }),
        onHold: await Parent.countDocuments({ ...filter, status: "on_hold" }),
        archived: await Parent.countDocuments({ ...filter, status: "archived" }),
      };

      return res.render("tenant/admin/parents/index", {
        tenant: req.tenant || null,
        parents,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: {
          q,
          status,
          page: safePage,
          perPage,
          total,
          totalPages,
        },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("PARENTS LIST ERROR:", err);
      return res.status(500).send("Failed to load parents.");
    }
  },

  create: async (req, res) => {
    try {
      const { Parent } = req.models;
      if (!Parent) return res.status(500).send("Tenant models missing.");

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
        return res.redirect("/admin/parents");
      }

      const fullName = cleanStr(req.body.fullName, 120);
      const email = cleanEmail(req.body.email);
      const phone = cleanStr(req.body.phone, 40);
      const relationship = cleanStr(req.body.relationship, 60) || "Guardian";
      const status = normalizeParentStatus(req.body.status) || "active";
      const notes = cleanStr(req.body.notes, 1200);
      const { firstName, lastName } = splitName(fullName);
      const childrenStudentIds = cleanChildrenIds(req.body["childrenStudentIds[]"] ?? req.body.childrenStudentIds);

      const exists = await Parent.findOne({ email }).lean();
      if (exists) {
        req.flash?.("error", "Parent email already exists.");
        return res.redirect("/admin/parents");
      }

      await Parent.create({
        userId: null,
        firstName,
        lastName,
        email,
        phone,
        relationship,
        status,
        notes,
        childrenStudentIds,
        createdBy: actorUserId(req) || null,
      });

      req.flash?.("success", "Parent created.");
      return res.redirect("/admin/parents");
    } catch (err) {
      console.error("PARENT CREATE ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Parent email already exists.");
      else req.flash?.("error", "Failed to create parent.");
      return res.redirect("/admin/parents");
    }
  },

  update: async (req, res) => {
    try {
      const { Parent } = req.models;
      if (!Parent) return res.status(500).send("Tenant models missing.");

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
        return res.redirect("/admin/parents");
      }

      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid parent id.");
        return res.redirect("/admin/parents");
      }

      const fullName = cleanStr(req.body.fullName, 120);
      const email = cleanEmail(req.body.email);
      const phone = cleanStr(req.body.phone, 40);
      const relationship = cleanStr(req.body.relationship, 60) || "Guardian";
      const status = normalizeParentStatus(req.body.status) || "active";
      const notes = cleanStr(req.body.notes, 1200);
      const { firstName, lastName } = splitName(fullName);
      const childrenStudentIds = cleanChildrenIds(req.body["childrenStudentIds[]"] ?? req.body.childrenStudentIds);

      const collision = await Parent.findOne({ email, _id: { $ne: id } }).lean();
      if (collision) {
        req.flash?.("error", "Parent email already exists.");
        return res.redirect("/admin/parents");
      }

      await Parent.updateOne(
        { _id: id },
        {
          $set: {
            firstName,
            lastName,
            email,
            phone,
            relationship,
            status,
            notes,
            childrenStudentIds,
            updatedBy: actorUserId(req) || null,
          },
        },
        { runValidators: true },
      );

      req.flash?.("success", "Parent updated.");
      return res.redirect("/admin/parents");
    } catch (err) {
      console.error("PARENT UPDATE ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Parent email already exists.");
      else req.flash?.("error", "Failed to update parent.");
      return res.redirect("/admin/parents");
    }
  },

  archive: async (req, res) => {
    try {
      const { Parent } = req.models;
      if (!Parent) return res.status(500).send("Tenant models missing.");

      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid parent id.");
        return res.redirect("/admin/parents");
      }

      await Parent.updateOne({ _id: id }, { $set: { status: "archived" } });
      req.flash?.("success", "Parent archived.");
      return res.redirect("/admin/parents");
    } catch (err) {
      console.error("PARENT ARCHIVE ERROR:", err);
      req.flash?.("error", "Failed to archive parent.");
      return res.redirect("/admin/parents");
    }
  },

  remove: async (req, res) => {
    try {
      const { Parent } = req.models;
      if (!Parent) return res.status(500).send("Tenant models missing.");

      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid parent id.");
        return res.redirect("/admin/parents");
      }

      await Parent.deleteOne({ _id: id });
      req.flash?.("success", "Parent deleted.");
      return res.redirect("/admin/parents");
    } catch (err) {
      console.error("PARENT DELETE ERROR:", err);
      req.flash?.("error", "Failed to delete parent.");
      return res.redirect("/admin/parents");
    }
  },

  bulkArchive: async (req, res) => {
    try {
      const { Parent } = req.models;
      if (!Parent) return res.status(500).send("Tenant models missing.");

      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isObjId(x));

      if (!ids.length) {
        req.flash?.("error", "No parents selected.");
        return res.redirect("/admin/parents");
      }

      await Parent.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
      req.flash?.("success", "Selected parents archived.");
      return res.redirect("/admin/parents");
    } catch (err) {
      console.error("PARENT BULK ARCHIVE ERROR:", err);
      req.flash?.("error", "Bulk archive failed.");
      return res.redirect("/admin/parents");
    }
  },

  resendSetupLink: async (req, res) => {
    try {
      const { Parent, User, InviteToken } = req.models || {};
      if (!Parent || !User || !InviteToken) {
        req.flash?.("error", "Tenant models missing.");
        return res.redirect("back");
      }

      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid parent id.");
        return res.redirect("back");
      }

      const parent = await Parent.findOne({ _id: id }).lean();
      if (!parent) {
        req.flash?.("error", "Parent not found.");
        return res.redirect("back");
      }

      const user = await findOrCreateParentUser({ req, ParentDoc: parent, User });
      if (!user) {
        req.flash?.("error", "Parent user not found and cannot be created (missing email).");
        return res.redirect("back");
      }

      const force = String(req.query.force || req.body.force || "") === "1";
      const hasPassword = !!user.passwordHash;

      if (!force && user.status === "active" && hasPassword) {
        req.flash?.(
          "error",
          "Parent already set a password. Use forgot password or resend with force.",
        );
        return res.redirect("back");
      }

      const roles = uniqRolesAdd(user.roles, "parent");
      const kids = new Set((user.childrenStudentIds || []).map(String));
      (parent.childrenStudentIds || []).forEach((sid) => kids.add(String(sid)));

      await User.updateOne(
        { _id: user._id, deletedAt: null },
        {
          $set: {
            roles,
            status: hasPassword ? user.status : "invited",
            childrenStudentIds: Array.from(kids),
          },
        },
      );

      if (!parent.userId) {
        await Parent.updateOne({ _id: parent._id }, { $set: { userId: user._id } }).catch(() => {});
      }

      const invite = await createSetPasswordInvite({
        req,
        InviteToken,
        userId: user._id,
        createdBy: actorUserId(req),
      });

      const appName = process.env.APP_NAME || "Classic Academy";

      await sendMail({
        to: user.email,
        subject: `${appName}: Set your password (Parent account)`,
        html: setupPasswordEmail({
          appName,
          firstName: user.firstName,
          inviteLink: invite.inviteLink,
        }),
      });

      req.flash?.("success", `Setup link sent to parent: ${user.email}`);
      return res.redirect("back");
    } catch (err) {
      console.error("RESEND PARENT SETUP ERROR:", err);
      req.flash?.("error", err.message || "Failed to resend setup link.");
      return res.redirect("back");
    }
  },

  bulkResendSetupLinks: async (req, res) => {
    try {
      const { Parent, User, InviteToken } = req.models || {};
      if (!Parent || !User || !InviteToken) {
        req.flash?.("error", "Tenant models missing.");
        return res.redirect("/admin/parents");
      }

      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isObjId(x));

      if (!ids.length) {
        req.flash?.("error", "No parents selected.");
        return res.redirect("/admin/parents");
      }

      const parents = await Parent.find({ _id: { $in: ids } }).lean();
      let sent = 0;

      for (const parent of parents) {
        try {
          const user = await findOrCreateParentUser({ req, ParentDoc: parent, User });
          if (!user || !user.email) continue;

          const roles = uniqRolesAdd(user.roles, "parent");
          const kids = new Set((user.childrenStudentIds || []).map(String));
          (parent.childrenStudentIds || []).forEach((sid) => kids.add(String(sid)));

          await User.updateOne(
            { _id: user._id, deletedAt: null },
            {
              $set: {
                roles,
                status: user.passwordHash ? user.status : "invited",
                childrenStudentIds: Array.from(kids),
              },
            },
          );

          const invite = await createSetPasswordInvite({
            req,
            InviteToken,
            userId: user._id,
            createdBy: actorUserId(req),
          });

          const appName = process.env.APP_NAME || "Classic Academy";
          await sendMail({
            to: user.email,
            subject: `${appName}: Set your password (Parent account)`,
            html: setupPasswordEmail({
              appName,
              firstName: user.firstName,
              inviteLink: invite.inviteLink,
            }),
          });

          sent += 1;
        } catch (innerErr) {
          console.error("BULK RESEND SINGLE ERROR:", innerErr);
        }
      }

      req.flash?.("success", `Setup links sent: ${sent}`);
      return res.redirect("/admin/parents");
    } catch (err) {
      console.error("BULK RESEND PARENT SETUP ERROR:", err);
      req.flash?.("error", "Bulk resend failed.");
      return res.redirect("/admin/parents");
    }
  },

  importCsv: async (req, res) => {
    try {
      const { Parent } = req.models;
      if (!Parent) return res.status(500).send("Tenant models missing.");

      if (!req.file || !req.file.buffer) {
        req.flash?.("error", "CSV file is required.");
        return res.redirect("/admin/parents");
      }

      const text = req.file.buffer.toString("utf8");
      const rows = parseCsv(text);

      if (!rows.length) {
        req.flash?.("error", "CSV file is empty.");
        return res.redirect("/admin/parents");
      }

      const updateExisting = String(req.body.updateExisting || "") === "1";
      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const row of rows) {
        const fullName = cleanStr(row.fullName, 120);
        const email = cleanEmail(row.email);
        const phone = cleanStr(row.phone, 40);
        const relationship = cleanStr(row.relationship, 60) || "Guardian";
        const status = normalizeParentStatus(row.status) || "active";
        const notes = cleanStr(row.notes, 1200);
        const childrenStudentIds = cleanChildrenIds(row.childrenStudentIds);

        if (!fullName || !email) {
          skipped += 1;
          continue;
        }

        const { firstName, lastName } = splitName(fullName);
        const exists = await Parent.findOne({ email }).lean();

        if (exists && !updateExisting) {
          skipped += 1;
          continue;
        }

        if (exists && updateExisting) {
          await Parent.updateOne(
            { _id: exists._id },
            {
              $set: {
                firstName,
                lastName,
                phone,
                relationship,
                status,
                notes,
                childrenStudentIds,
              },
            },
          );
          updated += 1;
          continue;
        }

        await Parent.create({
          userId: null,
          firstName,
          lastName,
          email,
          phone,
          relationship,
          status,
          notes,
          childrenStudentIds,
          createdBy: actorUserId(req) || null,
        });

        created += 1;
      }

      req.flash?.("success", `Import complete. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}.`);
      return res.redirect("/admin/parents");
    } catch (err) {
      console.error("PARENT IMPORT ERROR:", err);
      req.flash?.("error", err.message || "Failed to import CSV.");
      return res.redirect("/admin/parents");
    }
  },
};
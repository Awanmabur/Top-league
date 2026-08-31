const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

const { sendMail } = require("../../../utils/mailer");
const { createSetPasswordInvite } = require("../../../utils/inviteService");
const { setupPasswordEmail } = require("../../../utils/emailTemplates");
const {
  ensureSingleRoleForUser,
  singleRoleUpdate,
} = require("../../../utils/tenantUserAccounts");
const {
  normalizeParentStatus,
  validateChildren,
  syncParentIdentity,
  applyParentLifecycle,
  csvCell,
} = require("../../../services/tenant/parentLifecycleService");

/* -----------------------
   Helpers
------------------------ */
const cleanStr = (v, max = 2000) => String(v || "").trim().slice(0, max);
const cleanEmail = (v) => String(v || "").trim().toLowerCase();
const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const escapeRegExp = (v) => String(v || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

async function assertParentAccountCompatibility({ req, parentId = null, userId = null, email = "" }) {
  const { User, Parent } = req.models || {};
  const normalizedEmail = cleanEmail(email);
  if (!User || !normalizedEmail) return null;

  const existingUser = await User.findOne({ email: normalizedEmail, deletedAt: null })
    .select("_id roles")
    .lean();
  if (!existingUser) return null;
  ensureSingleRoleForUser(existingUser, "parent", normalizedEmail);

  if (userId && String(existingUser._id) !== String(userId)) {
    throw new Error(`${normalizedEmail} belongs to a different parent account.`);
  }

  if (Parent) {
    const profile = await Parent.findOne({
      userId: existingUser._id,
      isDeleted: { $ne: true },
      ...(parentId ? { _id: { $ne: parentId } } : {}),
    }).select("_id").lean();
    if (profile) throw new Error(`${normalizedEmail} is already linked to another parent profile.`);
  }
  return existingUser;
}

async function findOrCreateParentUser({ req, ParentDoc, User }) {
  const email = cleanEmail(ParentDoc?.email);
  if (!email) return null;

  if (ParentDoc?.userId && isObjId(ParentDoc.userId)) {
    const linked = await User.findOne({ _id: ParentDoc.userId, deletedAt: null }).select(
      "+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds",
    );
    if (linked) return ensureSingleRoleForUser(linked, "parent", email);
  }

  let user = await User.findOne({ email, deletedAt: null }).select(
    "+passwordHash roles status tokenVersion email firstName lastName childrenStudentIds",
  );
  if (user) return ensureSingleRoleForUser(user, "parent", email);

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
        const safeQ = new RegExp(escapeRegExp(q), "i");
        filter.$or = [
          { firstName: safeQ }, { lastName: safeQ }, { email: safeQ },
          { phone: safeQ }, { relationship: safeQ },
        ];
      }
      filter.isDeleted = { $ne: true };

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

      return res.render("tenant/parents/index", {
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
      const { Parent, User } = req.models;
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
      const childrenStudentIds = await validateChildren(req.models, cleanChildrenIds(req.body["childrenStudentIds[]"] ?? req.body.childrenStudentIds));

      const exists = await Parent.findOne({ email, isDeleted: { $ne: true } }).lean();
      if (exists) {
        req.flash?.("error", "Parent email already exists.");
        return res.redirect("/admin/parents");
      }

      if (User) {
        await assertParentAccountCompatibility({ req, email });
      }

      const parent = await Parent.create({
        userId: null, firstName, lastName, email, phone, relationship, status, notes,
        childrenStudentIds, createdBy: actorUserId(req) || null,
      });
      if (User) {
        const parentUser = await findOrCreateParentUser({ req, ParentDoc: parent, User });
        if (parentUser) {
          parent.userId = parentUser._id;
          await parent.save();
          await syncParentIdentity(req, parent, {});
          await applyParentLifecycle(req, parent, parent.status, { updatedBy: actorUserId(req) || null });
        }
      }

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
      const { Parent, User } = req.models;
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
      const childrenStudentIds = await validateChildren(req.models, cleanChildrenIds(req.body["childrenStudentIds[]"] ?? req.body.childrenStudentIds));

      const existingParent = await Parent.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!existingParent) throw new Error("Parent not found.");
      const collision = await Parent.findOne({ email, _id: { $ne: id }, isDeleted: { $ne: true } }).lean();
      if (collision) {
        req.flash?.("error", "Parent email already exists.");
        return res.redirect("/admin/parents");
      }

      if (User) {
        await assertParentAccountCompatibility({
          req,
          parentId: existingParent._id,
          userId: existingParent.userId,
          email,
        });
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

      let updatedParent = await Parent.findById(id);
      if (updatedParent) {
        if (User && !updatedParent.userId) {
          const parentUser = await findOrCreateParentUser({ req, ParentDoc: updatedParent, User });
          if (parentUser) {
            updatedParent.userId = parentUser._id;
            await updatedParent.save();
          }
        }
        updatedParent = await Parent.findById(id);
        await syncParentIdentity(req, updatedParent, existingParent);
        await applyParentLifecycle(req, updatedParent, updatedParent.status, { updatedBy: actorUserId(req) || null });
      }
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

      const parent = await Parent.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!parent) throw new Error("Parent not found.");
      await applyParentLifecycle(req, parent, "archived", { updatedBy: actorUserId(req) || null });
      req.flash?.("success", "Parent archived and portal access disabled.");
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

      const parent = await Parent.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!parent) throw new Error("Parent not found.");
      await applyParentLifecycle(req, parent, "archived", { deleting: true, updatedBy: actorUserId(req) || null });
      req.flash?.("success", "Parent deleted (soft) and portal access disabled.");
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

      const parents = await Parent.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
      for (const parent of parents) await applyParentLifecycle(req, parent, "archived", { updatedBy: actorUserId(req) || null });
      req.flash?.("success", `Selected parents archived: ${parents.length}.`);
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

      const parent = await Parent.findOne({ _id: id, isDeleted: { $ne: true }, status: { $in: ['active', 'on_hold'] } }).lean();
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

      const kids = new Set((user.childrenStudentIds || []).map(String));
      (parent.childrenStudentIds || []).forEach((sid) => kids.add(String(sid)));

      await User.updateOne(
        { _id: user._id, deletedAt: null },
        {
          $set: {
            ...singleRoleUpdate("parent"),
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

      const parents = await Parent.find({ _id: { $in: ids }, isDeleted: { $ne: true }, status: { $in: ['active', 'on_hold'] } }).lean();
      let sent = 0;

      for (const parent of parents) {
        try {
          const user = await findOrCreateParentUser({ req, ParentDoc: parent, User });
          if (!user || !user.email) continue;

          const kids = new Set((user.childrenStudentIds || []).map(String));
          (parent.childrenStudentIds || []).forEach((sid) => kids.add(String(sid)));

          await User.updateOne(
            { _id: user._id, deletedAt: null },
            {
              $set: {
                ...singleRoleUpdate("parent"),
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

  exportCsv: async (req, res) => {
    try {
      const { Parent } = req.models;
      if (!Parent) return res.status(500).send("Tenant models missing.");
      const q = cleanStr(req.query.q, 120);
      const status = cleanStr(req.query.status, 30);
      const filter = { isDeleted: { $ne: true } };
      if (q) {
        const rx = new RegExp(escapeRegExp(q), "i");
        filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }, { relationship: rx }];
      }
      if (status && normalizeParentStatus(status)) filter.status = status;
      const parents = await Parent.find(filter).sort({ firstName: 1, lastName: 1 }).lean();
      const lines = [["Full Name","Email","Phone","Relationship","Status","Children Student IDs","Notes","Created At"].map(csvCell).join(",")];
      for (const parent of parents) {
        lines.push([
          [parent.firstName,parent.lastName].filter(Boolean).join(" "), parent.email, parent.phone,
          parent.relationship, parent.status, (parent.childrenStudentIds || []).map(String).join(" | "),
          parent.notes, parent.createdAt?.toISOString?.() || parent.createdAt || "",
        ].map(csvCell).join(","));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="parents-${new Date().toISOString().slice(0,10)}.csv"`);
      return res.send(`\uFEFF${lines.join("\n")}`);
    } catch (err) {
      console.error("PARENT EXPORT ERROR:", err);
      return res.status(500).send("Failed to export parents.");
    }
  },

  importCsv: async (req, res) => {
    try {
      const { Parent, User } = req.models;
      if (!Parent) return res.status(500).send("Tenant models missing.");
      if (!req.file || !req.file.buffer) throw new Error("CSV file is required.");

      const rows = parseCsv(req.file.buffer.toString("utf8"));
      if (rows.length > 1999) throw new Error("CSV import is limited to 1,999 rows per file.");
      if (!rows.length) throw new Error("CSV file is empty.");

      const updateExisting = String(req.body.updateExisting || "") === "1";
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const rowErrors = [];

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] || {};
        try {
          const fullName = cleanStr(row.fullName, 120);
          const email = cleanEmail(row.email);
          const phone = cleanStr(row.phone, 40);
          const relationship = cleanStr(row.relationship, 60) || "Guardian";
          const status = normalizeParentStatus(row.status) || "active";
          const notes = cleanStr(row.notes, 1200);
          if (!fullName || !email) throw new Error("fullName and email are required");

          const childrenStudentIds = await validateChildren(req.models, cleanChildrenIds(row.childrenStudentIds));
          const { firstName, lastName } = splitName(fullName);
          const exists = await Parent.findOne({ email, isDeleted: { $ne: true } }).lean();

          if (exists && !updateExisting) {
            skipped += 1;
            continue;
          }

          if (User) {
            await assertParentAccountCompatibility({
              req,
              parentId: exists?._id || null,
              userId: exists?.userId || null,
              email,
            });
          }

          if (exists && updateExisting) {
            await Parent.updateOne(
              { _id: exists._id },
              {
                $set: {
                  firstName, lastName, email, phone, relationship, status, notes, childrenStudentIds,
                  updatedBy: actorUserId(req) || null,
                },
              },
              { runValidators: true },
            );
            let updatedParent = await Parent.findById(exists._id);
            if (updatedParent) {
              if (User && !updatedParent.userId) {
                const parentUser = await findOrCreateParentUser({ req, ParentDoc: updatedParent, User });
                if (parentUser) { updatedParent.userId = parentUser._id; await updatedParent.save(); }
              }
              updatedParent = await Parent.findById(exists._id);
              await syncParentIdentity(req, updatedParent, exists);
              await applyParentLifecycle(req, updatedParent, updatedParent.status, { updatedBy: actorUserId(req) || null });
            }
            updated += 1;
            continue;
          }

          const parent = await Parent.create({
            userId: null, firstName, lastName, email, phone, relationship, status, notes,
            childrenStudentIds, createdBy: actorUserId(req) || null,
          });
          if (User) {
            try {
              const parentUser = await findOrCreateParentUser({ req, ParentDoc: parent, User });
              if (parentUser) {
                parent.userId = parentUser._id;
                await parent.save();
                await syncParentIdentity(req, parent, {});
                await applyParentLifecycle(req, parent, parent.status, { updatedBy: actorUserId(req) || null });
              }
            } catch (linkErr) {
              // New CSV rows are atomic at the Parent/account boundary: do not
              // report a partially linked Parent as successfully imported.
              await Parent.deleteOne({ _id: parent._id }).catch(() => {});
              throw new Error(`account linkage failed: ${linkErr.message}`);
            }
          }
          created += 1;
        } catch (rowErr) {
          skipped += 1;
          if (rowErrors.length < 12) rowErrors.push(`Row ${index + 2}: ${rowErr.message}`);
        }
      }

      req.flash?.("success", `Import complete. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}.`);
      if (rowErrors.length) req.flash?.("error", rowErrors.join(" | "));
      return res.redirect("/admin/parents");
    } catch (err) {
      console.error("PARENT IMPORT ERROR:", err);
      req.flash?.("error", err.message || "Failed to import CSV.");
      return res.redirect("/admin/parents");
    }
  },
};

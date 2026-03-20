const crypto = require("crypto");

const { platformConnection, getTenantConnection } = require("../../config/db");
const { sendMail } = require("../../utils/mailer");
const { getTenantModulesFromPlan } = require("../../utils/tenantPlanAccess");

const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);
const loadTenantModels = require("../../models/tenant/loadModels");

const emailService = {
  async sendTenantAdminInvite({
    tenant,
    ownerName,
    ownerEmail,
    inviteUrl,
    planName,
    loginUrl,
  }) {
    const schoolName = tenant?.name || "Your School";
    const recipientName = ownerName || "Admin";

    const subject = `Set up your ${schoolName} admin account`;

    const text = [
      `Hello ${recipientName},`,
      ``,
      `Your school account for ${schoolName} has been created on Classic Campus.`,
      `Assigned plan: ${planName || "Assigned Plan"}`,
      ``,
      `Set your password using this secure link:`,
      `${inviteUrl}`,
      ``,
      `Login URL: ${loginUrl}`,
      `This setup link expires in 24 hours.`,
      ``,
      `If you did not expect this email, please contact support.`,
      ``,
      `Classic Campus Team`,
    ].join("\n");

    const html = `
      <div style="margin:0;padding:24px;background:#f5f8ff;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e4ecfb;border-radius:14px;overflow:hidden;">
          <div style="padding:20px 24px;background:#0a3d62;color:#ffffff;">
            <h2 style="margin:0;font-size:20px;line-height:1.3;">Set up your admin account</h2>
            <p style="margin:8px 0 0;font-size:13px;opacity:.9;">Classic Campus school onboarding</p>
          </div>

          <div style="padding:24px;">
            <p style="margin:0 0 14px;">Hello <strong>${recipientName}</strong>,</p>

            <p style="margin:0 0 14px;line-height:1.7;">
              Your school account for <strong>${schoolName}</strong> has been created on Classic Campus.
            </p>

            <div style="margin:0 0 16px;padding:14px;border:1px solid #dbe7ff;border-radius:12px;background:#f8fbff;">
              <div style="font-size:12px;color:#64748b;margin-bottom:6px;">Assigned Plan</div>
              <div style="font-size:14px;font-weight:700;color:#0f172a;">${planName || "Assigned Plan"}</div>
            </div>

            <p style="margin:0 0 14px;line-height:1.7;">
              Click the button below to create your password and activate your admin access.
            </p>

            <div style="margin:22px 0;">
              <a href="${inviteUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#0a3d62;color:#ffffff;text-decoration:none;font-weight:700;">
                Set Password
              </a>
            </div>

            <p style="margin:0 0 8px;font-size:13px;color:#475569;">Or open this link manually:</p>
            <p style="margin:0 0 16px;word-break:break-all;font-size:13px;color:#0a3d62;">
              <a href="${inviteUrl}" style="color:#0a3d62;">${inviteUrl}</a>
            </p>

            <div style="margin:0 0 16px;padding:14px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;">
              <div style="font-size:12px;color:#64748b;margin-bottom:6px;">Login URL</div>
              <div style="font-size:13px;font-weight:600;color:#0f172a;">${loginUrl}</div>
            </div>

            <p style="margin:0 0 10px;line-height:1.7;color:#475569;">
              This setup link expires in <strong>24 hours</strong>. If it expires, your platform administrator can resend the invitation.
            </p>

            <p style="margin:18px 0 0;line-height:1.7;">
              Regards,<br />
              <strong>Classic Campus Team</strong>
            </p>
          </div>
        </div>
      </div>
    `;

    return sendMail({
      to: ownerEmail,
      subject,
      html,
      text,
    });
  },
};

function safeTrim(v) {
  return String(v || "").trim();
}

function safeLower(v) {
  return String(v || "").trim().toLowerCase();
}

function isTruthy(v) {
  return v === true || v === "true" || v === "on" || v === "1";
}

function splitName(fullName) {
  const clean = safeTrim(fullName);
  const parts = clean.split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] || "Admin",
    lastName: parts.slice(1).join(" ") || "User",
  };
}

function buildLoginUrl(tenant) {
  const host = tenant.customDomain || tenant.subdomain;
  return `https://${host}/login`;
}

function buildSetPasswordUrl(tenant, rawToken) {
  const host = tenant.customDomain || tenant.subdomain;
  return `https://${host}/set-password?token=${encodeURIComponent(rawToken)}`;
}

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action: payload.action,
      entityType: payload.entityType || "Tenant",
      entityId: payload.entityId ? String(payload.entityId) : "",
      tenantId: payload.tenantId || null,
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("❌ tenant audit log failed:", err);
  }
}

async function createSetPasswordInvite({ InviteToken, userId, email, createdBy }) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await InviteToken.updateMany(
    {
      userId,
      purpose: "set_password",
      usedAt: null,
      revokedAt: null,
    },
    {
      $set: { revokedAt: new Date() },
    }
  );

  await InviteToken.create({
    userId,
    email,
    purpose: "set_password",
    tokenHash,
    expiresAt,
    createdBy: createdBy || null,
  });

  return { rawToken, expiresAt };
}

async function findTenantAdminUser(User, tenant) {
  return User.findOne({
    email: String(tenant.ownerEmail || "").trim().toLowerCase(),
    deletedAt: null,
  });
}

async function resendTenantAdminInvite({ tenant, req }) {
  const tenantConn = await getTenantConnection(tenant.dbName);
  const models = loadTenantModels(tenantConn);

  const User = models.User;
  const InviteToken = models.InviteToken;

  if (!User || !InviteToken) {
    throw new Error("Tenant invite models are not available.");
  }

  const adminUser = await findTenantAdminUser(User, tenant);

  if (!adminUser) {
    throw new Error("Tenant admin user not found.");
  }

  const { rawToken } = await createSetPasswordInvite({
    InviteToken,
    userId: adminUser._id,
    email: tenant.ownerEmail,
    createdBy: req.user?._id || null,
  });

  const plan = tenant.planId?.name
    ? tenant.planId
    : await Plan.findById(tenant.planId).lean();

  const inviteUrl = buildSetPasswordUrl(tenant, rawToken);
  const loginUrl = buildLoginUrl(tenant);

  await emailService.sendTenantAdminInvite({
    tenant,
    ownerName: tenant.ownerName,
    ownerEmail: tenant.ownerEmail,
    inviteUrl,
    planName: plan?.name || "Assigned Plan",
    loginUrl,
  });

  return { adminUser, inviteUrl, loginUrl };
}

module.exports = {
  listTenants: async (req, res) => {
    try {
      const { q = "", status = "", plan = "" } = req.query;

      const filter = {
        isDeleted: { $ne: true },
      };

      if (status) filter.status = safeLower(status);
      if (plan) filter.planId = plan;
      if (safeTrim(q)) filter.$text = { $search: safeTrim(q) };

      const tenants = await Tenant.find(filter)
        .populate("planId")
        .sort(q ? { score: { $meta: "textScore" } } : { createdAt: -1 })
        .lean();

      const plans = await Plan.find({
        isDeleted: { $ne: true },
        isActive: true,
      })
        .sort({ sortOrder: 1, name: 1 })
        .lean();

      return res.render("platform/tenants/index", {
        tenants,
        plans,
        filters: { q, status, plan },
        error: null,
      });
    } catch (err) {
      console.error("❌ listTenants error:", err);
      return res.status(500).render("platform/tenants/index", {
        tenants: [],
        plans: [],
        filters: { q: "", status: "", plan: "" },
        error: "Failed to load universities.",
      });
    }
  },

  createTenantForm: async (req, res) => {
    try {
      const plans = await Plan.find({
        isActive: true,
        isDeleted: { $ne: true },
      })
        .sort({ sortOrder: 1, name: 1 })
        .lean();

      return res.render("platform/tenants/create", {
        plans,
        old: {},
        error: null,
      });
    } catch (err) {
      console.error("❌ createTenantForm error:", err);
      return res.status(500).render("platform/tenants/create", {
        plans: [],
        old: {},
        error: "Failed to load create university form.",
      });
    }
  },

  createTenant: async (req, res) => {
    let createdTenant = null;

    try {
      const {
        name,
        code,
        ownerName,
        ownerEmail,
        ownerPhone,
        country,
        timezone,
        currency,
        planId,
        status,
        customDomain,
        trialEndsAt,
      } = req.body;

      const cleanName = safeTrim(name);
      const cleanCode = safeLower(code);
      const cleanOwnerName = safeTrim(ownerName);
      const cleanOwnerEmail = safeLower(ownerEmail);
      const cleanOwnerPhone = safeTrim(ownerPhone);
      const cleanCountry = safeTrim(country);
      const cleanTimezone = safeTrim(timezone) || "Africa/Kampala";
      const cleanCurrency = safeTrim(currency || "USD").toUpperCase();
      const cleanStatus = safeLower(status || "trial");
      const cleanCustomDomain = safeLower(customDomain);

      if (!cleanName || !cleanCode || !cleanOwnerName || !cleanOwnerEmail || !planId) {
        const plans = await Plan.find({
          isActive: true,
          isDeleted: { $ne: true },
        }).lean();

        return res.status(400).render("platform/tenants/create", {
          plans,
          old: req.body,
          error: "Name, code, owner name, owner email and plan are required.",
        });
      }

      const duplicate = await Tenant.findOne({
        $or: [
          { code: cleanCode },
          { subdomain: cleanCode },
          { ownerEmail: cleanOwnerEmail },
          { dbName: `uni_${cleanCode}` },
          ...(cleanCustomDomain ? [{ customDomain: cleanCustomDomain }] : []),
        ],
        isDeleted: { $ne: true },
      }).lean();

      if (duplicate) {
        const plans = await Plan.find({
          isActive: true,
          isDeleted: { $ne: true },
        }).lean();

        return res.status(400).render("platform/tenants/create", {
          plans,
          old: req.body,
          error: "Tenant code, owner email, db name, or custom domain already exists.",
        });
      }

      const plan = await Plan.findOne({
        _id: planId,
        isActive: true,
        isDeleted: { $ne: true },
      }).lean();

      if (!plan) {
        const plans = await Plan.find({
          isActive: true,
          isDeleted: { $ne: true },
        }).lean();

        return res.status(400).render("platform/tenants/create", {
          plans,
          old: req.body,
          error: "Selected plan is invalid or inactive.",
        });
      }

      const baseDomain = safeLower(process.env.BASE_DOMAIN || "");
      const subdomain = baseDomain ? `${cleanCode}.${baseDomain}` : cleanCode;
      const dbName = `uni_${cleanCode}`;

      createdTenant = await Tenant.create({
        name: cleanName,
        code: cleanCode,
        subdomain,
        dbName,
        customDomain: cleanCustomDomain || undefined,
        planId: plan._id,
        status: ["trial", "active", "suspended", "cancelled"].includes(cleanStatus)
          ? cleanStatus
          : "trial",
        ownerName: cleanOwnerName,
        ownerEmail: cleanOwnerEmail,
        ownerPhone: cleanOwnerPhone || undefined,
        country: cleanCountry || undefined,
        timezone: cleanTimezone,
        currency: cleanCurrency,
        trialEndsAt: trialEndsAt || undefined,
        settings: {
          branding: {
            primaryColor: "#0a3d62",
            accentColor: "#0a6fbf",
          },
          profile: {
            enabled: true,
            verified: false,
          },
          modules: getTenantModulesFromPlan(plan),
        },
        meta: {
          onboardingCompleted: false,
          provisioningVersion: 2,
          invitePending: true,
        },
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });

      const tenantConn = await getTenantConnection(dbName);
      const models = loadTenantModels(tenantConn);

      const User = models.User;
      const InviteToken = models.InviteToken;

      const { firstName, lastName } = splitName(cleanOwnerName);

      const adminUser = await User.create({
        firstName,
        lastName,
        email: cleanOwnerEmail,
        roles: ["admin"],
        status: "invited",
        passwordHash: null,
        tokenVersion: 0,
      });

      const { rawToken } = await createSetPasswordInvite({
        InviteToken,
        userId: adminUser._id,
        email: cleanOwnerEmail,
        createdBy: req.user?._id || null,
      });

      const inviteUrl = buildSetPasswordUrl(createdTenant, rawToken);
      const loginUrl = buildLoginUrl(createdTenant);

      await emailService.sendTenantAdminInvite({
        tenant: createdTenant,
        ownerName: cleanOwnerName,
        ownerEmail: cleanOwnerEmail,
        inviteUrl,
        planName: plan.name,
        loginUrl,
      });

      await writeAudit(req, {
        action: "Create Tenant",
        entityId: createdTenant._id,
        tenantId: createdTenant._id,
        description: `Created tenant ${createdTenant.name} (${createdTenant.code}) and sent admin invite`,
        meta: {
          tenantCode: createdTenant.code,
          ownerEmail: createdTenant.ownerEmail,
          planId: String(createdTenant.planId || ""),
          modules: getTenantModulesFromPlan(plan),
        },
      });

      return res.render("platform/tenants/success", {
        tenant: createdTenant.toObject ? createdTenant.toObject() : createdTenant,
        inviteSent: true,
        invitedEmail: cleanOwnerEmail,
        loginUrl,
        error: null,
      });
    } catch (err) {
      console.error("❌ createTenant error:", err);

      if (createdTenant?._id) {
        try {
          await Tenant.deleteOne({ _id: createdTenant._id });
        } catch (rollbackErr) {
          console.error("❌ createTenant rollback error:", rollbackErr);
        }
      }

      const plans = await Plan.find({
        isActive: true,
        isDeleted: { $ne: true },
      }).lean();

      return res.status(500).render("platform/tenants/create", {
        plans,
        old: req.body,
        error: err?.message || "Failed to create tenant and send admin invite.",
      });
    }
  },

  showTenant: async (req, res) => {
    try {
      const tenant = await Tenant.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      })
        .populate("planId")
        .lean();

      if (!tenant) {
        return res.status(404).render("platform/tenants/show", {
          tenant: null,
          error: "University not found.",
          inviteResent: false,
        });
      }

      return res.render("platform/tenants/show", {
        tenant,
        error: null,
        inviteResent: req.query.inviteResent === "1",
      });
    } catch (err) {
      console.error("❌ showTenant error:", err);
      return res.status(500).render("platform/tenants/show", {
        tenant: null,
        error: "Failed to load university details.",
        inviteResent: false,
      });
    }
  },

  editTenantForm: async (req, res) => {
    try {
      const [tenant, plans] = await Promise.all([
        Tenant.findOne({
          _id: req.params.id,
          isDeleted: { $ne: true },
        }).lean(),
        Plan.find({
          isActive: true,
          isDeleted: { $ne: true },
        })
          .sort({ sortOrder: 1, name: 1 })
          .lean(),
      ]);

      if (!tenant) {
        return res.status(404).render("platform/tenants/edit", {
          tenant: null,
          plans,
          error: "University not found.",
        });
      }

      return res.render("platform/tenants/edit", {
        tenant,
        plans,
        error: null,
      });
    } catch (err) {
      console.error("❌ editTenantForm error:", err);
      return res.status(500).render("platform/tenants/edit", {
        tenant: null,
        plans: [],
        error: "Failed to load edit university form.",
      });
    }
  },

  updateTenant: async (req, res) => {
    try {
      const tenant = await Tenant.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      });

      if (!tenant) {
        return res.status(404).send("University not found.");
      }

      const {
        name,
        ownerName,
        ownerEmail,
        ownerPhone,
        country,
        timezone,
        currency,
        planId,
        status,
        customDomain,
        profileEnabled,
        profileVerified,
      } = req.body;

      const cleanName = safeTrim(name);
      const cleanOwnerName = safeTrim(ownerName);
      const cleanOwnerEmail = safeLower(ownerEmail);
      const cleanStatus = safeLower(status || tenant.status);
      const cleanCustomDomain = safeLower(customDomain);

      if (!cleanName || !cleanOwnerName || !cleanOwnerEmail || !planId) {
        const plans = await Plan.find({
          isActive: true,
          isDeleted: { $ne: true },
        }).lean();

        return res.status(400).render("platform/tenants/edit", {
          tenant: { ...tenant.toObject(), ...req.body },
          plans,
          error: "Name, owner name, owner email and plan are required.",
        });
      }

      const duplicate = await Tenant.findOne({
        _id: { $ne: tenant._id },
        $or: [
          { ownerEmail: cleanOwnerEmail },
          ...(cleanCustomDomain ? [{ customDomain: cleanCustomDomain }] : []),
        ],
        isDeleted: { $ne: true },
      }).lean();

      if (duplicate) {
        const plans = await Plan.find({
          isActive: true,
          isDeleted: { $ne: true },
        }).lean();

        return res.status(400).render("platform/tenants/edit", {
          tenant: { ...tenant.toObject(), ...req.body },
          plans,
          error: "Owner email or custom domain is already used by another university.",
        });
      }

      const plan = await Plan.findOne({
        _id: planId,
        isActive: true,
        isDeleted: { $ne: true },
      }).lean();

      if (!plan) {
        const plans = await Plan.find({
          isActive: true,
          isDeleted: { $ne: true },
        }).lean();

        return res.status(400).render("platform/tenants/edit", {
          tenant: { ...tenant.toObject(), ...req.body },
          plans,
          error: "Selected plan is invalid or inactive.",
        });
      }

      tenant.name = cleanName;
      tenant.ownerName = cleanOwnerName;
      tenant.ownerEmail = cleanOwnerEmail;
      tenant.ownerPhone = safeTrim(ownerPhone) || undefined;
      tenant.country = safeTrim(country) || undefined;
      tenant.timezone = safeTrim(timezone) || "Africa/Kampala";
      tenant.currency = safeTrim(currency || tenant.currency || "USD").toUpperCase();
      tenant.customDomain = cleanCustomDomain || undefined;
      tenant.planId = plan._id;
      tenant.status = ["trial", "active", "suspended", "cancelled"].includes(cleanStatus)
        ? cleanStatus
        : tenant.status;

      tenant.settings = tenant.settings || {};
      tenant.settings.profile = tenant.settings.profile || {};
      tenant.settings.profile.enabled = isTruthy(profileEnabled);
      tenant.settings.profile.verified = isTruthy(profileVerified);
      tenant.settings.modules = getTenantModulesFromPlan(plan);

      tenant.updatedBy = req.user?._id || null;

      await tenant.save();

      await writeAudit(req, {
        action: "Update Tenant",
        entityId: tenant._id,
        tenantId: tenant._id,
        description: `Updated tenant ${tenant.name}`,
        meta: {
          planId: String(tenant.planId || ""),
          status: tenant.status,
          modules: tenant.settings.modules,
        },
      });

      return res.redirect(`/super-admin/universities/${tenant._id}`);
    } catch (err) {
      console.error("❌ updateTenant error:", err);
      const plans = await Plan.find({
        isActive: true,
        isDeleted: { $ne: true },
      }).lean();

      return res.status(500).render("platform/tenants/edit", {
        tenant: req.body,
        plans,
        error: err?.message || "Failed to update university.",
      });
    }
  },

  updateTenantStatus: async (req, res) => {
    try {
      const tenant = await Tenant.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      });

      if (!tenant) {
        return res.status(404).send("University not found.");
      }

      const nextStatus = safeLower(req.body.status);

      if (!["trial", "active", "suspended", "cancelled"].includes(nextStatus)) {
        return res.status(400).send("Invalid tenant status.");
      }

      tenant.status = nextStatus;
      tenant.updatedBy = req.user?._id || null;
      await tenant.save();

      await writeAudit(req, {
        action: "Update Tenant Status",
        entityId: tenant._id,
        tenantId: tenant._id,
        description: `Changed ${tenant.name} status to ${tenant.status}`,
        meta: { status: tenant.status },
      });

      return res.redirect(`/super-admin/universities/${tenant._id}`);
    } catch (err) {
      console.error("❌ updateTenantStatus error:", err);
      return res.status(500).send("Failed to update tenant status.");
    }
  },

  resendTenantInvite: async (req, res) => {
    try {
      const tenant = await Tenant.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      }).populate("planId");

      if (!tenant) {
        return res.status(404).send("University not found.");
      }

      const result = await resendTenantAdminInvite({ tenant, req });

      tenant.meta = tenant.meta || {};
      tenant.meta.invitePending = true;
      tenant.updatedBy = req.user?._id || null;
      await tenant.save();

      await writeAudit(req, {
        action: "Resend Tenant Invite",
        entityId: tenant._id,
        tenantId: tenant._id,
        description: `Resent tenant admin invite for ${tenant.name}`,
        meta: {
          ownerEmail: tenant.ownerEmail,
          adminUserId: String(result.adminUser._id || ""),
        },
      });

      return res.redirect(`/super-admin/universities/${tenant._id}?inviteResent=1`);
    } catch (err) {
      console.error("❌ resendTenantInvite error:", err);
      return res.status(500).send(err?.message || "Failed to resend invite.");
    }
  },

  deleteTenant: async (req, res) => {
    try {
      const tenant = await Tenant.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      });

      if (!tenant) {
        return res.status(404).send("University not found.");
      }

      tenant.isDeleted = true;
      tenant.status = "deleted";
      tenant.archivedAt = new Date();
      tenant.updatedBy = req.user?._id || null;

      await tenant.save();

      await writeAudit(req, {
        action: "Delete Tenant",
        entityId: tenant._id,
        tenantId: tenant._id,
        description: `Soft deleted tenant ${tenant.name}`,
      });

      return res.redirect("/super-admin/universities");
    } catch (err) {
      console.error("❌ deleteTenant error:", err);
      return res.status(500).send("Failed to delete university.");
    }
  },
};
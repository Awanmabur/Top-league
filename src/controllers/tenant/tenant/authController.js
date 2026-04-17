const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

function safeLower(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

// Decide if we should set cookie domain (production only).
function shouldSetDomain(hostname, baseDomain) {
  if (!hostname || !baseDomain) return false;

  const h = safeLower(hostname);
  const b = safeLower(baseDomain);

  if (h === "localhost" || h.endsWith(".localhost")) return false;
  return h === b || h.endsWith("." + b);
}

function getProto(req) {
  return (req.get("x-forwarded-proto") || req.protocol || "http")
    .split(",")[0]
    .trim()
    .toLowerCase();
}

/**
 * cookieOptions + clearTenantCookies helper
 * Must match set + clear exactly (domain/path/secure/samesite)
 */
function cookieOptions(req) {
  const baseDomain = process.env.BASE_DOMAIN;
  const hostname = req.hostname;

  const isProd = process.env.NODE_ENV === "production";
  const proto = getProto(req);

  const opts = {
    httpOnly: true,
    secure: isProd, // keep your original behavior
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };

  if (isProd && shouldSetDomain(hostname, baseDomain)) {
    opts.domain = "." + safeLower(baseDomain);
  }

  return { opts, debug: { isProd, proto, hostname, baseDomain } };
}

function setTenantTokenCookie(req, res, tenantCode, token) {
  const { opts } = cookieOptions(req);
  res.cookie(`tenant_token.${tenantCode}`, token, opts);
}

/**
 * clear helper uses SAME cookieOptions
 */
function clearTenantTokenCookies(req, res, tenantCode) {
  const { opts } = cookieOptions(req);

  // clear fallback (older cookie name)
  res.clearCookie("tenant_token", opts);

  // clear tenant-scoped cookie
  if (tenantCode) res.clearCookie(`tenant_token.${tenantCode}`, opts);
}

function flashLocals(req) {
  return {
    success: req.flash?.("success") || [],
    error: req.flash?.("error") || [],
    warning: req.flash?.("warning") || [],
    info: req.flash?.("info") || [],
  };
}

function renderLogin(req, res, statusCode = 200, locals = {}) {
  return res.status(statusCode).render("tenant/auth/login", {
    tenant: req.tenant || null,
    user: req.user || null,
    tenantAccess: req.tenantAccess || null,
    currentPath: req.path || "",
    originalUrl: req.originalUrl || req.url || "",
    csrfToken: res.locals.csrfToken || "",
    flash: flashLocals(req),
    error: null,
    ...locals,
  });
}

module.exports = {
  loginPage(req, res) {
    return renderLogin(req, res);
  },

  async login(req, res) {
    const emailIn = safeLower(req.body?.email);
    const tenantCode = safeLower(req.tenant?.code);

    try {
      // approve flashes -> treat as success
      const approveMsgs = [
        ...(req.flash?.("approve") || []),
        ...(req.flash?.("approved") || []),
      ];
      approveMsgs.forEach((m) => req.flash?.("success", m));

      if (!req.tenant?.code) {
        req.flash?.("error", "Tenant not detected");
        return renderLogin(req, res, 400, { error: "Tenant not detected" });
      }

      if (!req.models?.User) {
        req.flash?.("error", "Tenant models not loaded");
        return renderLogin(req, res, 500, { error: "Tenant models not loaded" });
      }

      if (!process.env.JWT_SECRET) {
        req.flash?.("error", "Server misconfigured (JWT_SECRET missing)");
        return renderLogin(req, res, 500, {
          error: "Server misconfigured (JWT_SECRET missing)",
        });
      }

      if (req.tenantConnection && req.tenantConnection.readyState !== 1) {
        req.flash?.("warning", "Tenant DB not ready. Retry.");
        return renderLogin(req, res, 503, {
          error: "Tenant DB not ready. Retry.",
        });
      }

      const { User } = req.models;

      const password = String(req.body?.password || "");
      if (!emailIn || !password) {
        req.flash?.("error", "Email and password are required");
        return renderLogin(req, res, 400, {
          error: "Email and password are required",
        });
      }

      const user = await User.findOne({ email: emailIn, deletedAt: null })
        .select("+passwordHash roles status deletedAt tokenVersion lastLoginAt")
        .lean();

      if (!user) {
        req.flash?.("error", "Invalid credentials");
        return renderLogin(req, res, 401, { error: "Invalid credentials" });
      }

      if (user.status !== "active") {
        req.flash?.("error", "Account inactive");
        return renderLogin(req, res, 403, { error: "Account inactive" });
      }

      if (!user.passwordHash) {
        req.flash?.("error", "Password not set for this account");
        return renderLogin(req, res, 403, {
          error: "Password not set for this account",
        });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        req.flash?.("error", "Invalid credentials");
        return renderLogin(req, res, 401, { error: "Invalid credentials" });
      }

      // clear previous cookies (with SAME cookie options)
      clearTenantTokenCookies(req, res, tenantCode);

      const roles = Array.isArray(user.roles) ? user.roles : [];

      const token = jwt.sign(
        {
          userId: String(user._id),
          tenantCode,
          roles,
          tokenVersion: Number(user.tokenVersion || 0),
        },
        process.env.JWT_SECRET,
        {
          algorithm: "HS256",
          expiresIn: "7d",
          issuer: "classic-academy",
          audience: "tenant",
        },
      );

      setTenantTokenCookie(req, res, tenantCode, token);

      // update lastLoginAt (non-blocking; no logs)
      User.updateOne(
        { _id: user._id },
        { $set: { lastLoginAt: new Date() } },
      ).catch(() => {});

      // redirects
      let redirectTo = "/";
      if (roles.includes("admin")) redirectTo = "/admin/dashboard";
      else if (roles.includes("parent")) redirectTo = "/parent/dashboard";
      else if (roles.includes("staff") || roles.includes("registrar")) redirectTo = "/staff/dashboard";
      else if (roles.includes("finance")) redirectTo = "/finance/dashboard";
      else if (roles.includes("librarian")) redirectTo = "/library/dashboard";
      else if (roles.includes("hostel")) redirectTo = "/hostel/dashboard";
      else if (roles.includes("student")) redirectTo = "/student/dashboard";
      

      // optional success flash (keeps your logic; remove if you don't want it)
      req.flash?.("success", "Welcome back!");
      return res.redirect(redirectTo);
    } catch (err) {
      req.flash?.("error", err?.message || "Login failed");
      return renderLogin(req, res, 500, { error: err?.message || "Login failed" });
    }
  },

  async logout(req, res) {
    const tenantCode = req.tenant?.code ? safeLower(req.tenant.code) : null;

    try {
      if (tenantCode && req.models?.User) {
        const token =
          req.cookies?.[`tenant_token.${tenantCode}`] ||
          req.cookies?.tenant_token ||
          null;

        if (token && process.env.JWT_SECRET) {
          const payload = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"],
          });

          if (
            payload?.tenantCode &&
            safeLower(payload.tenantCode) === tenantCode &&
            payload.userId
          ) {
            await req.models.User.updateOne(
              { _id: payload.userId, deletedAt: null },
              { $inc: { tokenVersion: 1 } },
            );
          }
        }
      }
    } catch {
      // ignore
    }

    // clear with SAME options
    clearTenantTokenCookies(req, res, tenantCode);

    req.flash?.("success", "You have been logged out.");
    return res.redirect("/login");
  },
};

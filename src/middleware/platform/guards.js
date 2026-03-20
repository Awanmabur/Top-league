module.exports.platformOnly = (req, res, next) => {
  if (!req.session?.platformUser) return res.redirect("/platform/login");
  next();
};

module.exports.platformAdminOnly = (req, res, next) => {
  const roles = Array.isArray(req.session?.platformUser?.roles)
    ? req.session.platformUser.roles
    : [];
  if (!roles.includes("admin")) return res.status(403).send("Forbidden");
  next();
};

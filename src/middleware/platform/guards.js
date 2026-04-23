module.exports.platformOnly = (req, res, next) => {
  if (!req.session?.platformUserId) return res.redirect("/super-admin/login");
  const user = {
    _id: req.session.platformUserId,
    id: req.session.platformUserId,
    role: req.session.platformRole,
    email: req.session.platformEmail,
    name: req.session.platformName,
  };
  req.user = user;
  res.locals.platformUser = user;
  next();
};

module.exports.platformAdminOnly = (req, res, next) => {
  if (!req.session?.platformUserId) return res.redirect("/super-admin/login");
  if (!["SuperAdmin", "Operations"].includes(req.session.platformRole)) {
    return res.status(403).send("Forbidden");
  }
  const user = {
    _id: req.session.platformUserId,
    id: req.session.platformUserId,
    role: req.session.platformRole,
    email: req.session.platformEmail,
    name: req.session.platformName,
  };
  req.user = user;
  res.locals.platformUser = user;
  next();
};
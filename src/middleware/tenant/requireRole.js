module.exports = function requireRole(allowed = []) {
  return (req, res, next) => {
    const user = req.user;
    const roles = [].concat(user?.role || [], user?.roles || []);
    const ok = allowed.some(r => roles.includes(r));
    if (!ok) return res.status(403).render("errors/403", { message: "Forbidden" });
    next();
  };
};

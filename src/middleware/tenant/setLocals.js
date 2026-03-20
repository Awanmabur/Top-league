module.exports = function setLocals(req, res, next) {
  // always available in ejs
  res.locals.tenant = req.tenant || null;

  // csrf (safe)
  res.locals.csrfToken = (typeof req.csrfToken === "function") ? req.csrfToken() : "";

  // current user (safe)
  res.locals.user = req.user || null;

  next();
};

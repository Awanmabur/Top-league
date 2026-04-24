const csrf = require("csurf");
const { isProduction } = require("../../config/runtime");

const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
  },
});

// Only sets token when csurf has attached req.csrfToken
function attachCsrfToken(req, res, next) {
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : null;
  next();
}

module.exports = { csrfProtection, attachCsrfToken };

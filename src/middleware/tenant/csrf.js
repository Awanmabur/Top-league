const csrf = require("csurf");

const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
});

// Only sets token when csurf has attached req.csrfToken
function attachCsrfToken(req, res, next) {
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : null;
  next();
}

module.exports = { csrfProtection, attachCsrfToken };

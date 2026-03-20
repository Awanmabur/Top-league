const jwt = require('jsonwebtoken');

module.exports = function platformAuth(req, res, next) {
  try {
    const token = req.cookies.platform_token;

    if (!token) {
      return res.redirect('/platform/login');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.platformUser = decoded;

    next();
  } catch (err) {
    return res.redirect('/platform/login');
  }
};
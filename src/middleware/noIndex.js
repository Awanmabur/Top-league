"use strict";

// Keep authentication, application-status and other utility surfaces out of
// search indexes without blocking crawlers from seeing the noindex directive.
module.exports = function noIndex(req, res, next) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  next();
};

module.exports = function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const status = err.code === "EBADCSRFTOKEN" ? 403 : err.status || 500;
  const message =
    err.code === "EBADCSRFTOKEN"
      ? "Your session security token expired. Refresh the page and try again."
      : status >= 500
        ? "Server error"
        : err.message || "Request failed";

  if (status >= 500) {
    console.error(err);
  } else if (process.env.DEBUG_ERRORS === "1") {
    console.warn(err.message || err);
  }

  if (req.path.startsWith("/platform") || req.path.startsWith("/super-admin")) {
    return res.status(status).send(message);
  }

  return res.status(status).send(message);
};

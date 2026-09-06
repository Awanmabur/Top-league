module.exports = function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const uploadTooLarge = ["LIMIT_FILE_SIZE", "LIMIT_TOTAL_FILE_SIZE", "LIMIT_PART_COUNT", "LIMIT_FILE_COUNT", "LIMIT_FIELD_COUNT"].includes(err.code);
  const malformedRequest = ["entity.parse.failed", "parameters.too.many"].includes(err.type);
  const status = err.code === "EBADCSRFTOKEN"
    ? 403
    : uploadTooLarge
      ? 413
      : malformedRequest
        ? 400
        : err.status || err.statusCode || 500;
  const message =
    err.code === "EBADCSRFTOKEN"
      ? "Your session security token expired. Refresh the page and try again."
      : uploadTooLarge
        ? "The upload is too large or contains too many parts."
        : status >= 500
          ? "Server error"
          : err.message || "Request failed";

  if (status >= 500) {
    console.error(err);
  } else if (process.env.DEBUG_ERRORS === "1") {
    console.warn(err.message || err);
  }

  const view =
    status === 404
      ? "platform/public/404"
      : status >= 500
        ? "platform/public/500"
        : "";

  if (view) {
    return res.status(status).render(view, { message }, (renderErr, html) => {
      if (renderErr) return res.status(status).send(message);
      return res.send(html);
    });
  }

  return res.status(status).send(message);
};

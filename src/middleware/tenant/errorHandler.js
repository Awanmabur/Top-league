// src/middleware/errorHandler.js
module.exports = function errorHandler(err, req, res, next) {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || 500;

  if (req.path.startsWith('/platform')) {
    return res.status(status).render('platform/error', { error: err });
  }

  return res.status(status).send(err.message || 'Server error');
};

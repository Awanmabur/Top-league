const mongoose = require("mongoose");

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

async function getUser(req) {
  const id = req.session?.tenantUser?.id;
  const { User } = req.models || {};
  if (!id || !User) return null;
  return User.findOne({ _id: id, deletedAt: null }).lean();
}

async function getLecturer(req) {
  const user = await getUser(req);
  const { Staff } = req.models || {};
  if (!user || !Staff) return { user, lecturer: null };

  // Lecturer profile lives in Staff with role="lecturer"
  const lecturer = await Staff.findOne({
    $or: [{ userId: user._id }, { email: user.email }],
    role: "lecturer"
  }).lean();

  return { user, lecturer };
}

function renderError(res, view, data, message) {
  return res.status(400).render(view, { ...data, error: message });
}

module.exports = { isValidId, getUser, getLecturer, renderError };

const mongoose = require("mongoose");

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

async function getUser(req) {
  const id = req.user?.userId || req.user?.id || req.user?._id;
  const { User } = req.models || {};
  if (!id || !User) return null;
  return User.findOne({ _id: id, deletedAt: null }).lean();
}

async function getStaffProfile(req) {
  const user = await getUser(req);
  const { Staff } = req.models || {};
  if (!user || !Staff) return { user, staff: null };

  // Staff profile lives in Staff collection; match by userId (preferred) or email fallback
  const staff = await Staff.findOne({
    $or: [{ userId: user._id }, { email: user.email }]
  }).lean();

  return { user, staff };
}

function renderError(res, view, data, message) {
  return res.status(400).render(view, { ...data, error: message });
}

module.exports = { isValidId, getUser, getStaffProfile, renderError };

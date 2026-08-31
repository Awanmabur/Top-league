const mongoose = require('mongoose');
const { getStaffProfile, renderError } = require('./_helpers');
const {
  LEAVE_TYPES,
  createLeave,
  cancelLeave,
  refreshStaffLeaveStatus,
  todayForTimezone,
  dateOnly,
} = require('../../../services/tenant/leaveService');

const actorUserId = (req) => req.user?.userId || req.user?.id || req.user?._id || req.session?.tenantUser?.id || null;
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

function serialize(item, timezone) {
  const today = todayForTimezone(timezone || 'UTC');
  const start = dateOnly(item.startDate);
  return {
    ...item,
    startLabel: item.startDate ? new Date(item.startDate).toDateString() : '-',
    endLabel: item.endDate ? new Date(item.endDate).toDateString() : '-',
    canCancel: item.status === 'Pending' || (item.status === 'Approved' && start && start > today),
  };
}

module.exports = {
  async list(req, res) {
    try {
      const { LeaveRequest } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect('/login');
      if (staff && LeaveRequest) await refreshStaffLeaveStatus(req.models, staff._id, { timezone: req.tenant?.timezone || 'UTC' }).catch(() => null);
      const rows = staff && LeaveRequest
        ? await LeaveRequest.find({ staffId: staff._id, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean().catch(() => [])
        : [];
      return res.render('staff/leave', {
        tenant: req.tenant,
        user,
        staff,
        csrfToken: req.csrfToken?.(),
        pageTitle: 'Leave',
        mode: 'list',
        items: rows.map((row) => serialize(row, req.tenant?.timezone)),
        leaveTypes: LEAVE_TYPES,
        error: null,
      });
    } catch (err) {
      console.error('STAFF LEAVE LIST ERROR:', err);
      return res.status(500).send('Failed to load leave requests');
    }
  },

  async newForm(req, res) {
    const { user, staff } = await getStaffProfile(req);
    if (!user) return res.redirect('/login');
    return res.render('staff/leave', {
      tenant: req.tenant,
      user,
      staff,
      csrfToken: req.csrfToken?.(),
      pageTitle: 'Leave',
      mode: 'new',
      leaveTypes: LEAVE_TYPES,
      error: null,
      values: {},
    });
  },

  async create(req, res) {
    try {
      const { LeaveRequest } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect('/login');
      if (!LeaveRequest || !staff) return res.status(503).send('Leave is unavailable.');
      await createLeave(req.models, {
        staffId: staff._id,
        userId: user._id,
        leaveType: req.body.leaveType,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        reason: req.body.reason,
      }, {
        actorUserId: actorUserId(req),
        timezone: req.tenant?.timezone || 'UTC',
        requester: 'staff',
      });
      return res.redirect('/staff/leave');
    } catch (err) {
      console.error('STAFF LEAVE CREATE ERROR:', err);
      const { user, staff } = await getStaffProfile(req).catch(() => ({ user: null, staff: null }));
      if (!user) return res.redirect('/login');
      return renderError(res, 'staff/leave', {
        tenant: req.tenant,
        user,
        staff,
        csrfToken: req.csrfToken?.(),
        pageTitle: 'Leave',
        mode: 'new',
        leaveTypes: LEAVE_TYPES,
        values: req.body,
      }, err.message || 'Failed to submit leave request.');
    }
  },

  async cancel(req, res) {
    try {
      const { LeaveRequest } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect('/login');
      if (!LeaveRequest || !staff || !isValidId(req.params.id)) return res.status(404).send('Leave request not found.');
      const owned = await LeaveRequest.exists({ _id: req.params.id, staffId: staff._id, isDeleted: { $ne: true } });
      if (!owned) return res.status(404).send('Leave request not found.');
      await cancelLeave(req.models, req.params.id, {
        actorUserId: actorUserId(req),
        timezone: req.tenant?.timezone || 'UTC',
        requester: 'staff',
      });
      return res.redirect('/staff/leave');
    } catch (err) {
      console.error('STAFF LEAVE CANCEL ERROR:', err);
      return res.status(400).send(err.message || 'Failed to cancel leave request.');
    }
  },
};

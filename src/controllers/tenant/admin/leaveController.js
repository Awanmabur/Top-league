const mongoose = require('mongoose');
const {
  LEAVE_TYPES,
  createLeave,
  updatePendingLeave,
  approveLeave,
  rejectLeave,
  cancelLeave,
  deleteLeave,
  processLeaveStatuses,
} = require('../../../services/tenant/leaveService');

const actorUserId = (req) => req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
const str = (v) => String(v ?? '').trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || 'all');
  const leaveType = str(query.leaveType || 'all');
  const staffId = str(query.staffId || 'all');
  const mongo = { isDeleted: { $ne: true } };
  if (status !== 'all' && ['Pending', 'Approved', 'Rejected', 'Cancelled'].includes(status)) mongo.status = status;
  if (leaveType !== 'all' && LEAVE_TYPES.includes(leaveType)) mongo.leaveType = leaveType;
  if (staffId !== 'all' && isValidId(staffId)) mongo.staffId = staffId;
  return { mongo, clean: { q, status, leaveType, staffId } };
}

function canPopulate(req, Model, pathName) {
  const path = Model?.schema?.path(pathName);
  return Boolean(path?.options?.ref && req.models?.[path.options.ref]);
}

function serializeLeave(doc) {
  const staff = doc.staffId || {};
  const dept = staff.departmentId || {};
  const status = doc.status || 'Pending';
  return {
    id: String(doc._id),
    staffId: staff._id ? String(staff._id) : String(doc.staffId || ''),
    staffName: [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(' ') || staff.fullName || '—',
    employeeId: staff.employeeId || '—',
    departmentName: dept.name || '—',
    leaveType: doc.leaveType || 'Annual',
    startDate: doc.startDate ? new Date(doc.startDate).toISOString().slice(0, 10) : '',
    endDate: doc.endDate ? new Date(doc.endDate).toISOString().slice(0, 10) : '',
    days: Number(doc.days || 0),
    reason: doc.reason || '',
    status,
    rejectionReason: doc.rejectionReason || '',
    approvedAt: doc.approvedAt ? new Date(doc.approvedAt).toISOString().slice(0, 10) : '',
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : '',
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString().slice(0, 10) : '',
    canEdit: status === 'Pending',
    canApprove: status === 'Pending',
    canReject: status === 'Pending',
    canCancel: status === 'Pending' || status === 'Approved',
    canDelete: status === 'Rejected' || status === 'Cancelled',
  };
}

function computeKpis(list = []) {
  return {
    total: list.length,
    pending: list.filter((x) => x.status === 'Pending').length,
    approved: list.filter((x) => x.status === 'Approved').length,
    rejected: list.filter((x) => x.status === 'Rejected').length,
  };
}

async function loadLookups(req) {
  const { Staff } = req.models || {};
  if (!Staff) return { staff: [] };
  let query = Staff.find({ isDeleted: { $ne: true }, status: { $in: ['Active', 'On Leave'] } })
    .sort({ firstName: 1, lastName: 1 });
  if (canPopulate(req, Staff, 'departmentId')) query = query.populate('departmentId', 'name');
  return { staff: await query.lean() };
}

function context(req) {
  return {
    actorUserId: actorUserId(req),
    timezone: req.tenant?.timezone || 'UTC',
    requester: 'admin',
  };
}

function fail(req, res, error, fallback) {
  console.error(fallback, error);
  req.flash?.('error', error?.message || 'Leave operation failed.');
  return res.redirect('/admin/staff-leave');
}

module.exports = {
  index: async (req, res) => {
    try {
      const { LeaveRequest, Staff } = req.models;
      await processLeaveStatuses({ models: req.models, tenant: req.tenant }, new Date()).catch(() => 0);
      const { mongo, clean } = buildFilters(req.query);
      let leaveQuery = LeaveRequest.find(mongo).sort({ createdAt: -1 });
      if (canPopulate(req, LeaveRequest, 'staffId')) {
        leaveQuery = Staff && canPopulate(req, Staff, 'departmentId')
          ? leaveQuery.populate({ path: 'staffId', select: 'firstName middleName lastName fullName employeeId departmentId', populate: { path: 'departmentId', select: 'name' } })
          : leaveQuery.populate('staffId', 'firstName middleName lastName fullName employeeId departmentId');
      }
      const [leave, lookups] = await Promise.all([leaveQuery.lean(), loadLookups(req)]);
      let data = leave.map(serializeLeave);
      if (clean.q) {
        const q = clean.q.toLowerCase();
        data = data.filter((x) => `${x.staffName} ${x.employeeId} ${x.departmentName} ${x.leaveType} ${x.status} ${x.reason}`.toLowerCase().includes(q));
      }
      return res.render('tenant/staff/leave', {
        tenant: req.tenant,
        csrfToken: req.csrfToken?.(),
        leave: data,
        staff: lookups.staff,
        kpis: computeKpis(data),
        query: clean,
        messages: { success: req.flash?.('success') || [], error: req.flash?.('error') || [] },
      });
    } catch (error) {
      console.error('leaveController.index error:', error);
      return res.status(500).render('platform/public/500', { tenant: req.tenant, message: error.message || 'Failed to load leave requests.' });
    }
  },

  create: async (req, res) => {
    try {
      if (!isValidId(req.body.staffId)) throw new Error('Please select a valid staff member.');
      await createLeave(req.models, req.body, context(req));
      req.flash?.('success', 'Leave request created successfully.');
      return res.redirect('/admin/staff-leave');
    } catch (error) { return fail(req, res, error, 'leaveController.create error:'); }
  },

  update: async (req, res) => {
    try {
      if (!isValidId(req.params.id)) throw new Error('Invalid leave request ID.');
      await updatePendingLeave(req.models, req.params.id, req.body, context(req));
      req.flash?.('success', 'Leave request updated successfully.');
      return res.redirect('/admin/staff-leave');
    } catch (error) { return fail(req, res, error, 'leaveController.update error:'); }
  },

  approve: async (req, res) => {
    try {
      if (!isValidId(req.params.id)) throw new Error('Invalid leave request ID.');
      await approveLeave(req.models, req.params.id, context(req));
      req.flash?.('success', 'Leave request approved.');
      return res.redirect('/admin/staff-leave');
    } catch (error) { return fail(req, res, error, 'leaveController.approve error:'); }
  },

  reject: async (req, res) => {
    try {
      if (!isValidId(req.params.id)) throw new Error('Invalid leave request ID.');
      await rejectLeave(req.models, req.params.id, req.body.rejectionReason, context(req));
      req.flash?.('success', 'Leave request rejected.');
      return res.redirect('/admin/staff-leave');
    } catch (error) { return fail(req, res, error, 'leaveController.reject error:'); }
  },

  cancel: async (req, res) => {
    try {
      if (!isValidId(req.params.id)) throw new Error('Invalid leave request ID.');
      await cancelLeave(req.models, req.params.id, context(req));
      req.flash?.('success', 'Leave request cancelled.');
      return res.redirect('/admin/staff-leave');
    } catch (error) { return fail(req, res, error, 'leaveController.cancel error:'); }
  },

  delete: async (req, res) => {
    try {
      if (!isValidId(req.params.id)) throw new Error('Invalid leave request ID.');
      await deleteLeave(req.models, req.params.id, context(req));
      req.flash?.('success', 'Leave request deleted.');
      return res.redirect('/admin/staff-leave');
    } catch (error) { return fail(req, res, error, 'leaveController.delete error:'); }
  },

  bulkAction: async (req, res) => {
    try {
      const ids = str(req.body.ids).split(',').map((x) => x.trim()).filter(isValidId);
      if (!ids.length) throw new Error('No leave requests selected.');
      const action = str(req.body.action);
      let changed = 0;
      let skipped = 0;
      for (const id of ids) {
        try {
          if (action === 'approve') await approveLeave(req.models, id, context(req));
          else if (action === 'reject') await rejectLeave(req.models, id, req.body.rejectionReason, context(req));
          else if (action === 'cancel') await cancelLeave(req.models, id, context(req));
          else if (action === 'delete') await deleteLeave(req.models, id, context(req));
          else throw new Error('Invalid bulk action.');
          changed += 1;
        } catch (_) { skipped += 1; }
      }
      if (!changed) throw new Error(action === 'reject' && !str(req.body.rejectionReason) ? 'A rejection reason is required.' : 'No selected leave requests could be changed by that action.');
      req.flash?.('success', `${changed} leave request${changed === 1 ? '' : 's'} updated${skipped ? `; ${skipped} skipped by lifecycle rules` : ''}.`);
      return res.redirect('/admin/staff-leave');
    } catch (error) { return fail(req, res, error, 'leaveController.bulkAction error:'); }
  },
};

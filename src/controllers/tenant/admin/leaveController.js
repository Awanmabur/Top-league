const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function daysBetween(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start);
  const b = new Date(end);
  const diff = Math.floor(
    (b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0)) / 86400000
  );
  return diff >= 0 ? diff + 1 : 0;
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const leaveType = str(query.leaveType || "all");
  const staffId = str(query.staffId || "all");

  const mongo = { isDeleted: { $ne: true } };

  if (status !== "all") mongo.status = status;
  if (leaveType !== "all") mongo.leaveType = leaveType;
  if (staffId !== "all" && isValidId(staffId)) mongo.staffId = staffId;

  return {
    mongo,
    clean: { q, status, leaveType, staffId },
  };
}

function hasPath(Model, pathName) {
  return Boolean(Model?.schema?.path(pathName));
}

function canPopulateRef(req, Model, pathName) {
  if (!Model?.schema?.path(pathName)) return false;

  const path = Model.schema.path(pathName);
  const refName = path?.options?.ref;

  if (!refName) return false;

  return Boolean(req.models?.[refName]);
}

function serializeLeave(doc) {
  const staff = doc.staffId || {};
  const dept = staff.departmentId || {};

  return {
    id: String(doc._id),
    staffId: staff._id ? String(staff._id) : "",
    staffName:
      [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(" ") ||
      staff.fullName ||
      "—",
    employeeId: staff.employeeId || "—",
    departmentName: dept.name || "—",
    leaveType: doc.leaveType || "Annual",
    startDate: doc.startDate ? new Date(doc.startDate).toISOString().slice(0, 10) : "",
    endDate: doc.endDate ? new Date(doc.endDate).toISOString().slice(0, 10) : "",
    days: Number(doc.days || 0),
    reason: doc.reason || "",
    status: doc.status || "Pending",
    rejectionReason: doc.rejectionReason || "",
    approvedAt: doc.approvedAt ? new Date(doc.approvedAt).toISOString().slice(0, 10) : "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString().slice(0, 10) : "",
  };
}

function computeKpis(list = []) {
  return {
    total: list.length,
    pending: list.filter((x) => x.status === "Pending").length,
    approved: list.filter((x) => x.status === "Approved").length,
    rejected: list.filter((x) => x.status === "Rejected").length,
  };
}

async function loadLookups(req) {
  const { Staff } = req.models || {};
  if (!Staff) return { staff: [] };

  let query = Staff.find({ isDeleted: { $ne: true } })
    .sort({ firstName: 1, lastName: 1 });

  if (canPopulateRef(req, Staff, "departmentId")) {
    query = query.populate("departmentId", "name");
  }

  const staff = await query.lean();
  return { staff };
}

module.exports = {
  index: async (req, res) => {
    try {
      const { LeaveRequest, Staff } = req.models;
      const { mongo, clean } = buildFilters(req.query);

      let leaveQuery = LeaveRequest.find(mongo).sort({ createdAt: -1 });

      if (canPopulateRef(req, LeaveRequest, "staffId")) {
        if (Staff && canPopulateRef(req, Staff, "departmentId")) {
          leaveQuery = leaveQuery.populate({
            path: "staffId",
            select: "firstName middleName lastName fullName employeeId departmentId",
            populate: { path: "departmentId", select: "name" },
          });
        } else {
          leaveQuery = leaveQuery.populate(
            "staffId",
            "firstName middleName lastName fullName employeeId departmentId"
          );
        }
      }

      const [leave, lookups] = await Promise.all([
        leaveQuery.lean(),
        loadLookups(req),
      ]);

      let data = leave.map(serializeLeave);

      if (clean.q) {
        const q = clean.q.toLowerCase();
        data = data.filter((x) =>
          `${x.staffName} ${x.employeeId} ${x.departmentName} ${x.leaveType} ${x.status} ${x.reason}`
            .toLowerCase()
            .includes(q)
        );
      }

      const kpis = computeKpis(data);

      return res.render("tenant/admin/staff/leave", {
        tenant: req.tenant,
        csrfToken: req.csrfToken?.(),
        leave: data,
        staff: lookups.staff,
        kpis,
        query: clean,
        messages: {
          success: req.flash?.("success") || [],
          error: req.flash?.("error") || [],
        },
      });
    } catch (error) {
      console.error("leaveController.index error:", error);
      return res.status(500).render("tenant/admin/error", {
        tenant: req.tenant,
        message: error.message || "Failed to load leave requests.",
      });
    }
  },

  create: async (req, res) => {
    try {
      const { LeaveRequest } = req.models;

      if (!isValidId(req.body.staffId)) {
        req.flash?.("error", "Please select a valid staff member.");
        return res.redirect("/admin/staff-leave");
      }

      const startDate = asDate(req.body.startDate);
      const endDate = asDate(req.body.endDate);

      if (!startDate || !endDate) {
        req.flash?.("error", "Start date and end date are required.");
        return res.redirect("/admin/staff-leave");
      }

      if (endDate < startDate) {
        req.flash?.("error", "End date cannot be earlier than start date.");
        return res.redirect("/admin/staff-leave");
      }

      await LeaveRequest.create({
        staffId: req.body.staffId,
        leaveType: str(req.body.leaveType || "Annual"),
        startDate,
        endDate,
        days: daysBetween(startDate, endDate),
        reason: str(req.body.reason),
        status: "Pending",
        createdBy: actorUserId(req),
        updatedBy: actorUserId(req),
      });

      req.flash?.("success", "Leave request created successfully.");
      return res.redirect("/admin/staff-leave");
    } catch (error) {
      console.error("leaveController.create error:", error);
      req.flash?.("error", error.message || "Failed to create leave request.");
      return res.redirect("/admin/staff-leave");
    }
  },

  update: async (req, res) => {
    try {
      const { LeaveRequest } = req.models;

      if (!isValidId(req.params.id)) {
        req.flash?.("error", "Invalid leave request ID.");
        return res.redirect("/admin/staff-leave");
      }

      const existing = await LeaveRequest.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      });

      if (!existing) {
        req.flash?.("error", "Leave request not found.");
        return res.redirect("/admin/staff-leave");
      }

      if (!isValidId(req.body.staffId)) {
        req.flash?.("error", "Please select a valid staff member.");
        return res.redirect("/admin/staff-leave");
      }

      const startDate = asDate(req.body.startDate);
      const endDate = asDate(req.body.endDate);

      if (!startDate || !endDate) {
        req.flash?.("error", "Start date and end date are required.");
        return res.redirect("/admin/staff-leave");
      }

      if (endDate < startDate) {
        req.flash?.("error", "End date cannot be earlier than start date.");
        return res.redirect("/admin/staff-leave");
      }

      existing.staffId = req.body.staffId;
      existing.leaveType = str(req.body.leaveType || "Annual");
      existing.startDate = startDate;
      existing.endDate = endDate;
      existing.days = daysBetween(startDate, endDate);
      existing.reason = str(req.body.reason);
      existing.updatedBy = actorUserId(req);

      await existing.save();
      req.flash?.("success", "Leave request updated successfully.");
      return res.redirect("/admin/staff-leave");
    } catch (error) {
      console.error("leaveController.update error:", error);
      req.flash?.("error", error.message || "Failed to update leave request.");
      return res.redirect("/admin/staff-leave");
    }
  },

  approve: async (req, res) => {
    try {
      const { LeaveRequest, Staff } = req.models;

      if (!isValidId(req.params.id)) {
        req.flash?.("error", "Invalid leave request ID.");
        return res.redirect("/admin/staff-leave");
      }

      const leave = await LeaveRequest.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      });

      if (!leave) {
        req.flash?.("error", "Leave request not found.");
        return res.redirect("/admin/staff-leave");
      }

      leave.status = "Approved";
      leave.approvedBy = actorUserId(req);
      leave.approvedAt = new Date();
      leave.rejectionReason = "";
      leave.updatedBy = actorUserId(req);
      await leave.save();

      if (Staff && leave.staffId) {
        await Staff.updateOne(
          { _id: leave.staffId, isDeleted: { $ne: true } },
          { $set: { status: "On Leave", updatedBy: actorUserId(req) } }
        );
      }

      req.flash?.("success", "Leave request approved.");
      return res.redirect("/admin/staff-leave");
    } catch (error) {
      console.error("leaveController.approve error:", error);
      req.flash?.("error", error.message || "Failed to approve leave request.");
      return res.redirect("/admin/staff-leave");
    }
  },

  reject: async (req, res) => {
    try {
      const { LeaveRequest } = req.models;

      if (!isValidId(req.params.id)) {
        req.flash?.("error", "Invalid leave request ID.");
        return res.redirect("/admin/staff-leave");
      }

      await LeaveRequest.updateOne(
        { _id: req.params.id, isDeleted: { $ne: true } },
        {
          $set: {
            status: "Rejected",
            rejectionReason: str(req.body.rejectionReason),
            updatedBy: actorUserId(req),
          },
        }
      );

      req.flash?.("success", "Leave request rejected.");
      return res.redirect("/admin/staff-leave");
    } catch (error) {
      console.error("leaveController.reject error:", error);
      req.flash?.("error", error.message || "Failed to reject leave request.");
      return res.redirect("/admin/staff-leave");
    }
  },

  cancel: async (req, res) => {
    try {
      const { LeaveRequest, Staff } = req.models;

      if (!isValidId(req.params.id)) {
        req.flash?.("error", "Invalid leave request ID.");
        return res.redirect("/admin/staff-leave");
      }

      const leave = await LeaveRequest.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      });

      if (!leave) {
        req.flash?.("error", "Leave request not found.");
        return res.redirect("/admin/staff-leave");
      }

      leave.status = "Cancelled";
      leave.updatedBy = actorUserId(req);
      await leave.save();

      if (Staff && leave.staffId) {
        await Staff.updateOne(
          { _id: leave.staffId, isDeleted: { $ne: true }, status: "On Leave" },
          { $set: { status: "Active", updatedBy: actorUserId(req) } }
        );
      }

      req.flash?.("success", "Leave request cancelled.");
      return res.redirect("/admin/staff-leave");
    } catch (error) {
      console.error("leaveController.cancel error:", error);
      req.flash?.("error", error.message || "Failed to cancel leave request.");
      return res.redirect("/admin/staff-leave");
    }
  },

  delete: async (req, res) => {
    try {
      const { LeaveRequest } = req.models;

      if (!isValidId(req.params.id)) {
        req.flash?.("error", "Invalid leave request ID.");
        return res.redirect("/admin/staff-leave");
      }

      await LeaveRequest.updateOne(
        { _id: req.params.id, isDeleted: { $ne: true } },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            updatedBy: actorUserId(req),
          },
        }
      );

      req.flash?.("success", "Leave request deleted.");
      return res.redirect("/admin/staff-leave");
    } catch (error) {
      console.error("leaveController.delete error:", error);
      req.flash?.("error", error.message || "Failed to delete leave request.");
      return res.redirect("/admin/staff-leave");
    }
  },

  bulkAction: async (req, res) => {
    try {
      const { LeaveRequest } = req.models;

      const ids = str(req.body.ids)
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isValidId(x));

      if (!ids.length) {
        req.flash?.("error", "No leave requests selected.");
        return res.redirect("/admin/staff-leave");
      }

      const action = str(req.body.action);
      const patch = { updatedBy: actorUserId(req) };

      if (action === "approve") {
        patch.status = "Approved";
        patch.approvedAt = new Date();
        patch.approvedBy = actorUserId(req);
        patch.rejectionReason = "";
      } else if (action === "reject") {
        patch.status = "Rejected";
      } else if (action === "cancel") {
        patch.status = "Cancelled";
      } else if (action === "delete") {
        patch.isDeleted = true;
        patch.deletedAt = new Date();
      } else {
        req.flash?.("error", "Invalid bulk action.");
        return res.redirect("/admin/staff-leave");
      }

      await LeaveRequest.updateMany(
        { _id: { $in: ids }, isDeleted: { $ne: true } },
        { $set: patch }
      );

      req.flash?.("success", "Bulk action applied.");
      return res.redirect("/admin/staff-leave");
    } catch (error) {
      console.error("leaveController.bulkAction error:", error);
      req.flash?.("error", error.message || "Failed to apply bulk action.");
      return res.redirect("/admin/staff-leave");
    }
  },
};
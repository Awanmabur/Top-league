const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  num,
} = require("./_helpers");
const {
  actorUserId,
  createApplication,
  notifyStudent,
  str,
} = require("../../../services/tenant/hostelService");

async function readPolicy(Setting) {
  if (!Setting) return { applicationsOpen: true, policyText: "", checkInInstructions: "", contact: "" };
  const row = await Setting.findOne({ key: "hostel_policy", isDeleted: { $ne: true } }).lean().catch(() => null);
  const value = row?.value && typeof row.value === "object" ? row.value : {};
  return {
    applicationsOpen: value.applicationsOpen !== false,
    policyText: str(value.policyText, 5000),
    checkInInstructions: str(value.checkInInstructions, 3000),
    contact: str(value.contact, 300),
  };
}

async function loadStudentHostel(req) {
  const { HostelAllocation, HostelApplication, Hostel, Invoice, Setting } = req.models || {};
  const got = await getStudent(req);
  const user = got?.user || null;
  const student = got?.student || null;
  if (!user) return { redirect: "/login" };

  const allocation = HostelAllocation
    ? await HostelAllocation.findOne({
        $or: [{ student: student?._id }, { studentId: student?._id }],
        status: "active",
        isDeleted: { $ne: true },
      })
        .sort({ checkInDate: -1, createdAt: -1 })
        .lean()
        .catch(() => null)
    : null;

  const application = HostelApplication
    ? await HostelApplication.findOne({
        $or: [{ student: student?._id }, { studentId: student?._id }],
        isDeleted: { $ne: true },
      })
        .sort({ isCurrent: -1, submittedAt: -1, createdAt: -1 })
        .lean()
        .catch(() => null)
    : null;

  const hostels = Hostel
    ? await Hostel.find({ status: { $ne: "Closed" } }).sort({ block: 1, code: 1 }).lean().catch(() => [])
    : [];

  const hostelInvoices = Invoice
    ? await Invoice.find({
        studentId: student?._id,
        $or: [
          { category: /hostel/i },
          { type: /hostel/i },
          { description: /hostel/i },
        ],
      })
        .sort({ createdAt: -1 })
        .lean()
        .catch(() => [])
    : [];

  const roomById = new Map(hostels.map((room) => [String(room._id), room]));
  const allocatedRoom = allocation ? roomById.get(String(allocation.hostel || allocation.room)) || null : null;
  const appliedRoom = application ? roomById.get(String(application.hostel || application.room)) || null : null;

  const options = hostels.map((room) => {
    const beds = num(room.beds);
    const occupied = num(room.occupied);
    return {
      id: String(room._id),
      name: `${room.block || "Hostel"} • ${room.code || "Room"}`,
      gender: room.gender || "Mixed",
      roomType: room.type || "Standard",
      fee: num(room.pricePerSemester),
      capacity: beds,
      available: Math.max(0, beds - occupied),
      location: room.block || "Campus",
      status: room.status || "Available",
    };
  });

  return {
    user,
    student,
    allocation: allocation
      ? {
          id: String(allocation._id),
          hostelName: allocation.block || allocatedRoom?.block || "Hostel",
          block: allocation.block || allocatedRoom?.block || "-",
          room: allocation.roomCode || allocatedRoom?.code || "-",
          bed: allocation.bedLabel || "-",
          status: allocation.status === "active" ? "Allocated" : allocation.status,
          startDate: allocation.checkInDate || allocation.createdAt || null,
        }
      : null,
    application: application
      ? {
          id: String(application._id),
          applicationId: application.applicationId || "",
          status: application.status || "Pending",
          appliedAt: application.submittedAt || application.createdAt || null,
          preferredRoomType: application.preference || appliedRoom?.type || "-",
          roomLabel: `${application.block || appliedRoom?.block || ""}${application.roomCode || appliedRoom?.code ? ` • ${application.roomCode || appliedRoom?.code}` : ""}`.trim(),
          notes: application.notes || "",
          isCurrent: application.isCurrent === true,
        }
      : null,
    options,
    policy: await readPolicy(Setting),
    hostelFinance: {
      billed: hostelInvoices.reduce((sum, invoice) => sum + num(invoice.amount ?? invoice.total ?? invoice.totalAmount ?? invoice.amountDue), 0),
      balance: hostelInvoices.reduce((sum, invoice) => sum + num(invoice.balance ?? invoice.amountDue ?? 0), 0),
    },
  };
}

module.exports = {
  hostel: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");
      const data = await loadStudentHostel(req);
      if (data.redirect) return res.redirect(data.redirect);

      const blocked = mustHaveStudent(
        res,
        {
          tenant: req.tenant,
          user: data.user,
          student: data.student,
          currentPath: req.originalUrl,
          pageTitle: "Hostels & Accommodation",
        },
        "students/hostel"
      );
      if (blocked) return blocked;

      return renderView(req, res, "students/hostel", {
        pageTitle: "Hostels & Accommodation",
        user: data.user,
        student: data.student,
        studentName: getStudentDisplayName(data.student, data.user),
        meta: academicMeta(data.student),
        allocation: data.allocation,
        application: data.application,
        options: data.options,
        policy: data.policy,
        hostelFinance: data.hostelFinance,
      });
    } catch (err) {
      return res.status(500).send("Failed to load hostel: " + err.message);
    }
  },

  apply: async (req, res) => {
    try {
      if (!req.models) throw new Error("Tenant models not loaded.");
      const got = await getStudent(req);
      const student = got?.student || null;
      if (!student) throw new Error("Student profile is unavailable.");
      const policy = await readPolicy(req.models.Setting);
      if (!policy.applicationsOpen) throw new Error("Hostel applications are currently closed.");

      const { application, room } = await createApplication(req.models, {
        student,
        roomId: req.body.roomId,
        preference: req.body.preference,
        notes: req.body.notes,
        actorUserId: actorUserId(req),
      });

      if (req.models.Notification) {
        await req.models.Notification.create({
          audience: "admin",
          title: `New hostel application • ${application.applicationId}`,
          message: `${application.studentName} (${application.regNo || "student"}) applied for ${room.block} • ${room.code}.`,
          type: "info",
          url: "/admin/hostels?view=applications",
          entityType: "HostelApplication",
          entityId: application._id,
          createdBy: actorUserId(req),
        }).catch(() => null);
      }

      await notifyStudent(req.models, student, {
        title: "Hostel application submitted",
        message: `Application ${application.applicationId} was submitted for ${room.block} • ${room.code}.`,
        type: "success",
        entityType: "HostelApplication",
        entityId: application._id,
        createdBy: actorUserId(req),
      });
      req.flash?.("success", "Hostel application submitted successfully.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to submit hostel application.");
    }
    return res.redirect("/student/hostel");
  },

  _test: { readPolicy, loadStudentHostel },
};

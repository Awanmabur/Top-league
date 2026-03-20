const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  num,
} = require("./_helpers");

module.exports = {
  hostel: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { HostelAllocation, HostelApplication, Hostel, Invoice } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        {
          tenant: req.tenant,
          user,
          student,
          currentPath: req.originalUrl,
          pageTitle: "Hostels & Accommodation",
        },
        "tenant/student/hostel"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const allocation = HostelAllocation
        ? await HostelAllocation.findOne({ studentId: student._id })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => null)
        : null;

      const application = HostelApplication
        ? await HostelApplication.findOne({ studentId: student._id })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => null)
        : null;

      const hostels = Hostel
        ? await Hostel.find({ isDeleted: { $ne: true } })
            .sort({ name: 1 })
            .lean()
            .catch(() => [])
        : [];

      const hostelInvoices = Invoice
        ? await Invoice.find({
            studentId: student._id,
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

      const options = hostels.map((h) => ({
        id: String(h._id),
        name: h.name || "Hostel",
        gender: h.gender || h.allowedGender || "Mixed",
        roomType: h.roomType || h.type || "Standard",
        fee: num(h.fee ?? h.amount ?? h.price),
        capacity: num(h.capacity ?? h.rooms ?? 0),
        available: num(h.availableSpaces ?? h.availableBeds ?? 0),
        location: h.location || h.campus || "Campus",
      }));

      return renderView(req, res, "tenant/student/hostel", {
        pageTitle: "Hostels & Accommodation",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        allocation: allocation
          ? {
              hostelName: allocation.hostelName || allocation.hostel || "Assigned hostel",
              block: allocation.block || allocation.building || "-",
              room: allocation.room || allocation.roomNumber || "-",
              bed: allocation.bed || allocation.bedNumber || "-",
              status: allocation.status || "allocated",
              startDate: allocation.startDate || allocation.createdAt || null,
            }
          : null,
        application: application
          ? {
              status: application.status || "pending",
              appliedAt: application.createdAt || null,
              preferredRoomType: application.roomType || application.preference || "-",
              notes: application.notes || "",
            }
          : null,
        options,
        hostelFinance: {
          billed: hostelInvoices.reduce((s, i) => s + num(i.amount ?? i.total ?? i.amountDue), 0),
          balance: hostelInvoices.reduce((s, i) => s + num(i.balance ?? i.amountDue ?? 0), 0),
        },
      });
    } catch (err) {
      return res.status(500).send("Failed to load hostel: " + err.message);
    }
  },
};
module.exports = {
  dashboard: async (req, res) => {
    const {
      User,
      Student,
      Invoice,
      Attendance,
      Announcement,
      Event,
      LibraryBook,
      Hostel
    } = req.models || {};

    try {
      const sessionUser = req.session?.tenantUser;
      if (!sessionUser?.id) return res.redirect("/login");

      // 1) Load auth user
      const user = User
        ? await User.findOne({ _id: sessionUser.id, deletedAt: null }).lean()
        : null;

      if (!user) return res.redirect("/login");

      // 2) Load student (prefer session studentId, else fallback by userId/email)
      let student = null;

      if (sessionUser.studentId && Student) {
        student = await Student.findById(sessionUser.studentId).lean();
      }

      if (!student && Student) {
        student = await Student.findOne({
          $or: [
            { userId: user._id },
            { email: user.email }
          ]
        }).lean();
      }

      if (!student) {
        // production-safe: don’t crash, show helpful message
        return res.status(403).render("tenant/admin/student/dashboard", {
          tenant: req.tenant,
          user,
          student: null,
          stats: {
            feesDue: 0,
            invoicesOpen: 0,
            attendanceRate: 0,
            announcements: 0,
            upcomingEvents: 0,
            libraryBorrowed: 0,
            hostelAssigned: false
          },
          recent: {
            announcements: [],
            invoices: [],
            attendance: []
          },
          error: "Student profile not found. Contact admin to complete your registration."
        });
      }

      // 3) Build stats (all optional; safe if models missing)
      const invoicesQuery = Invoice ? { studentId: student._id } : null;
      const attendanceQuery = Attendance ? { studentId: student._id } : null;

      const [openInvoices, invoicesRecent, attendanceRecent, announcementsRecent, eventsCount] =
        await Promise.all([
          Invoice ? Invoice.find({ ...invoicesQuery, status: { $in: ["unpaid", "partial", "pending"] } }).lean() : [],
          Invoice ? Invoice.find(invoicesQuery).sort({ createdAt: -1 }).limit(5).lean() : [],
          Attendance ? Attendance.find(attendanceQuery).sort({ date: -1 }).limit(10).lean() : [],
          Announcement ? Announcement.find({}).sort({ createdAt: -1 }).limit(5).lean() : [],
          Event ? Event.countDocuments({ date: { $gte: new Date() } }) : 0
        ]);

      const feesDue = Array.isArray(openInvoices)
        ? openInvoices.reduce((sum, inv) => sum + Number(inv.balance || inv.amountDue || 0), 0)
        : 0;

      // Attendance rate (basic): present / total from recent records
      let attendanceRate = 0;
      if (Array.isArray(attendanceRecent) && attendanceRecent.length > 0) {
        const present = attendanceRecent.filter(a => String(a.status || "").toLowerCase() === "present").length;
        attendanceRate = Math.round((present / attendanceRecent.length) * 100);
      }

      // Library borrowed count (optional)
      let libraryBorrowed = 0;
      if (LibraryBook && student._id) {
        // adjust query to match your schema if needed (borrowerStudentId etc.)
        libraryBorrowed = await LibraryBook.countDocuments({
          borrowedByStudentId: student._id,
          returnedAt: null
        }).catch(() => 0);
      }

      // Hostel assigned (optional)
      let hostelAssigned = false;
      if (Hostel && student._id) {
        const hostel = await Hostel.findOne({ studentId: student._id }).lean().catch(() => null);
        hostelAssigned = !!hostel;
      }

      return res.render("tenant/student/dashboard", {
        tenant: req.tenant,
        user,
        student,
        stats: {
          feesDue,
          invoicesOpen: Array.isArray(openInvoices) ? openInvoices.length : 0,
          attendanceRate,
          announcements: announcementsRecent?.length || 0,
          upcomingEvents: eventsCount || 0,
          libraryBorrowed,
          hostelAssigned
        },
        recent: {
          announcements: announcementsRecent || [],
          invoices: invoicesRecent || [],
          attendance: attendanceRecent || []
        },
        error: null
      });
    } catch (err) {
      console.error("STUDENT DASHBOARD ERROR:", err);
      return res.status(500).send("Failed to load student dashboard");
    }
  }
};

const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  num,
} = require("./_helpers");

module.exports = {
  library: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { LibraryLoan, LibraryBook, LibraryReservation, Fine } = req.models;
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
          pageTitle: "Library",
        },
        "tenant/student/library"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const catalogue = LibraryBook
        ? await LibraryBook.find({ isDeleted: { $ne: true } })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean()
            .catch(() => [])
        : [];

      const loans = LibraryLoan
        ? await LibraryLoan.find({ studentId: student._id })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const reservations = LibraryReservation
        ? await LibraryReservation.find({ studentId: student._id })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const fines = Fine
        ? await Fine.find({
            $or: [{ studentId: student._id }, { userId: user._id }],
          })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      return renderView(req, res, "tenant/student/library", {
        pageTitle: "Library",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        catalogue: catalogue.map((b) => ({
          id: String(b._id),
          title: b.title || "Untitled",
          author: b.author || b.authors || "Unknown",
          type: b.type || b.format || "Book",
          location: b.location || b.branch || "Main library",
          callNo: b.callNumber || b.isbn || "-",
          copies: num(b.totalCopies ?? b.copies ?? 0),
          available: num(b.availableCopies ?? b.available ?? 0),
        })),
        loans: loans.map((l) => ({
          id: String(l._id),
          title: l.title || l.bookTitle || "Loan item",
          dueDate: l.dueDate || null,
          status: l.status || (l.returnedAt ? "Returned" : "On loan"),
        })),
        reservations: reservations.map((r) => ({
          id: String(r._id),
          title: r.title || r.bookTitle || "Reserved item",
          status: r.status || "Pending",
          createdAt: r.createdAt || null,
        })),
        fines: {
          count: fines.length,
          total: fines.reduce((s, f) => s + num(f.amount ?? f.total), 0),
        },
      });
    } catch (err) {
      return res.status(500).send("Failed to load library: " + err.message);
    }
  },
};
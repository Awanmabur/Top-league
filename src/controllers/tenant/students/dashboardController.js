const { buildStudentContext, findVisibleAnnouncements } = require("../../../services/tenant/announcementService");
const { findVisibleEvents } = require("../../../services/tenant/eventService");
const { studentPublishedResultFilter } = require("../../../services/tenant/resultService");
const { studentAttendanceFilter, attendanceSummary } = require("../../../services/tenant/attendanceService");
const { assignmentVisibilityFilterForStudent } = require("../../../services/tenant/assignmentService");
const { accountSnapshot, invoiceOutstanding } = require("../../../services/tenant/financeVisibilityService");
const {
  getStudent,
  getStudentDisplayName,
  mustHaveStudent,
  academicMeta,
  num,
  renderView,
  courseCodeFromAny,
  courseTitleFromAny,
} = require("./_helpers");

module.exports = {
  dashboard: async (req, res) => {
    try {
      if (!req.models) {
        req.flash?.("error", "Tenant models not loaded");
        return res.status(500).send("Tenant models not loaded");
      }

      const {
        Invoice,
        Payment,
        Attendance,
        Announcement,
        Event,
        LibraryLoan,
        HostelAllocation,
        Result,
        Exam,
        Subject,
        CourseRegistration,
        Assignment,
      } = req.models;

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
          pageTitle: "Student Dashboard",
        },
        "students/dashboard"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const financePromise = Invoice
        ? Promise.all([
            Invoice.find({
              studentId: student._id,
              isDeleted: { $ne: true },
              status: { $nin: ["Draft", "Cancelled"] },
            }).lean(),
            Payment
              ? Payment.find({ studentId: student._id, isDeleted: { $ne: true }, status: "Completed" }).lean()
              : Promise.resolve([]),
          ])
            .then(([invoices, payments]) => {
              const snapshot = accountSnapshot(invoices, payments);
              const invoicesOpen = snapshot.activeInvoices.filter((invoice) => invoiceOutstanding(invoice) > 0).length;
              const feesDue = snapshot.balance;
              const accountCredit = snapshot.credit;
              return { invoicesOpen, feesDue, accountCredit };
            })
            .catch(() => ({ invoicesOpen: 0, feesDue: 0, accountCredit: 0 }))
        : Promise.resolve({ invoicesOpen: 0, feesDue: 0, accountCredit: 0 });

      const attendancePromise = Attendance
        ? Attendance.find(studentAttendanceFilter(student._id))
            .sort({ sessionAt: -1, createdAt: -1 })
            .limit(50)
            .lean()
            .then((recent) => attendanceSummary(recent).rate)
            .catch(() => 0)
        : Promise.resolve(0);

      const portalAudienceContextPromise = (Announcement || Event)
        ? buildStudentContext(req, user, student)
        : Promise.resolve(null);

      const announcementsPromise = Announcement
        ? portalAudienceContextPromise.then((context) => findVisibleAnnouncements(req, context, { limit: 6, markRead: true })).catch(() => [])
        : Promise.resolve([]);

      const upcomingEventsPromise = Event
        ? portalAudienceContextPromise
            .then((context) => findVisibleEvents(req, context, { limit: 500, now: new Date() }))
            .then((visibleEvents) => visibleEvents.length)
            .catch(() => 0)
        : Promise.resolve(0);

      const libraryBorrowedPromise = LibraryLoan
        ? LibraryLoan.countDocuments({ studentId: student._id, returnedAt: null }).catch(() => 0)
        : Promise.resolve(0);

      const hostelAssignedPromise = HostelAllocation
        ? HostelAllocation.findOne({
            studentId: student._id,
            status: { $in: ["active", "allocated"] },
          })
            .select("_id")
            .lean()
            .then(Boolean)
            .catch(() => false)
        : Promise.resolve(false);

      const resultsPromise = Result
        ? (() => {
            let query = Result.find(studentPublishedResultFilter(student._id));
            if (Exam) query = query.populate({ path: "exam", model: Exam, select: "title code" });
            if (Subject) query = query.populate({ path: "subject", model: Subject, select: "code title shortTitle" });
            return query.sort({ publishedAt: -1, createdAt: -1 }).limit(5).lean().catch(() => []);
          })()
        : Promise.resolve([]);

      const registrationsPromise = CourseRegistration
        ? CourseRegistration.find({
            studentId: student._id,
            academicYear: String(student.academicYear || ""),
            term: Number(student.term || 0),
            status: "approved",
            isDeleted: { $ne: true },
          })
            .populate({ path: "subjectId", select: "code title shortTitle weeklyPeriods" })
            .sort({ createdAt: -1 })
            .limit(8)
            .lean()
            .catch(() => [])
        : Promise.resolve([]);

      const tasksPromise = Assignment
        ? Assignment.find(assignmentVisibilityFilterForStudent(student))
            .populate({ path: "course", select: "code title shortTitle" })
            .sort({ dueDate: 1, createdAt: -1 })
            .limit(6)
            .lean()
            .catch(() => [])
        : Promise.resolve([]);

      const [
        finance,
        attendanceRate,
        announcements,
        upcomingEvents,
        libraryBorrowed,
        hostelAssigned,
        results,
        registrations,
        tasks,
      ] = await Promise.all([
        financePromise,
        attendancePromise,
        announcementsPromise,
        upcomingEventsPromise,
        libraryBorrowedPromise,
        hostelAssignedPromise,
        resultsPromise,
        registrationsPromise,
        tasksPromise,
      ]);
      const { invoicesOpen, feesDue, accountCredit } = finance;

      const studentName = getStudentDisplayName(student, user);

      return renderView(req, res, "students/dashboard", {
        pageTitle: "Student Dashboard",
        user,
        student,
        studentName,
        meta,
        stats: {
          invoicesOpen,
          feesDue,
          accountCredit,
          attendanceRate,
          upcomingEvents,
          libraryBorrowed,
          hostelAssigned,
        },
        announcements,
        currentResults: results.map((r) => ({
          courseCode: r.subject?.code || "",
          courseTitle: r.subject?.title || r.subject?.shortTitle || r.exam?.title || "Result",
          grade: r.grade || "-",
          score: Number.isFinite(Number(r.percentage)) ? `${Number(r.percentage)}%` : `${Number(r.score || 0)}/${Number(r.totalMarks || 100)}`,
          publishedAt: r.publishedAt || null,
        })),
        registeredCourses: registrations.map((c) => ({
          courseCode: c.subjectId?.code || c.subjectCode || courseCodeFromAny(c),
          courseTitle: c.subjectId?.title || c.subjectId?.shortTitle || c.subjectTitle || courseTitleFromAny(c),
          semester: meta.semester,
          mode: "Optional",
          progress: 0,
          schedule:
            c.schedule ||
            c.timeLabel ||
            c.daysLabel ||
            "Schedule available from timetable",
          status: c.status || "registered",
        })),
        upcomingAssignments: tasks.map((a) => ({
          title: a.title || a.name || "Assignment",
          dueDate: a.dueDate || a.deadline || null,
          weight: a.weight || a.marks || null,
          courseCode: courseCodeFromAny(a),
        })),
      });
    } catch (err) {
      console.error("Student dashboard error:", err);
      return res.status(500).send("Failed to load dashboard.");
    }
  },
};
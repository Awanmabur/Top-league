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
        Attendance,
        Announcement,
        Event,
        LibraryLoan,
        HostelAllocation,
        Result,
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
        "tenant/student/dashboard"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      let invoicesOpen = 0;
      let feesDue = 0;
      let attendanceRate = 0;
      let announcements = [];
      let upcomingEvents = 0;
      let libraryBorrowed = 0;
      let hostelAssigned = false;
      let results = [];
      let registrations = [];
      let tasks = [];

      if (Invoice) {
        const open = await Invoice.find({
          studentId: student._id,
          status: { $in: ["unpaid", "partial", "pending"] },
        }).lean();

        invoicesOpen = open.length;
        feesDue = open.reduce(
          (sum, i) => sum + num(i.balance ?? i.amountDue ?? i.total ?? 0),
          0
        );
      }

      if (Attendance) {
        const recent = await Attendance.find({ studentId: student._id })
          .sort({ date: -1 })
          .limit(50)
          .lean();

        if (recent.length) {
          const present = recent.filter(
            (a) => String(a.status || "").toLowerCase() === "present"
          ).length;
          attendanceRate = Math.round((present / recent.length) * 100);
        }
      }

      if (Announcement) {
        announcements = await Announcement.find({})
          .sort({ createdAt: -1 })
          .limit(6)
          .lean();
      }

      if (Event) {
        upcomingEvents = await Event.countDocuments({
          $or: [
            { date: { $gte: new Date() } },
            { startDate: { $gte: new Date() } },
            { startsAt: { $gte: new Date() } },
          ],
        }).catch(() => 0);
      }

      if (LibraryLoan) {
        libraryBorrowed = await LibraryLoan.countDocuments({
          studentId: student._id,
          returnedAt: null,
        }).catch(() => 0);
      }

      if (HostelAllocation) {
        hostelAssigned = !!(await HostelAllocation.findOne({
          studentId: student._id,
          status: { $in: ["active", "allocated"] },
        })
          .select("_id")
          .lean()
          .catch(() => null));
      }

      if (Result) {
        results = await Result.find({ studentId: student._id })
          .sort({ publishedAt: -1, createdAt: -1 })
          .limit(5)
          .lean()
          .catch(() => []);
      }

      if (CourseRegistration) {
        registrations = await CourseRegistration.find({
          studentId: student._id,
          status: { $in: ["approved", "submitted", "active", "registered"] },
        })
          .sort({ createdAt: -1 })
          .limit(8)
          .lean()
          .catch(() => []);
      }

      if (Assignment) {
        tasks = await Assignment.find({
          $or: [
            { studentId: student._id },
            { assignedToStudents: student._id },
            { classId: student.classId || null },
            { programId: student.programId || null },
          ],
        })
          .sort({ dueDate: 1, createdAt: -1 })
          .limit(6)
          .lean()
          .catch(() => []);
      }

      const studentName = getStudentDisplayName(student, user);

      return renderView(req, res, "tenant/student/dashboard", {
        pageTitle: "Student Dashboard",
        user,
        student,
        studentName,
        meta,
        stats: {
          invoicesOpen,
          feesDue,
          attendanceRate,
          upcomingEvents,
          libraryBorrowed,
          hostelAssigned,
        },
        announcements,
        currentResults: results.map((r) => ({
          courseCode: courseCodeFromAny(r),
          courseTitle: courseTitleFromAny(r),
          grade: r.grade || r.letterGrade || "-",
          score: r.totalMarks ?? r.score ?? r.percentage ?? "-",
          publishedAt: r.publishedAt || r.createdAt || null,
        })),
        registeredCourses: registrations.map((c) => ({
          courseCode: courseCodeFromAny(c),
          courseTitle: courseTitleFromAny(c),
          semester: c.semester || meta.semester,
          mode: c.mode || c.deliveryMode || "Registered",
          progress: num(c.progress ?? c.completionRate ?? 0),
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
      return res.status(500).send("Failed to load dashboard: " + err.message);
    }
  },
};
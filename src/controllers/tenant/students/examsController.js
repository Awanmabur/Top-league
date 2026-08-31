const {
  isObjId,
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  titleCase,
} = require("./_helpers");

function studentExamFilter(student) {
  if (!isObjId(student?.classId)) return { _id: null };

  const filter = {
    classGroup: student.classId,
    status: { $in: ["scheduled", "completed"] },
  };

  if (student.academicYear) filter.academicYear = String(student.academicYear).trim();
  if (Number(student.term || 0)) filter.term = Number(student.term);

  const scoped = [];
  if (isObjId(student.sectionId)) {
    scoped.push({ $or: [{ sectionId: null }, { sectionId: { $exists: false } }, { sectionId: student.sectionId }] });
  } else {
    scoped.push({ $or: [{ sectionId: null }, { sectionId: { $exists: false } }] });
  }

  if (isObjId(student.streamId)) {
    scoped.push({ $or: [{ streamId: null }, { streamId: { $exists: false } }, { streamId: student.streamId }] });
  } else {
    scoped.push({ $or: [{ streamId: null }, { streamId: { $exists: false } }] });
  }

  if (scoped.length) filter.$and = scoped;
  return filter;
}

function localDateKey(date, timeZone = "UTC") {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const values = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

module.exports = {
  studentExamFilter,
  localDateKey,

  exams: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Exam } = req.models;
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
          pageTitle: "Exams",
        },
        "students/exams"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);
      const exams = await Exam.find(studentExamFilter(student))
        .populate({ path: "classGroup", select: "name code" })
        .populate({ path: "subject", select: "title code shortTitle" })
        .sort({ examDate: 1, startTime: 1, createdAt: 1 })
        .lean();

      const rows = exams.map((exam) => ({
        id: String(exam._id),
        title: exam.title || exam.code || "Exam",
        code: exam.code || "",
        subjectCode: exam.subject?.code || "",
        subjectTitle: exam.subject?.title || exam.subject?.shortTitle || "Subject",
        className: exam.classGroup?.name || exam.classGroup?.code || student.className || "",
        examDate: exam.examDate || null,
        startTime: exam.startTime || "",
        endTime: exam.endTime || "",
        durationMinutes: Number(exam.durationMinutes || 0),
        room: exam.room || "",
        campus: exam.campus || "",
        examType: titleCase(exam.examType || "exam"),
        status: titleCase(exam.status || "scheduled"),
        instructions: exam.instructions || "",
        maxMarks: Number(exam.maxMarks || 0),
        passMark: Number(exam.passMark || 0),
      }));

      const timeZone = req.tenant?.timezone || "UTC";
      const todayKey = localDateKey(new Date(), timeZone);
      const upcomingRows = rows.filter((row) => {
        if (!row.examDate || row.status.toLowerCase() !== "scheduled") return false;
        const examKey = new Date(row.examDate).toISOString().slice(0, 10);
        return examKey >= todayKey;
      });

      return renderView(req, res, "students/exams", {
        pageTitle: "Exams",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        exams: rows,
        kpis: {
          total: rows.length,
          upcoming: upcomingRows.length,
          nextExam: upcomingRows[0] || null,
        },
      });
    } catch (err) {
      console.error("STUDENT EXAMS ERROR:", err);
      return res.status(500).send("Failed to load exams.");
    }
  },
};

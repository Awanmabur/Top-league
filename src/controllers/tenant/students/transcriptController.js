const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  num,
  courseCodeFromAny,
  courseTitleFromAny,
} = require("./_helpers");

module.exports = {
  transcript: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Transcript, Result, LetterRequest, Invoice } = req.models;
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
          pageTitle: "Transcripts & Official Letters",
        },
        "students/transcript"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const transcript = Transcript
        ? await Transcript.findOne({ studentId: student._id })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => null)
        : null;

      const results = Result
        ? await Result.find({ studentId: student._id })
            .sort({ academicYear: -1, semester: -1, createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const letterRequests = LetterRequest
        ? await LetterRequest.find({
            $or: [{ studentId: student._id }, { userId: user._id }],
          })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const openInvoices = Invoice
        ? await Invoice.find({
            studentId: student._id,
            status: { $in: ["unpaid", "partial", "pending"] },
          })
            .lean()
            .catch(() => [])
        : [];

      const rows = results.map((r) => ({
        id: String(r._id),
        academicYear: r.academicYear || meta.academicYear,
        semester: r.semester || meta.semester,
        level: r.level || student?.level || "-",
        courseCode: courseCodeFromAny(r),
        courseTitle: courseTitleFromAny(r),
        credits: num(r.credits ?? r.creditUnits ?? 0),
        grade: r.grade || r.letterGrade || "-",
        gradePoints: num(r.gradePoints ?? r.points ?? 0),
        status: r.status || "Published",
        score: num(r.totalMarks ?? r.score ?? r.percentage),
      }));

      const totalCredits = rows.reduce((s, r) => s + num(r.credits), 0);
      const earnedCredits = rows
        .filter((r) => String(r.status || "").toLowerCase() !== "failed")
        .reduce((s, r) => s + num(r.credits), 0);

      const cgpa =
        transcript?.cgpa ||
        transcript?.gpa ||
        (rows.length
          ? (
              rows.reduce((s, r) => s + num(r.gradePoints), 0) /
              Math.max(rows.filter((r) => r.gradePoints > 0).length, 1)
            ).toFixed(2)
          : "0.00");

      const lastSemesterKey = rows.length
        ? `${rows[0].academicYear}__${rows[0].semester}`
        : null;

      const lastSemesterRows = lastSemesterKey
        ? rows.filter((r) => `${r.academicYear}__${r.semester}` === lastSemesterKey)
        : [];

      const lastSemesterGpa = lastSemesterRows.length
        ? (
            lastSemesterRows.reduce((s, r) => s + num(r.gradePoints), 0) /
            Math.max(lastSemesterRows.filter((r) => r.gradePoints > 0).length, 1)
          ).toFixed(2)
        : "0.00";

      const classification =
        Number(cgpa) >= 3.6
          ? "Upper Second Class"
          : Number(cgpa) >= 3.0
            ? "Lower Second Class"
            : Number(cgpa) >= 2.0
              ? "Pass"
              : "At Risk";

      const lettersCatalogue = [
        {
          type: "Admission Letter",
          category: "admission",
          purpose: "For visa, sponsorship, or official admission proof.",
          format: "PDF",
        },
        {
          type: "Registration Letter",
          category: "registration",
          purpose: "Confirms current semester registration.",
          format: "PDF",
        },
        {
          type: "Bonafide Student Letter",
          category: "bonafide",
          purpose: "Certifies that you are a bonafide student in good standing.",
          format: "PDF (digitally signed)",
        },
        {
          type: "Study Load Confirmation",
          category: "registration",
          purpose: "States your current semester course load.",
          format: "PDF",
        },
      ].map((item) => {
        const request = letterRequests.find((r) => (r.type || r.letterType) === item.type);
        return {
          ...item,
          status: request?.status || "Not requested",
          requestedAt: request?.createdAt || null,
        };
      });

      return renderView(req, res, "students/transcript", {
        pageTitle: "Transcripts & Official Letters",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        transcriptRows: rows,
        overview: {
          cgpa,
          lastSemesterGpa,
          totalCredits,
          earnedCredits,
          remainingCredits: Math.max(num(student?.requiredCredits ?? 120) - earnedCredits, 0),
          academicStatus: openInvoices.length ? "Has finance hold risk" : "Good standing",
          classification,
        },
        lettersCatalogue,
        lettersStats: {
          requestedThisYear: letterRequests.length,
          pending: letterRequests.filter((r) =>
            ["pending", "submitted", "review"].includes(String(r.status || "").toLowerCase())
          ).length,
          maxPerSemester: 5,
        },
      });
    } catch (err) {
      return res.status(500).send("Failed to load transcript: " + err.message);
    }
  },
};
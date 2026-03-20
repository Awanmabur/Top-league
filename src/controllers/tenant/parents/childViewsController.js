const { getParent, canAccessChild, renderError } = require("./_helpers");

function num(v) {
  return Number(v || 0);
}

function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return String(v);
  }
}

function fullName(doc) {
  if (!doc) return "Student";
  if (doc.fullName) return String(doc.fullName).trim();

  return [doc.firstName, doc.middleName, doc.lastName]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim() || "Student";
}

module.exports = {
  async show(req, res) {
    const log = (...a) =>
      console.log(
        `[PARENT-CHILD-VIEW] tenant=${req.tenant?.code || req.tenant?._id || "?"}`,
        ...a
      );

    try {
      const {
        Student,
        Attendance,
        Result,
        FeeInvoice,
        FeePayment,
        Payment,
        Fee,
        Invoice,
      } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const studentId = String(req.params?.id || "");
      if (!studentId || !canAccessChild(parent, studentId)) {
        return res.status(403).send("Forbidden");
      }

      const student = Student
        ? await Student.findOne({ _id: studentId, deletedAt: null })
            .select(
              "firstName lastName middleName fullName regNo program classGroup yearLevel academicYear semester status photoUrl guardianName guardianPhone guardianEmail attendanceRate feeBalance balance averageScore avgScore cgpa latestResult latestAnnouncement lastAttendanceDate nextEvent campus homeroomTeacher parentRelationship dateOfBirth gender admissionDate"
            )
            .populate({ path: "program", select: "code name title level faculty" })
            .populate({ path: "classGroup", select: "code name title" })
            .lean()
            .catch(() => null)
        : null;

      if (!student) {
        return res.status(404).send("Student not found");
      }

      const attendanceRows = Attendance
        ? await Attendance.find({
            deletedAt: null,
            $or: [{ student: student._id }, { studentId: student._id }],
          })
            .sort({ date: -1, createdAt: -1 })
            .limit(30)
            .lean()
            .catch(() => [])
        : [];

      const resultRows = Result
        ? await Result.find({
            deletedAt: null,
            $or: [{ student: student._id }, { studentId: student._id }],
          })
            .sort({ publishedAt: -1, createdAt: -1 })
            .limit(20)
            .lean()
            .catch(() => [])
        : [];

      const invoiceModel = FeeInvoice || Fee || Invoice || null;
      const paymentModel = FeePayment || Payment || null;

      const invoiceRows = invoiceModel
        ? await invoiceModel
            .find({
              deletedAt: null,
              $or: [{ student: student._id }, { studentId: student._id }],
            })
            .sort({ dueDate: 1, createdAt: -1 })
            .limit(20)
            .lean()
            .catch(() => [])
        : [];

      const paymentRows = paymentModel
        ? await paymentModel
            .find({
              deletedAt: null,
              $or: [{ student: student._id }, { studentId: student._id }],
            })
            .sort({ paymentDate: -1, date: -1, createdAt: -1 })
            .limit(20)
            .lean()
            .catch(() => [])
        : [];

      const attendanceSummary = {
        total: attendanceRows.length,
        present: attendanceRows.filter((x) => String(x.status || "").toLowerCase() === "present").length,
        absent: attendanceRows.filter((x) => String(x.status || "").toLowerCase() === "absent").length,
        late: attendanceRows.filter((x) => String(x.status || "").toLowerCase() === "late").length,
      };
      attendanceSummary.rate = attendanceSummary.total
        ? Math.round(
            ((attendanceSummary.present + attendanceSummary.late * 0.75) /
              attendanceSummary.total) *
              100
          )
        : num(student.attendanceRate || 0);

      const normalizedResults = resultRows.map((r) => ({
        ...r,
        subject: r.subjectName || r.subject || r.courseName || r.course || "Subject",
        exam: r.examTitle || r.assessment || r.exam || "Assessment",
        score: num(r.totalScore ?? r.score ?? r.mark ?? r.marks),
        grade: r.grade || "—",
        date: fmtDate(r.publishedAt || r.createdAt),
      }));

      const resultsSummary = {
        total: normalizedResults.length,
        average: normalizedResults.length
          ? Math.round(
              normalizedResults.reduce((sum, r) => sum + num(r.score), 0) /
                normalizedResults.length
            )
          : num(student.averageScore || student.avgScore || student.cgpa || 0),
      };

      const normalizedInvoices = invoiceRows.map((r) => {
        const amount = num(r.amount || r.totalAmount || r.billAmount || r.expectedAmount);
        const paid = num(r.paidAmount || r.amountPaid || r.settledAmount);
        const balance = Math.max(0, num(r.balance || r.balanceAmount || (amount - paid)));
        return {
          ...r,
          title: r.title || r.name || r.feeItem || r.description || "Fee Item",
          dueDate: fmtDate(r.dueDate || r.deadline || r.dateDue),
          amount,
          paid,
          balance,
          status:
            r.status || (balance <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid"),
        };
      });

      const normalizedPayments = paymentRows.map((r) => ({
        ...r,
        amount: num(r.amount || r.amountPaid || r.total),
        date: fmtDate(r.paymentDate || r.date || r.createdAt),
        method: r.method || r.paymentMethod || "—",
        reference: r.reference || r.receiptNo || r.transactionId || r.paymentRef || "—",
      }));

      const feesSummary = {
        billed: normalizedInvoices.reduce((sum, x) => sum + num(x.amount), 0),
        paid: normalizedPayments.reduce((sum, x) => sum + num(x.amount), 0),
      };
      feesSummary.balance = Math.max(0, feesSummary.billed - feesSummary.paid);

      log(
        "user:",
        user ? { id: user._id, email: user.email, roles: user.roles } : null
      );
      log(
        "parent:",
        parent
          ? { id: parent._id, email: parent.email, kids: (parent.childrenStudentIds || []).length }
          : null
      );
      log("student:", student ? { id: student._id, regNo: student.regNo, name: fullName(student) } : null);

      return res.render("tenant/parent/child-show", {
        tenant: req.tenant,
        user,
        parent,
        student: {
          ...student,
          fullName: fullName(student),
        },
        attendanceRows: attendanceRows.map((r) => ({
          ...r,
          date: fmtDate(r.date || r.createdAt),
          subject: r.subjectName || r.subject || r.courseName || r.course || "Class",
          teacher: r.teacherName || r.teacher || "—",
          status: String(r.status || "present").toLowerCase(),
          note: r.note || r.remarks || "—",
        })),
        attendanceSummary,
        resultRows: normalizedResults,
        resultsSummary,
        invoiceRows: normalizedInvoices,
        paymentRows: normalizedPayments,
        feesSummary,
        error: null,
      });
    } catch (err) {
      console.error("PARENT CHILD VIEW ERROR:", err);
      return res.status(500).send("Failed to load child detail page");
    }
  },
};
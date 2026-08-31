const { getParent, canAccessChild, loadLinkedChild } = require("./_helpers");
const { studentPublishedResultFilter } = require("../../../services/tenant/resultService");
const { studentAttendanceFilter, attendanceSummary: summarizeAttendance, formatInTimezone } = require("../../../services/tenant/attendanceService");
const { accountSnapshot } = require("../../../services/tenant/financeVisibilityService");

function num(v) {
  return Number(v || 0);
}

function fmtDate(v) {
  if (!v) return "";
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
      const { Student, Attendance, Result, Payment, Invoice } = req.models || {};
      const Exam = req.models?.Exam || null;
      const Subject = req.models?.Subject || null;

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const studentId = String(req.params?.id || "");
      if (!studentId || !canAccessChild(parent, studentId)) {
        return res.status(403).send("Forbidden");
      }

      const student = Student ? await loadLinkedChild(req, parent, studentId) : null;

      if (!student) {
        return res.status(404).send("Student not found");
      }

      const attendanceRows = Attendance
        ? await Attendance.find(studentAttendanceFilter(student._id))
            .populate({ path: "subject", select: "code title shortTitle" })
            .sort({ sessionAt: -1, createdAt: -1 })
            .limit(30)
            .lean()
            .catch(() => [])
        : [];

      let resultRows = [];
      if (Result && Exam && Subject) {
        try {
          let resultQuery = Result.find(studentPublishedResultFilter(student._id));
          resultQuery = resultQuery.populate({ path: "exam", model: Exam, select: "title code maxMarks passMark status" });
          resultQuery = resultQuery.populate({ path: "subject", model: Subject, select: "code title shortTitle" });
          resultRows = await resultQuery.sort({ publishedAt: -1, createdAt: -1 }).limit(20).lean();
        } catch {
          resultRows = [];
        }
      }

      const invoiceRows = Invoice
        ? await Invoice.find({
            studentId: student._id,
            isDeleted: { $ne: true },
            status: { $ne: "Draft" },
          })
            .sort({ dueDate: 1, issueDate: -1, createdAt: -1 })
            .limit(20)
            .lean()
            .catch(() => [])
        : [];

      const paymentRows = Payment
        ? await Payment.find({
            studentId: student._id,
            isDeleted: { $ne: true },
          })
            .sort({ paymentDate: -1, createdAt: -1 })
            .limit(20)
            .lean()
            .catch(() => [])
        : [];

      const attendanceBase = summarizeAttendance(attendanceRows);
      const attendanceSummary = {
        total: attendanceBase.total,
        present: attendanceBase.present,
        absent: attendanceBase.absent,
        late: attendanceBase.late,
        excused: attendanceBase.excused,
        rate: attendanceBase.total ? attendanceBase.rate : num(student.attendanceRate || 0),
      };

      const normalizedResults = resultRows.map((r) => ({
        ...r,
        subject: r.subject?.title || r.subject?.shortTitle || r.subject?.code || "Subject",
        exam: r.exam?.title || r.exam?.code || "Assessment",
        score: Number.isFinite(Number(r.percentage)) ? Number(r.percentage) : 0,
        grade: r.grade || "",
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
        const amount = num(r.totalAmount);
        const paid = num(r.paidAmount);
        const balance = Math.max(0, num(r.balance));
        return {
          ...r,
          title: r.title || r.description || "Invoice",
          dueDate: fmtDate(r.dueDate),
          amount,
          paid,
          balance,
          status: r.status || (balance <= 0 ? "Paid" : paid > 0 ? "Partially Paid" : "Unpaid"),
        };
      });

      const normalizedPayments = paymentRows.map((r) => ({
        ...r,
        amount: num(r.amount),
        date: fmtDate(r.paymentDate || r.createdAt),
        method: r.method || "-",
        reference: r.receiptNumber || r.reference || "-",
      }));

      const financeSnapshot = accountSnapshot(invoiceRows, paymentRows);
      const feesSummary = {
        billed: financeSnapshot.billed,
        paid: financeSnapshot.received,
        applied: financeSnapshot.applied,
        invoiceOutstanding: financeSnapshot.invoiceOutstanding,
        unallocatedCredit: financeSnapshot.unallocatedCredit,
        balance: financeSnapshot.balance,
        credit: financeSnapshot.credit,
      };

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

      return res.render("parents/child-show", {
        tenant: req.tenant,
        user,
        parent,
        student: {
          ...student,
          fullName: fullName(student),
        },
        attendanceRows: attendanceRows.map((r) => ({
          ...r,
          date: formatInTimezone(r.sessionAt || r.attendanceDate, req.tenant?.timezone || "UTC") || "—",
          subject: r.subject?.title || r.subject?.shortTitle || r.subject?.code || "Subject",
          teacher: r.teacher?.fullName || r.teacher?.name || "—",
          status: String(r.status || "present").toLowerCase(),
          note: r.notes || "—",
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
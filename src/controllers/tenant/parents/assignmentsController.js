const { getParent, canAccessChild } = require("./_helpers");
const {
  idText,
  formatInTimezone,
  assignmentVisibilityFilterForStudent,
} = require("../../../services/tenant/assignmentService");

function displayName(student = {}) {
  return student.fullName || [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") || student.regNo || "Student";
}

function assignmentRow(assignment = {}, submission = null, timezone = "UTC") {
  const course = assignment.course || {};
  const totalPoints = Number(assignment.totalPoints ?? 100);
  return {
    id: String(assignment._id || ""),
    title: assignment.title || "Assignment",
    subject: course.title || course.shortTitle || assignment.courseName || "Subject",
    subjectCode: course.code || "",
    academicYear: assignment.academicYear || "",
    term: Number(assignment.term || 1),
    dueDate: assignment.dueDate || null,
    dueDisplay: formatInTimezone(assignment.dueDate, timezone),
    status: assignment.status || "published",
    totalPoints,
    submissionStatus: submission?.status || "not_submitted",
    submittedAt: submission?.lastSubmittedAt || submission?.submittedAt || null,
    isLate: !!submission?.isLate,
    score: submission?.score ?? null,
    percentage: submission?.percentage ?? null,
    feedback: submission?.feedback || "",
    gradedAt: submission?.gradedAt || null,
  };
}

module.exports = {
  async index(req, res) {
    try {
      const { Student, Assignment, AssignmentSubmission, Subject } = req.models || {};
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const childIds = Array.isArray(parent?.childrenStudentIds) ? parent.childrenStudentIds : [];
      const children = parent && childIds.length
        ? await Student.find({ _id: { $in: childIds }, isDeleted: { $ne: true }, status: { $ne: "archived" } })
          .select("firstName middleName lastName fullName regNo studentNo classId className classLevel sectionId section streamId stream academicYear term status")
          .sort({ firstName: 1, lastName: 1, fullName: 1 })
          .lean()
        : [];

      const requestedId = String(req.query?.student || "").trim();
      let student = requestedId && canAccessChild(parent, requestedId)
        ? children.find((child) => String(child._id) === requestedId) || null
        : null;
      if (!student && children.length) student = children[0];

      if (!student) {
        return res.render("parents/assignments", {
          tenant: req.tenant, user, parent, children, student: null, assignments: [],
          kpis: { total: 0, open: 0, submitted: 0, graded: 0 },
          error: "No linked student found for this parent account.",
        });
      }
      if (!canAccessChild(parent, student._id)) return res.status(404).send("Not found.");

      let assignmentQuery = Assignment.find(assignmentVisibilityFilterForStudent(student));
      if (Subject) assignmentQuery = assignmentQuery.populate({ path: "course", model: Subject, select: "code title shortTitle" });
      const assignmentDocs = await assignmentQuery.sort({ dueDate: 1, createdAt: -1 }).lean();
      const assignmentIds = assignmentDocs.map((a) => a._id);
      const submissions = assignmentIds.length
        ? await AssignmentSubmission.find({ student: student._id, assignment: { $in: assignmentIds }, migrationQuarantinedAt: null }).lean()
        : [];
      const submissionByAssignment = new Map(submissions.map((s) => [idText(s.assignment), s]));
      const timezone = req.tenant?.timezone || "UTC";
      const assignments = assignmentDocs.map((a) => assignmentRow(a, submissionByAssignment.get(String(a._id)) || null, timezone));
      const now = Date.now();
      const kpis = {
        total: assignments.length,
        open: assignments.filter((a) => a.status === "published" && (!a.dueDate || new Date(a.dueDate).getTime() >= now)).length,
        submitted: assignments.filter((a) => ["submitted", "graded"].includes(a.submissionStatus)).length,
        graded: assignments.filter((a) => a.submissionStatus === "graded").length,
      };

      return res.render("parents/assignments", {
        tenant: req.tenant, user, parent, children, student, assignments, kpis, error: null,
        studentName: displayName(student),
      });
    } catch (err) {
      console.error("PARENT ASSIGNMENTS ERROR:", err);
      return res.status(500).send("Failed to load parent assignments page.");
    }
  },
  _test: { assignmentRow, displayName },
};

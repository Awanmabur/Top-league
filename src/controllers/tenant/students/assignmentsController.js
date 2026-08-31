const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  isObjId,
} = require("./_helpers");
const {
  str,
  idText,
  safeHttpUrl,
  normalizeUrlList,
  formatInTimezone,
  assignmentVisibilityFilterForStudent,
  assertStudentMatchesAssignmentScope,
  assertSubmissionAllowed,
  buildStudentSubmissionValues,
  withdrawSubmissionUpdate,
} = require("../../../services/tenant/assignmentService");

function requireModels(req) {
  const { Assignment, AssignmentSubmission, Student, Subject } = req.models || {};
  if (!Assignment || !AssignmentSubmission || !Student || !Subject) throw new Error("Assignment models are not fully loaded.");
  return { Assignment, AssignmentSubmission, Student, Subject, Notification: req.models.Notification || null };
}

function currentUserId(req, user) {
  return user?._id || req.user?.userId || null;
}

function attachmentInput(body = {}) {
  const raw = body.attachmentUrls ?? body["attachmentUrls[]"] ?? [];
  if (Array.isArray(raw)) return normalizeUrlList(raw, 10);
  return normalizeUrlList(String(raw || "").split(/\r?\n/), 10);
}

function rowFrom(assignment, submission, timezone) {
  const course = assignment.course || {};
  const dueDate = assignment.dueDate || null;
  const now = Date.now();
  const overdue = !!(dueDate && now > new Date(dueDate).getTime());
  const status = submission?.status || "not_submitted";
  return {
    id: String(assignment._id),
    title: assignment.title || "Assignment",
    courseCode: course.code || "",
    courseTitle: course.title || assignment.courseName || "Subject",
    className: assignment.className || "",
    sectionName: assignment.sectionName || "",
    streamName: assignment.streamName || "",
    academicYear: assignment.academicYear || "",
    term: Number(assignment.term || 1),
    totalPoints: Number(assignment.totalPoints ?? 100),
    instructions: assignment.instructions || "",
    dueDate,
    dueDisplay: formatInTimezone(dueDate, timezone),
    overdue,
    allowLateSubmissions: !!assignment.allowLateSubmissions,
    assignmentStatus: assignment.status || "published",
    submissionStatus: status,
    submittedAt: submission?.lastSubmittedAt || submission?.submittedAt || null,
    isLate: !!submission?.isLate,
    score: submission?.score ?? null,
    percentage: submission?.percentage ?? null,
    feedback: submission?.feedback || "",
    canSubmit: assignment.status === "published" && (!overdue || assignment.allowLateSubmissions) && status !== "graded",
  };
}

async function loadStudentContext(req) {
  const models = requireModels(req);
  const got = await getStudent(req);
  if (!got?.user) return { ...models, user: null, student: null };
  return { ...models, user: got.user, student: got.student };
}

async function adminSubmissionNotice(Notification, assignment, student, submission) {
  if (!Notification) return;
  await Notification.findOneAndUpdate(
    { audience: "admin", userId: null, entityType: "assignment_submission", entityId: submission._id, entityAction: "submitted" },
    { $set: {
      title: "Assignment submitted",
      message: `${student.fullName || student.regNo || "A student"} submitted ${assignment.title || "an assignment"}.`,
      type: submission.isLate ? "warning" : "info",
      url: `/admin/assignments/${assignment._id}/submissions`,
      isDeleted: false,
      deletedAt: null,
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

module.exports = {
  assignments: async (req, res) => {
    try {
      const { Assignment, AssignmentSubmission, user, student } = await loadStudentContext(req);
      if (!user) return res.redirect("/login");
      const blocked = mustHaveStudent(res, { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "Assignments" }, "students/assignments");
      if (blocked) return blocked;

      const assignments = await Assignment.find(assignmentVisibilityFilterForStudent(student))
        .populate({ path: "course", select: "code title shortTitle" })
        .sort({ dueDate: 1, createdAt: -1 })
        .lean();
      const ids = assignments.map((a) => a._id);
      const submissions = ids.length
        ? await AssignmentSubmission.find({ student: student._id, assignment: { $in: ids }, migrationQuarantinedAt: null }).lean()
        : [];
      const byAssignment = new Map(submissions.map((s) => [idText(s.assignment), s]));
      const timezone = req.tenant?.timezone || "UTC";
      const rows = assignments.map((a) => rowFrom(a, byAssignment.get(String(a._id)) || null, timezone));
      const now = Date.now();
      const dueSoon = rows.filter((r) => r.dueDate && new Date(r.dueDate).getTime() >= now && new Date(r.dueDate).getTime() - now <= 7 * 86400000).length;

      return renderView(req, res, "students/assignments", {
        pageTitle: "Assignments",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta: academicMeta(student),
        assignments: rows,
        kpis: {
          total: rows.length,
          dueSoon,
          submitted: rows.filter((r) => ["submitted", "graded"].includes(r.submissionStatus)).length,
          graded: rows.filter((r) => r.submissionStatus === "graded").length,
          open: rows.filter((r) => r.canSubmit).length,
        },
      });
    } catch (err) {
      console.error("STUDENT ASSIGNMENTS ERROR:", err);
      return res.status(500).send("Failed to load assignments.");
    }
  },

  detail: async (req, res) => {
    try {
      const { Assignment, AssignmentSubmission, user, student } = await loadStudentContext(req);
      if (!user) return res.redirect("/login");
      if (!student) return res.status(403).send("Student profile not found.");
      const id = str(req.params.id, 80);
      if (!isObjId(id)) return res.status(404).send("Assignment not found.");
      const assignment = await Assignment.findOne({ _id: id, ...assignmentVisibilityFilterForStudent(student) })
        .populate({ path: "course", select: "code title shortTitle" })
        .lean();
      if (!assignment) return res.status(404).send("Assignment not found.");
      assertStudentMatchesAssignmentScope(student, assignment);
      const submission = await AssignmentSubmission.findOne({ assignment: id, student: student._id, migrationQuarantinedAt: null }).lean();
      const data = rowFrom(assignment, submission, req.tenant?.timezone || "UTC");
      data.instructions = assignment.instructions || "";
      data.rubric = assignment.rubric || "";
      data.attachments = (assignment.attachments || []).map(safeHttpUrl).filter(Boolean);
      data.submission = submission ? {
        id: String(submission._id), text: submission.text || "", attachmentUrls: (submission.attachmentUrls || []).map(safeHttpUrl).filter(Boolean),
        status: submission.status, submittedAt: submission.submittedAt, lastSubmittedAt: submission.lastSubmittedAt, revision: Number(submission.revision || 0),
        isLate: !!submission.isLate, score: submission.score ?? null, percentage: submission.percentage ?? null, feedback: submission.feedback || "", gradedAt: submission.gradedAt || null,
      } : null;
      return renderView(req, res, "students/assignment-detail", { pageTitle: assignment.title || "Assignment", user, student, studentName: getStudentDisplayName(student, user), meta: academicMeta(student), assignment: data, csrfToken: res.locals.csrfToken || null });
    } catch (err) {
      console.error("STUDENT ASSIGNMENT DETAIL ERROR:", err);
      return res.status(500).send("Failed to load assignment.");
    }
  },

  submit: async (req, res) => {
    const assignmentId = str(req.params.id, 80);
    try {
      const { Assignment, AssignmentSubmission, Notification, user, student } = await loadStudentContext(req);
      if (!user) return res.redirect("/login");
      if (!student || !isObjId(assignmentId)) throw new Error("Assignment not found.");
      const assignment = await Assignment.findOne({ _id: assignmentId, isDeleted: { $ne: true }, migrationQuarantinedAt: null }).lean();
      if (!assignment) throw new Error("Assignment not found.");
      const current = await AssignmentSubmission.findOne({ assignment: assignmentId, student: student._id, migrationQuarantinedAt: null }).lean();
      const values = buildStudentSubmissionValues({ assignment, student, current, text: req.body.text, attachmentUrls: attachmentInput(req.body), actorId: currentUserId(req, user), now: new Date() });
      let submission;
      if (!current) {
        try {
          submission = await AssignmentSubmission.create({ ...values, createdBy: currentUserId(req, user), updatedBy: currentUserId(req, user), migrationQuarantinedAt: null });
        } catch (err) {
          if (err?.code === 11000) throw new Error("A submission was created in another session. Reload before resubmitting.");
          throw err;
        }
      } else {
        const result = await AssignmentSubmission.updateOne(
          { _id: current._id, status: current.status, revision: Number(current.revision || 0), gradeRevision: Number(current.gradeRevision || 0), migrationQuarantinedAt: null },
          { $set: { ...values, updatedBy: currentUserId(req, user), updatedAt: new Date() } },
          { runValidators: true }
        );
        if (result.modifiedCount !== 1) throw new Error("Submission changed in another session. Reload before resubmitting.");
        submission = { ...current, ...values, _id: current._id };
      }
      await adminSubmissionNotice(Notification, assignment, student, submission).catch((e) => console.error("SUBMISSION NOTIFICATION ERROR:", e));
      req.flash?.("success", values.revision > 0 ? "Assignment resubmitted." : "Assignment submitted.");
    } catch (err) {
      console.error("STUDENT ASSIGNMENT SUBMIT ERROR:", err);
      req.flash?.("error", err.message || "Failed to submit assignment.");
    }
    return res.redirect(`/student/assignments/${encodeURIComponent(assignmentId)}`);
  },

  withdraw: async (req, res) => {
    const assignmentId = str(req.params.id, 80);
    try {
      const { Assignment, AssignmentSubmission, user, student } = await loadStudentContext(req);
      if (!user) return res.redirect("/login");
      if (!student || !isObjId(assignmentId)) throw new Error("Assignment not found.");
      const [assignment, current] = await Promise.all([
        Assignment.findOne({ _id: assignmentId, isDeleted: { $ne: true }, migrationQuarantinedAt: null }).lean(),
        AssignmentSubmission.findOne({ assignment: assignmentId, student: student._id, migrationQuarantinedAt: null }).lean(),
      ]);
      if (!assignment || !current) throw new Error("Submission not found.");
      assertSubmissionAllowed(assignment, student, current, new Date());
      const update = withdrawSubmissionUpdate(current, currentUserId(req, user), new Date());
      const result = await AssignmentSubmission.updateOne({ _id: current._id, status: "submitted", revision: Number(current.revision || 0) }, { $set: { ...update, updatedAt: new Date() } });
      if (result.modifiedCount !== 1) throw new Error("Submission changed in another session. Reload and try again.");
      req.flash?.("success", "Submission withdrawn. You can submit a revision while the assignment remains open.");
    } catch (err) {
      console.error("STUDENT ASSIGNMENT WITHDRAW ERROR:", err);
      req.flash?.("error", err.message || "Failed to withdraw submission.");
    }
    return res.redirect(`/student/assignments/${encodeURIComponent(assignmentId)}`);
  },

  _test: { attachmentInput, rowFrom },
};

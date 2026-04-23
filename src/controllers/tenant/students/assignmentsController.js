const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  courseCodeFromAny,
  courseTitleFromAny,
  num,
} = require("./_helpers");

module.exports = {
  assignments: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Assignment } = req.models;
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
          pageTitle: "Assignments",
        },
        "students/assignments"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const assignments = Assignment
        ? await Assignment.find({
            $or: [
              { studentId: student._id },
              { assignedToStudents: student._id },
              { classId: student.classId || null },
              { programId: student.programId || null },
            ],
          })
            .sort({ dueDate: 1, deadline: 1, createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const rows = assignments.map((a) => ({
        id: String(a._id),
        title: a.title || a.name || "Assignment",
        courseCode: courseCodeFromAny(a),
        courseTitle: courseTitleFromAny(a),
        dueDate: a.dueDate || a.deadline || null,
        status: a.status || "Open",
        weight: num(a.weight ?? a.marks ?? 0),
        type: a.type || "Coursework",
        submissionMode: a.submissionMode || a.mode || "Portal",
      }));

      const now = new Date();
      const dueSoon = rows.filter((r) => {
        if (!r.dueDate) return false;
        const diff = new Date(r.dueDate).getTime() - now.getTime();
        return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
      }).length;

      return renderView(req, res, "students/assignments", {
        pageTitle: "Assignments",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        assignments: rows,
        kpis: {
          total: rows.length,
          dueSoon,
          submitted: rows.filter((r) => ["submitted", "graded", "closed"].includes(String(r.status).toLowerCase())).length,
          open: rows.filter((r) => !["submitted", "graded", "closed"].includes(String(r.status).toLowerCase())).length,
        },
      });
    } catch (err) {
      return res.status(500).send("Failed to load assignments: " + err.message);
    }
  },
};
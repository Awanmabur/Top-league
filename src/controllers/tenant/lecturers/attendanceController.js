const { getLecturer, isValidId } = require("./_helpers");

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

module.exports = {
  async page(req, res) {
    try {
      const { ClassSection, Student, Enrollment, Attendance } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classSectionId = req.params.classSectionId;
      if (!isValidId(classSectionId)) return res.status(404).send("Invalid class section id");

      const section = ClassSection ? await ClassSection.findById(classSectionId).lean().catch(() => null) : null;

      // Roster strategy:
      // 1) If Enrollment exists: Enrollment -> studentIds
      // 2) else fallback: Student.classSectionId
      let roster = [];
      if (Enrollment && Student) {
        const enrolls = await Enrollment.find({ classSectionId }).lean().catch(() => []);
        const ids = enrolls.map(e => e.studentId).filter(Boolean);
        roster = ids.length ? await Student.find({ _id: { $in: ids } }).sort({ firstName: 1 }).lean().catch(() => []) : [];
      } else if (Student) {
        roster = await Student.find({ classSectionId }).sort({ firstName: 1 }).lean().catch(() => []);
      }

      const existing = Attendance
        ? await Attendance.find({ classSectionId, date: { $gte: startOfToday() } }).lean().catch(() => [])
        : [];

      return res.render("tenant/lecturer/attendance", {
        tenant: req.tenant,
        user,
        lecturer,
        section,
        roster,
        existing,
        error: null
      });
    } catch (err) {
      console.error("LECTURER ATTENDANCE PAGE ERROR:", err);
      return res.status(500).send("Failed to load attendance");
    }
  },

  async save(req, res) {
    try {
      const { Attendance } = req.models || {};
      const { user } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classSectionId = req.params.classSectionId;
      if (!isValidId(classSectionId)) return res.status(404).send("Invalid class section id");
      if (!Attendance) return res.status(500).send("Attendance model missing");

      // Expected payload: status[studentId] = present|absent|late
      const statusMap = req.body.status || {};
      const date = startOfToday();

      const ops = Object.entries(statusMap).map(([studentId, status]) => ({
        updateOne: {
          filter: { classSectionId, studentId, date },
          update: { $set: { classSectionId, studentId, date, status } },
          upsert: true
        }
      }));

      if (ops.length) await Attendance.bulkWrite(ops).catch(() => {});
      return res.redirect(`/lecturer/attendance/${classSectionId}`);
    } catch (err) {
      console.error("LECTURER ATTENDANCE SAVE ERROR:", err);
      return res.status(500).send("Failed to save attendance");
    }
  }
};

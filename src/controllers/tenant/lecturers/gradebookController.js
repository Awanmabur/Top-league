const { getLecturer, isValidId } = require("./_helpers");

module.exports = {
  async page(req, res) {
    try {
      const { ClassSection, Student, Enrollment, Grade } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classSectionId = req.params.classSectionId;
      if (!isValidId(classSectionId)) return res.status(404).send("Invalid class section id");

      const section = ClassSection ? await ClassSection.findById(classSectionId).lean().catch(() => null) : null;

      let roster = [];
      if (Enrollment && Student) {
        const enrolls = await Enrollment.find({ classSectionId }).lean().catch(() => []);
        const ids = enrolls.map(e => e.studentId).filter(Boolean);
        roster = ids.length ? await Student.find({ _id: { $in: ids } }).sort({ firstName: 1 }).lean().catch(() => []) : [];
      } else if (Student) {
        roster = await Student.find({ classSectionId }).sort({ firstName: 1 }).lean().catch(() => []);
      }

      const grades = Grade ? await Grade.find({ classSectionId }).lean().catch(() => []) : [];

      return res.render("tenant/lecturer/gradebook", {
        tenant: req.tenant,
        user,
        lecturer,
        section,
        roster,
        grades,
        error: null
      });
    } catch (err) {
      console.error("LECTURER GRADEBOOK PAGE ERROR:", err);
      return res.status(500).send("Failed to load gradebook");
    }
  },

  async save(req, res) {
    try {
      const { Grade } = req.models || {};
      const { user } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classSectionId = req.params.classSectionId;
      if (!isValidId(classSectionId)) return res.status(404).send("Invalid class section id");
      if (!Grade) return res.status(500).send("Grade model missing");

      // Expected: score[studentId] = number
      const scoreMap = req.body.score || {};

      const ops = Object.entries(scoreMap).map(([studentId, score]) => ({
        updateOne: {
          filter: { classSectionId, studentId },
          update: { $set: { classSectionId, studentId, score: Number(score) || 0 } },
          upsert: true
        }
      }));

      if (ops.length) await Grade.bulkWrite(ops).catch(() => {});
      return res.redirect(`/lecturer/gradebook/${classSectionId}`);
    } catch (err) {
      console.error("LECTURER GRADEBOOK SAVE ERROR:", err);
      return res.status(500).send("Failed to save gradebook");
    }
  }
};

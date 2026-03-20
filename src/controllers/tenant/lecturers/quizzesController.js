const { getLecturer, isValidId } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { ClassSection, Quiz } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classSectionId = req.params.classSectionId;
      if (!isValidId(classSectionId)) return res.status(404).send("Invalid class section id");

      const section = ClassSection ? await ClassSection.findById(classSectionId).lean().catch(() => null) : null;
      const items = Quiz
        ? await Quiz.find({ classSectionId }).sort({ createdAt: -1 }).lean().catch(() => [])
        : [];

      return res.render("tenant/lecturer/quizzes", {
        tenant: req.tenant,
        user,
        lecturer,
        section,
        items,
        error: null
      });
    } catch (err) {
      console.error("LECTURER QUIZZES LIST ERROR:", err);
      return res.status(500).send("Failed to load quizzes");
    }
  },

  async create(req, res) {
    try {
      const { Quiz } = req.models || {};
      const { user } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classSectionId = req.params.classSectionId;
      if (!isValidId(classSectionId)) return res.status(404).send("Invalid class section id");
      if (!Quiz) return res.status(500).send("Quiz model missing");

      const title = String(req.body.title || "").trim();
      const startsAt = req.body.startsAt ? new Date(req.body.startsAt) : null;
      const endsAt = req.body.endsAt ? new Date(req.body.endsAt) : null;

      if (!title) return res.redirect(`/lecturer/quizzes/${classSectionId}`);

      await Quiz.create({
        classSectionId,
        title,
        startsAt,
        endsAt,
        createdByUserId: user._id,
        createdAt: new Date()
      });

      return res.redirect(`/lecturer/quizzes/${classSectionId}`);
    } catch (err) {
      console.error("LECTURER QUIZZES CREATE ERROR:", err);
      return res.status(500).send("Failed to create quiz");
    }
  }
};

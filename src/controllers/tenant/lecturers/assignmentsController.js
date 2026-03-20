const { getLecturer, isValidId } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { ClassSection, Assignment } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classSectionId = req.params.classSectionId;
      if (!isValidId(classSectionId)) return res.status(404).send("Invalid class section id");

      const section = ClassSection ? await ClassSection.findById(classSectionId).lean().catch(() => null) : null;
      const items = Assignment
        ? await Assignment.find({ classSectionId }).sort({ dueDate: 1 }).lean().catch(() => [])
        : [];

      return res.render("tenant/lecturer/assignments", {
        tenant: req.tenant,
        user,
        lecturer,
        section,
        items,
        error: null
      });
    } catch (err) {
      console.error("LECTURER ASSIGNMENTS LIST ERROR:", err);
      return res.status(500).send("Failed to load assignments");
    }
  },

  async create(req, res) {
    try {
      const { Assignment } = req.models || {};
      const { user } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classSectionId = req.params.classSectionId;
      if (!isValidId(classSectionId)) return res.status(404).send("Invalid class section id");
      if (!Assignment) return res.status(500).send("Assignment model missing");

      const title = String(req.body.title || "").trim();
      const instructions = String(req.body.instructions || "").trim();
      const dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;

      if (!title) return res.redirect(`/lecturer/assignments/${classSectionId}`);

      await Assignment.create({
        classSectionId,
        title,
        instructions: instructions || null,
        dueDate,
        createdByUserId: user._id,
        createdAt: new Date()
      });

      return res.redirect(`/lecturer/assignments/${classSectionId}`);
    } catch (err) {
      console.error("LECTURER ASSIGNMENTS CREATE ERROR:", err);
      return res.status(500).send("Failed to create assignment");
    }
  }
};

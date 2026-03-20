const { getLecturer, isValidId } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { ClassSection, Material } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classSectionId = req.params.classSectionId;
      if (!isValidId(classSectionId)) return res.status(404).send("Invalid class section id");

      const section = ClassSection ? await ClassSection.findById(classSectionId).lean().catch(() => null) : null;
      const items = Material
        ? await Material.find({ classSectionId }).sort({ createdAt: -1 }).lean().catch(() => [])
        : [];

      return res.render("tenant/lecturer/materials", {
        tenant: req.tenant,
        user,
        lecturer,
        section,
        items,
        error: null
      });
    } catch (err) {
      console.error("LECTURER MATERIALS LIST ERROR:", err);
      return res.status(500).send("Failed to load materials");
    }
  },

  async create(req, res) {
    try {
      const { Material } = req.models || {};
      const { user } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classSectionId = req.params.classSectionId;
      if (!isValidId(classSectionId)) return res.status(404).send("Invalid class section id");
      if (!Material) return res.status(500).send("Material model missing");

      const title = String(req.body.title || "").trim();
      const url = String(req.body.url || "").trim();
      const description = String(req.body.description || "").trim();

      if (!title) return res.redirect(`/lecturer/materials/${classSectionId}`);

      await Material.create({
        classSectionId,
        title,
        url: url || null,
        description: description || null,
        createdByUserId: user._id,
        createdAt: new Date()
      });

      return res.redirect(`/lecturer/materials/${classSectionId}`);
    } catch (err) {
      console.error("LECTURER MATERIALS CREATE ERROR:", err);
      return res.status(500).send("Failed to create material");
    }
  }
};

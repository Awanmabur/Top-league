const { getParent, loadLinkedChildren } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { Student } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const children = await loadLinkedChildren(req, parent);


      return res.render("parents/children", {
        tenant: req.tenant,
        user,
        parent,
        children,
        pageStats: {
          totalChildren: children.length,
        },
      });
    } catch (err) {
      console.error("PARENT CHILDREN ERROR:", err);
      return res.status(500).send("Failed to load parent children page");
    }
  },
};

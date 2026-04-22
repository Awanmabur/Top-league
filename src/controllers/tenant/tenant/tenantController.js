module.exports = {
  index: async (req, res) => {
    const tenant = req.tenant;

    if (!tenant) {
      return res.status(404).send("School not found (tenant missing)");
    }

    res.render("tenant/public/index", { tenant }, (err, html) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Render error");
      }

      return res.send(html);
    });
  }
};

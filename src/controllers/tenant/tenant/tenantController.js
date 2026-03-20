module.exports = {
  index: async (req, res) => {
    const started = Date.now();

    const tenant = req.tenant;

    if (!tenant) {
      return res.status(404).send("University not found (tenant missing)");
    }

    console.log("controller before render ms:", Date.now() - started);

    res.render("tenant/public/index", { tenant }, (err, html) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Render error");
      }

      console.log("render ms:", Date.now() - started);
      return res.send(html);
    });
  }
};
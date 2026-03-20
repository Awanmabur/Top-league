const multer = require("multer");
const path = require("path");
const fs = require("fs");

module.exports = function applicantUploader(req, res, next) {
  const tenantCode = req.tenant.code;

  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      const folder = `uploads/${tenantCode}/admissions`;
      fs.mkdirSync(folder, { recursive: true });
      cb(null, folder);
    },
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname);
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, unique + ext);
    },
  });

  const upload = multer({ storage }).array("documents", 10);

  return upload(req, res, next);
};

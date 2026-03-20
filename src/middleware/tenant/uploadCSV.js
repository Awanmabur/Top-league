const multer = require("multer");

const upload = multer({ dest: "uploads/csv/" });

module.exports = upload.single("csvFile");

const multer = require("multer");
module.exports = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

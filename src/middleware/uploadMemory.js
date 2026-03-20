const multer = require("multer");

const storage = multer.memoryStorage();

module.exports = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB each
});

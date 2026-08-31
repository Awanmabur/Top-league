const multer = require("multer");

const storage = multer.memoryStorage();
const allowed = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
  "image/webp",
]);

module.exports = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (allowed.has(file.mimetype)) return cb(null, true);
    return cb(new Error("Only PDF, JPG, PNG, or WEBP files are allowed"), false);
  },
});
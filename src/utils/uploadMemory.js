const multer = require("multer");
const { boundedMemoryStorage } = require("../middleware/boundedMemoryStorage");

const allowed = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
  "image/webp",
]);

module.exports = multer({
  storage: boundedMemoryStorage({ maxTotalBytes: 24 * 1024 * 1024 }),
  limits: { fileSize: 15 * 1024 * 1024, files: 5, fields: 40, parts: 45, fieldSize: 256 * 1024, fieldNestingDepth: 3, headerPairs: 100, fieldArrayIndexLimit: 100 },
  fileFilter(_req, file, cb) {
    return allowed.has(String(file?.mimetype || "").toLowerCase())
      ? cb(null, true)
      : (() => { const error = new Error("Only PDF, JPG, PNG, or WEBP files are allowed"); error.status = 415; error.code = "UNSUPPORTED_UPLOAD_TYPE"; return cb(error, false); })();
  },
});

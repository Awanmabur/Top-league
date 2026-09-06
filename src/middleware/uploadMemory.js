const multer = require("multer");
const { boundedMemoryStorage } = require("./boundedMemoryStorage");

const storage = boundedMemoryStorage({ maxTotalBytes: 40 * 1024 * 1024 });
const allowed = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",
  "image/webp",
]);

module.exports = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 12, fields: 80, parts: 92, fieldSize: 256 * 1024, fieldNestingDepth: 3, headerPairs: 100, fieldArrayIndexLimit: 100 },
  fileFilter(req, file, cb) {
    if (allowed.has(file.mimetype)) return cb(null, true);
    return (() => { const error = new Error("Only PDF, JPG, PNG, or WEBP files are allowed"); error.status = 415; error.code = "UNSUPPORTED_UPLOAD_TYPE"; return cb(error, false); })();
  },
});
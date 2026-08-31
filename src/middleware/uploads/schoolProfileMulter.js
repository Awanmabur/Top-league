const multer = require("multer");
const { boundedMemoryStorage } = require("../boundedMemoryStorage");

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
function imageFileFilter(req, file, cb) {
  if (!ALLOWED_IMAGE_TYPES.has(String(file?.mimetype || "").toLowerCase())) {
    const error = new Error("Only JPG/PNG/WEBP images are allowed");
    error.status = 415;
    error.code = "UNSUPPORTED_UPLOAD_TYPE";
    return cb(error, false);
  }
  return cb(null, true);
}
const base = multer({ storage: boundedMemoryStorage({ maxTotalBytes: 30 * 1024 * 1024 }), limits: { fileSize: 5 * 1024 * 1024, files: 12, fields: 80, parts: 92, fieldSize: 256 * 1024, fieldNestingDepth: 3, headerPairs: 100, fieldArrayIndexLimit: 100 }, fileFilter: imageFileFilter });
module.exports = {
  logoUpload: base.single("logo"),
  faviconUpload: base.single("favicon"),
  coverUpload: base.single("cover"),
  galleryUpload: base.array("gallery", 12),
};

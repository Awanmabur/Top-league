const multer = require("multer");

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
function imageFileFilter(req, file, cb) {
  if (!ALLOWED_IMAGE_TYPES.has(String(file?.mimetype || "").toLowerCase())) return cb(new Error("Only JPG/PNG/WEBP images are allowed"), false);
  return cb(null, true);
}
const base = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 12 }, fileFilter: imageFileFilter });
module.exports = {
  logoUpload: base.single("logo"),
  faviconUpload: base.single("favicon"),
  coverUpload: base.single("cover"),
  galleryUpload: base.array("gallery", 12),
};

const multer = require("multer");

const base = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB each
});

module.exports = {
  logoUpload: base.single("logo"),
  coverUpload: base.single("cover"),
  galleryUpload: base.array("gallery", 24), // ? matches fd.append("gallery", file)
};
const multer = require("multer");

const MAX_MB = 10;

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  const ok = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/jpg",
  ].includes(file.mimetype);

  if (!ok) return cb(new Error("Only PDF/JPG/PNG allowed"), false);
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

const applicantUploads = upload.fields([
  { name: "passportPhoto", maxCount: 1 },
  { name: "idDocument", maxCount: 1 },
  { name: "transcript", maxCount: 1 },
  { name: "otherDocs", maxCount: 8 },
]);

module.exports = { applicantUploads };
const { csrfMultipartProtection } = require("./tenant/csrf");
const multer = require("multer");
const { boundedMemoryStorage } = require("./boundedMemoryStorage");

const CSV_MIME_TYPES = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
  "application/octet-stream", // Some browsers/OSes use this for .csv uploads.
]);

function createCsvUpload({ maxBytes = 2 * 1024 * 1024 } = {}) {
  const boundedBytes = Math.max(64 * 1024, Math.min(Number(maxBytes) || 0, 10 * 1024 * 1024));
  return multer({
    storage: boundedMemoryStorage({ maxTotalBytes: boundedBytes }),
    limits: {
      fileSize: boundedBytes,
      files: 1,
      fields: 10,
      parts: 11,
      fieldSize: 64 * 1024,
      fieldNestingDepth: 2,
      headerPairs: 100,
      fieldArrayIndexLimit: 20,
    },
    // Keep this synchronous. Multer <2.3.0 had an async fileFilter/file-size
    // race; current releases are patched, and sync validation avoids that class
    // of bug even if a future dependency downgrade occurs accidentally.
    fileFilter(_req, file, cb) {
      const mime = String(file?.mimetype || "").trim().toLowerCase();
      const name = String(file?.originalname || "").trim().toLowerCase();
      if (!name.endsWith(".csv") || !CSV_MIME_TYPES.has(mime)) {
        const error = new Error("Only CSV files are allowed.");
        error.status = 415;
        error.code = "UNSUPPORTED_UPLOAD_TYPE";
        return cb(error, false);
      }
      return cb(null, true);
    },
  });
}

function validateCsvUpload(req, res, next) {
  return csrfMultipartProtection(req, res, (csrfErr) => {
    if (csrfErr) return next(csrfErr);
    const file = req.file;
  if (!file?.buffer) return next(); // Controllers preserve their existing required-file UX.

  const buffer = file.buffer;
  if (!buffer.length) return next(new Error("The CSV file is empty."));
  if (buffer.includes(0x00)) return next(new Error("The CSV file contains binary data."));

  try {
    // Reject malformed UTF-8 rather than allowing replacement characters to
    // alter identifiers, email addresses or spreadsheet fields silently.
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return next(new Error("The CSV file must use UTF-8 text encoding."));
  }

  // Permit tab/CR/LF; reject other C0 controls that do not belong in CSV text.
  let badControls = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 128 * 1024));
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) badControls += 1;
    if (badControls > 4) return next(new Error("The CSV file contains invalid control characters."));
  }

    return next();
  });
}

module.exports = { createCsvUpload, validateCsvUpload, CSV_MIME_TYPES };

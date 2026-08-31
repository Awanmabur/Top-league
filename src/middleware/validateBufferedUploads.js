const { csrfMultipartProtection } = require("./tenant/csrf");
const path = require("path");

const MIME_BY_KIND = Object.freeze({
  pdf: new Set(["application/pdf"]),
  jpeg: new Set(["image/jpeg", "image/jpg"]),
  png: new Set(["image/png"]),
  webp: new Set(["image/webp"]),
});

const EXT_BY_KIND = Object.freeze({
  pdf: new Set([".pdf"]),
  jpeg: new Set([".jpg", ".jpeg"]),
  png: new Set([".png"]),
  webp: new Set([".webp"]),
});

function detectKind(buffer) {
  if (!Buffer.isBuffer(buffer)) return "";
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return "png";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "webp";
  return "";
}

function imageDimensions(buffer, kind) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (kind === "png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (kind === "jpeg") {
    let offset = 2;
    while (offset + 9 < buffer.length && offset < 1024 * 1024) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      if (marker === 0xda) break;
      if (offset + 4 > buffer.length) break;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 7) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  if (kind === "webp" && buffer.length >= 30) {
    const chunk = buffer.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      const payload = 20;
      if (
        buffer[payload + 3] === 0x9d
        && buffer[payload + 4] === 0x01
        && buffer[payload + 5] === 0x2a
      ) {
        return {
          width: buffer.readUInt16LE(payload + 6) & 0x3fff,
          height: buffer.readUInt16LE(payload + 8) & 0x3fff,
        };
      }
    }
    if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
      const bits = (
        buffer[21]
        | (buffer[22] << 8)
        | (buffer[23] << 16)
        | (buffer[24] << 24)
      ) >>> 0;
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
  }
  return null;
}

function flattenFiles(req) {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files && typeof req.files === "object") {
    for (const value of Object.values(req.files)) {
      if (Array.isArray(value)) files.push(...value);
      else if (value) files.push(value);
    }
  }
  return files;
}

function assertBufferedFile(file, { imageOnly = false, maxImagePixels = 40_000_000 } = {}) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) throw new Error("Uploaded file content is unavailable.");
  const kind = detectKind(file.buffer);
  if (!kind) throw new Error("Uploaded file content does not match an allowed PDF/image type.");
  if (imageOnly && kind === "pdf") throw new Error("Only JPG, PNG, or WEBP images are allowed.");
  if (kind === "pdf") {
    const tail = file.buffer.subarray(Math.max(0, file.buffer.length - 4096)).toString("latin1");
    if (!tail.includes("%%EOF")) throw new Error("Uploaded PDF is incomplete or malformed.");
  }

  const mime = String(file.mimetype || "").trim().toLowerCase();
  const ext = path.extname(String(file.originalname || "")).trim().toLowerCase();
  if (!MIME_BY_KIND[kind]?.has(mime) || !EXT_BY_KIND[kind]?.has(ext)) {
    throw new Error("Uploaded file extension, MIME type, and file content do not match.");
  }

  if (kind !== "pdf") {
    const dims = imageDimensions(file.buffer, kind);
    if (dims) {
      const width = Number(dims.width || 0);
      const height = Number(dims.height || 0);
      if (!width || !height || width > 20_000 || height > 20_000 || width * height > maxImagePixels) {
        throw new Error("Uploaded image dimensions are too large.");
      }
    }
  }
  return kind;
}

function validateBufferedUploads(options = {}) {
  return function bufferedUploadValidation(req, res, next) {
    csrfMultipartProtection(req, res, (csrfErr) => {
      if (csrfErr) return next(csrfErr);
      try {
      for (const file of flattenFiles(req)) assertBufferedFile(file, options);
        next();
      } catch (err) {
        err.status = 400;
        next(err);
      }
    });
  };
}

module.exports = {
  detectKind,
  imageDimensions,
  assertBufferedFile,
  validateBufferedUploads,
};

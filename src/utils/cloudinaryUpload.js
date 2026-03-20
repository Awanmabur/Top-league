const cloudinary = require("../config/cloudinary");

/**
 * Upload a multer memoryStorage file buffer to cloudinary.
 */
function uploadBuffer(file, folder, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!file || !file.buffer) {
        return reject(
          new Error("Missing file buffer (multer must use memoryStorage)"),
        );
      }

      const uploadOpts = {
        folder,
        resource_type: "image", // ✅ for gallery (better than auto)
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        ...options,
      };

      const stream = cloudinary.uploader.upload_stream(
        uploadOpts,
        (err, result) => {
          if (err) {
            // ✅ Extract the REAL message
            const msg =
              err.message ||
              (err.error && err.error.message) ||
              (typeof err === "string" ? err : null) ||
              "Cloudinary upload error";

            const e = new Error(msg);
            e.http_code = err.http_code || (err.error && err.error.http_code);
            e.name = err.name || "CloudinaryError";
            return reject(e);
          }

          if (!result)
            return reject(new Error("Cloudinary returned empty result"));
          resolve(result);
        },
      );

      stream.end(file.buffer);
    } catch (e) {
      reject(e);
    }
  });
}

async function safeDestroy(publicId, resourceType = "image") {
  try {
    if (!publicId) return;
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
  } catch (e) {
    // keep silent
  }
}

module.exports = { uploadBuffer, safeDestroy };

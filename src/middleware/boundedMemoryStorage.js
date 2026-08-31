const TOTAL_BYTES = Symbol("classicUploadTotalBytes");

function safeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/**
 * Multer-compatible in-memory storage with a request-wide aggregate byte cap.
 * Multer's fileSize limit is per file; without this guard a multi-file request
 * can legitimately allocate fileSize * files bytes before controller logic runs.
 */
function boundedMemoryStorage({ maxTotalBytes = 32 * 1024 * 1024 } = {}) {
  const aggregateLimit = safeInt(maxTotalBytes, 32 * 1024 * 1024, 64 * 1024, 256 * 1024 * 1024);

  return {
    _handleFile(req, file, cb) {
      const chunks = [];
      let size = 0;
      let completed = false;
      let aggregateError = null;

      if (!Number.isFinite(req[TOTAL_BYTES])) req[TOTAL_BYTES] = 0;

      const finish = (error, info) => {
        if (completed) return;
        completed = true;
        cb(error, info);
      };

      file.stream.on("data", (chunk) => {
        if (aggregateError) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const nextTotal = Number(req[TOTAL_BYTES] || 0) + buffer.length;
        req[TOTAL_BYTES] = nextTotal;
        size += buffer.length;

        if (nextTotal > aggregateLimit) {
          chunks.length = 0;
          aggregateError = new Error("Combined uploaded files are too large.");
          aggregateError.code = "LIMIT_TOTAL_FILE_SIZE";
          aggregateError.status = 413;
          return;
        }
        chunks.push(buffer);
      });

      file.stream.once("error", (error) => finish(error));
      file.stream.once("end", () => {
        if (aggregateError) return finish(aggregateError);
        return finish(null, { buffer: Buffer.concat(chunks, size), size });
      });
    },

    _removeFile(req, file, cb) {
      if (file?.buffer) delete file.buffer;
      cb(null);
    },
  };
}

module.exports = { boundedMemoryStorage, TOTAL_BYTES };

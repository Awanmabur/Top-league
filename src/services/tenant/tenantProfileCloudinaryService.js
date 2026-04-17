const { uploadBuffer, safeDestroy } = require("../../utils/cloudinaryUpload"); // <- adjust path

function folderFor(tenantCode) {
  return `classic-academy/tenants/${tenantCode}/school-profile`;
}

async function uploadLogo(file, tenantCode) {
  const r = await uploadBuffer(file, folderFor(tenantCode), {
    resource_type: "image",
    transformation: [
      { width: 512, height: 512, crop: "fill", gravity: "auto" },
      { fetch_format: "webp", quality: "auto" },
    ],
  });
  return { url: r.secure_url, publicId: r.public_id };
}

async function uploadCover(file, tenantCode) {
  const r = await uploadBuffer(file, folderFor(tenantCode), {
    resource_type: "image",
    transformation: [
      { width: 1600, height: 600, crop: "fill", gravity: "auto" },
      { fetch_format: "webp", quality: "auto" },
    ],
  });
  return { url: r.secure_url, publicId: r.public_id };
}

async function uploadGalleryImage(file, tenantCode) {
  const r = await uploadBuffer(file, folderFor(tenantCode), {
    resource_type: "image",
    transformation: [
      { width: 1600, height: 1000, crop: "limit" },
      { fetch_format: "webp", quality: "auto" },
    ],
  });
  return { url: r.secure_url, publicId: r.public_id };
}

module.exports = { uploadLogo, uploadCover, uploadGalleryImage, safeDestroy };

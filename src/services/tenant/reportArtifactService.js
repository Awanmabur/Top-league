const reportCtl = require('./reportControlService');

function tenantSegment(value) {
  return String(value || 'tenant')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'tenant';
}

async function storeCsvArtifact({
  ReportExport,
  uploadBuffer,
  safeDestroy,
  tenantCode,
  type,
  source = 'export',
  filters = {},
  buffer,
  fileName,
  originalFileName = '',
  rowsCount = null,
  userId = null,
  subfolder = '',
}) {
  if (!ReportExport) throw new Error('Report export history is unavailable.');
  if (typeof uploadBuffer !== 'function') throw new Error('Report storage is unavailable.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Report artifact is empty.');

  const validation = reportCtl.validateCsvBuffer(buffer, { maxBytes: 2 * 1024 * 1024, maxRows: 5000, allowHeaderOnly: source === 'export' });
  const safeName = reportCtl.safeFilename(fileName || originalFileName, 'report.csv');
  const folderBase = String(process.env.CLOUDINARY_FOLDER || 'classic-academy').replace(/\/+$/g, '');
  const folderTail = String(subfolder || '').split('/').map(tenantSegment).filter(Boolean).join('/');
  const folder = `${folderBase}/${tenantSegment(tenantCode)}/reports${folderTail ? `/${folderTail}` : ''}`;

  let upload = null;
  try {
    upload = await uploadBuffer({
      buffer,
      mimetype: 'text/csv',
      originalname: safeName,
      size: buffer.length,
    }, folder, { resource_type: 'raw', type: 'authenticated' });

    if (!upload?.public_id) throw new Error('Report storage did not return an authenticated artifact id.');

    return await ReportExport.create({
      type,
      source,
      format: 'csv',
      filters,
      rowsCount: rowsCount === null ? validation.rowsCount : Math.max(0, Number(rowsCount) || 0),
      byteSize: buffer.length,
      fileUrl: '',
      filePublicId: upload.public_id,
      fileResourceType: upload.resource_type || 'raw',
      originalFileName: reportCtl.safeFilename(originalFileName, ''),
      fileName: safeName,
      contentType: 'text/csv',
      checksum: reportCtl.sha256(buffer),
      accessType: 'authenticated',
      status: 'ready',
      createdBy: userId || null,
    });
  } catch (err) {
    if (upload?.public_id && typeof safeDestroy === 'function') {
      await safeDestroy(upload.public_id, upload.resource_type || 'raw');
    }
    throw err;
  }
}

module.exports = { tenantSegment, storeCsvArtifact };

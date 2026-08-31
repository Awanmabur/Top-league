const {
  normalizeCategory,
  normalizePriority,
  normalizeRequesterType,
  normalizeStatus,
  formatDuration,
  ticketNoCandidate,
} = require('../../src/services/tenant/helpdeskService');

const VALID_THREAD_ROLES = new Set(['Requester', 'Staff', 'System']);
const str = (v) => String(v ?? '').trim();
const validDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function latestThreadAt(thread, role) {
  const matches = (Array.isArray(thread) ? thread : [])
    .filter((row) => row?.role === role && validDate(row?.createdAt))
    .map((row) => validDate(row.createdAt))
    .sort((a, b) => b.getTime() - a.getTime());
  return matches[0] || null;
}

function firstStaffAt(thread) {
  const matches = (Array.isArray(thread) ? thread : [])
    .filter((row) => row?.role === 'Staff' && validDate(row?.createdAt))
    .map((row) => validDate(row.createdAt))
    .sort((a, b) => a.getTime() - b.getTime());
  return matches[0] || null;
}

function canonicalThread(thread) {
  return (Array.isArray(thread) ? thread : []).map((row) => ({
    ...row,
    authorUserId: row?.authorUserId || null,
    author: str(row?.author),
    role: VALID_THREAD_ROLES.has(row?.role) ? row.role : 'Requester',
    body: str(row?.body || row?.message),
    createdAt: validDate(row?.createdAt) || new Date(),
  }));
}

function buildCanonicalSet(doc, ticketNo, now = new Date()) {
  const thread = canonicalThread(doc.thread);
  const status = normalizeStatus(doc.status);
  const createdAt = validDate(doc.createdAt) || now;
  const firstResponseAt = validDate(doc.firstResponseAt) || firstStaffAt(thread);
  const requesterLastReplyAt = validDate(doc.requesterLastReplyAt) || latestThreadAt(thread, 'Requester');
  const staffLastReplyAt = validDate(doc.staffLastReplyAt) || latestThreadAt(thread, 'Staff');
  let resolvedAt = validDate(doc.resolvedAt);
  let closedAt = validDate(doc.closedAt);
  if (status === 'Resolved' && !resolvedAt) resolvedAt = validDate(doc.updatedAt) || now;
  if (status === 'Closed') {
    if (!closedAt) closedAt = validDate(doc.updatedAt) || now;
    if (!resolvedAt) resolvedAt = closedAt;
  }
  if (!['Resolved', 'Closed'].includes(status)) {
    resolvedAt = null;
    closedAt = null;
  }

  const dueDate = validDate(doc.dueDate);
  const stats = {
    ...(doc.stats || {}),
    replies: Math.max(0, thread.length - 1),
    firstResponse: firstResponseAt ? formatDuration(createdAt, firstResponseAt) : '—',
    resolutionTime: resolvedAt ? formatDuration(createdAt, resolvedAt) : '—',
    slaBreached: !!(dueDate && !['Resolved', 'Closed'].includes(status) && dueDate.getTime() < now.getTime()),
  };

  return {
    ticketNo,
    category: normalizeCategory(doc.category),
    priority: normalizePriority(doc.priority),
    requesterType: normalizeRequesterType(doc.requesterType),
    requesterUserId: doc.requesterUserId || null,
    relatedStudentId: doc.relatedStudentId || null,
    assignedToUserId: doc.assignedToUserId || null,
    status,
    firstResponseAt,
    requesterLastReplyAt,
    staffLastReplyAt,
    resolvedAt,
    closedAt,
    thread,
    stats,
  };
}

function allocateTicketNo(doc, used) {
  const existing = str(doc.ticketNo);
  if (existing && !used.has(existing)) {
    used.add(existing);
    return { ticketNo: existing, changed: false };
  }
  const baseDate = validDate(doc.createdAt) || new Date();
  let candidate;
  do {
    candidate = ticketNoCandidate(baseDate);
  } while (used.has(candidate));
  used.add(candidate);
  return { ticketNo: candidate, changed: true };
}

function isTicketNoIndex(index) {
  const key = index?.key || {};
  return Object.keys(key).length === 1 && Number(key.ticketNo) === 1;
}

async function migrateHelpdeskTickets(HelpdeskTicket) {
  if (!HelpdeskTicket?.collection) throw new Error('HelpdeskTicket model is unavailable for migration.');
  const collection = HelpdeskTicket.collection;
  const docs = await collection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  const used = new Set();
  let repairedNumbers = 0;
  let updated = 0;

  for (const doc of docs) {
    const allocation = allocateTicketNo(doc, used);
    if (allocation.changed) repairedNumbers += 1;
    const $set = buildCanonicalSet(doc, allocation.ticketNo);
    await collection.updateOne({ _id: doc._id }, { $set });
    updated += 1;
  }

  let indexes = [];
  try {
    indexes = await collection.listIndexes().toArray();
  } catch (err) {
    if (err?.codeName !== 'NamespaceNotFound' && err?.code !== 26) throw err;
  }

  for (const index of indexes) {
    if (isTicketNoIndex(index) && index.unique !== true && index.name) {
      await collection.dropIndex(index.name);
    }
  }

  await collection.createIndex({ ticketNo: 1 }, { unique: true });
  return { scanned: docs.length, updated, repairedNumbers };
}

module.exports = {
  allocateTicketNo,
  buildCanonicalSet,
  isTicketNoIndex,
  migrateHelpdeskTickets,
};

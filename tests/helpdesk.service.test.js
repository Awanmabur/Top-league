const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCategory,
  normalizePriority,
  normalizeRequesterType,
  normalizeStatus,
  formatDuration,
  ticketNoCandidate,
  generateTicketNo,
  refreshStats,
  addThreadMessage,
  applyStatus,
} = require('../src/services/tenant/helpdeskService');

test('normalizes legacy portal categories and priorities into canonical values', () => {
  assert.equal(normalizeCategory('fees'), 'Finance');
  assert.equal(normalizeCategory('IT & Portal'), 'Technical');
  assert.equal(normalizeCategory('student_issue'), 'Academic');
  assert.equal(normalizeCategory('attendance'), 'Attendance');
  assert.equal(normalizeCategory('unknown'), 'General');
  assert.equal(normalizePriority('normal'), 'Medium');
  assert.equal(normalizePriority('URGENT'), 'Urgent');
  assert.equal(normalizePriority(''), 'Medium');
  assert.equal(normalizeRequesterType('Student'), 'Student');
  assert.equal(normalizeRequesterType('Nobody'), 'External');
  assert.equal(normalizeStatus('Resolved'), 'Resolved');
  assert.equal(normalizeStatus('invalid'), 'Open');
});

test('formats helpdesk response and resolution durations', () => {
  const from = new Date('2026-08-29T08:00:00Z');
  assert.equal(formatDuration(from, new Date('2026-08-29T08:45:00Z')), '45m');
  assert.equal(formatDuration(from, new Date('2026-08-29T10:15:00Z')), '2h 15m');
  assert.equal(formatDuration(from, new Date('2026-08-30T10:00:00Z')), '1d 2h');
  assert.equal(formatDuration(new Date('2026-08-30T10:00:00Z'), from), '—');
});

test('ticket numbers use date plus cryptographic random suffix and do not rely on counts', () => {
  const fixed = new Date('2026-08-29T00:00:00Z');
  const values = new Set(Array.from({ length: 250 }, () => ticketNoCandidate(fixed)));
  assert.equal(values.size, 250);
  for (const value of values) {
    assert.match(value, /^TKT-20260829-[0-9A-F]{8}$/);
  }
});

test('generateTicketNo retries collisions against the database model', async () => {
  let calls = 0;
  const HelpdeskTicket = {
    async exists() {
      calls += 1;
      return calls < 3 ? { _id: 'collision' } : null;
    },
  };
  const value = await generateTicketNo(HelpdeskTicket);
  assert.match(value, /^TKT-\d{8}-[0-9A-F]{8}$/);
  assert.equal(calls, 3);
});

function fakeTicket(overrides = {}) {
  return {
    _id: 'ticket-1',
    ticketNo: 'TKT-20260829-ABCDEF12',
    requesterUserId: 'requester-1',
    requesterType: 'Student',
    priority: 'Medium',
    status: 'Open',
    createdAt: new Date(Date.now() - 30 * 60 * 1000),
    thread: [{ role: 'Requester', body: 'Initial', createdAt: new Date(Date.now() - 30 * 60 * 1000) }],
    stats: {},
    async save() { this.saved = true; return this; },
    ...overrides,
  };
}

test('first real staff response starts response timing, moves Open to In Progress, and targets requester notification', async () => {
  const created = [];
  const models = { Notification: { create: async (doc) => { created.push(doc); return doc; } } };
  const ticket = fakeTicket();

  await addThreadMessage(models, ticket, {
    role: 'Staff',
    body: 'We are checking this now.',
    authorUserId: 'staff-user',
    authorName: 'Support Agent',
  });

  assert.equal(ticket.status, 'In Progress');
  assert.ok(ticket.firstResponseAt instanceof Date);
  assert.ok(ticket.staffLastReplyAt instanceof Date);
  assert.equal(ticket.thread.at(-1).authorUserId, 'staff-user');
  assert.equal(ticket.stats.replies, 1);
  assert.equal(ticket.saved, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].userId, 'requester-1');
  assert.equal(created[0].entityType, 'HelpdeskTicket');
  assert.equal(created[0].url, '/student/support');
});

test('requester reply to Resolved ticket reopens it to In Progress and notifies admins', async () => {
  const created = [];
  const models = { Notification: { create: async (doc) => { created.push(doc); return doc; } } };
  const ticket = fakeTicket({
    status: 'Resolved',
    resolvedAt: new Date(),
    requesterType: 'Parent',
  });

  await addThreadMessage(models, ticket, {
    role: 'Requester',
    body: 'The issue is still happening.',
    authorUserId: 'parent-user',
    authorName: 'Parent',
  });

  assert.equal(ticket.status, 'In Progress');
  assert.equal(ticket.resolvedAt, null);
  assert.ok(ticket.requesterLastReplyAt instanceof Date);
  assert.equal(created.length, 1);
  assert.equal(created[0].audience, 'admin');
  assert.equal(created[0].userId, null);
});

test('Closed tickets are terminal for both status changes and replies', async () => {
  const ticket = fakeTicket({ status: 'Closed', closedAt: new Date(), resolvedAt: new Date() });
  assert.throws(() => applyStatus(ticket, 'Open'), /terminal/i);
  await assert.rejects(
    () => addThreadMessage({}, ticket, { role: 'Requester', body: 'Again' }),
    /Closed tickets cannot accept new replies/i,
  );
});

test('resolution and closure timestamps drive real ticket stats', () => {
  const createdAt = new Date('2026-08-29T08:00:00Z');
  const ticket = fakeTicket({ createdAt, status: 'In Progress', thread: [{}, {}, {}], stats: {} });
  applyStatus(ticket, 'Resolved');
  assert.ok(ticket.resolvedAt instanceof Date);
  assert.equal(ticket.stats.replies, 2);
  assert.notEqual(ticket.stats.resolutionTime, '—');
  applyStatus(ticket, 'Closed');
  assert.ok(ticket.closedAt instanceof Date);
  assert.ok(ticket.resolvedAt instanceof Date);
});

test('refreshStats flags overdue unresolved tickets but not resolved/closed tickets', () => {
  const ticket = fakeTicket({ dueDate: new Date(Date.now() - 1000), status: 'Open' });
  refreshStats(ticket);
  assert.equal(ticket.stats.slaBreached, true);
  ticket.status = 'Resolved';
  refreshStats(ticket);
  assert.equal(ticket.stats.slaBreached, false);
});

test('admin-created tickets with an initial terminal status receive real lifecycle timestamps', async () => {
  const { createTicket } = require('../src/services/tenant/helpdeskService');
  const saved = [];
  const HelpdeskTicket = {
    exists: async () => null,
    create: async (doc) => {
      const ticket = {
        _id: 'created-ticket',
        createdAt: new Date(),
        stats: {},
        ...doc,
        async save() { saved.push(this); return this; },
      };
      return ticket;
    },
  };
  const ticket = await createTicket({ HelpdeskTicket }, {
    subject: 'Imported external issue',
    description: 'Already resolved at entry time',
    requesterType: 'External',
    status: 'Resolved',
    adminCreated: true,
  });
  assert.equal(ticket.status, 'Resolved');
  assert.ok(ticket.resolvedAt instanceof Date);
  assert.notEqual(ticket.stats.resolutionTime, '—');
  assert.equal(saved.length, 1);
});

test('legacy migration allocates replacements only for missing/duplicate ticket numbers and canonicalizes fields', () => {
  const { allocateTicketNo, buildCanonicalSet, isTicketNoIndex } = require('../scripts/lib/migrateHelpdeskTickets');
  const used = new Set();
  const first = allocateTicketNo({ ticketNo: 'TKT-00001', createdAt: '2026-08-29T00:00:00Z' }, used);
  const duplicate = allocateTicketNo({ ticketNo: 'TKT-00001', createdAt: '2026-08-29T00:00:00Z' }, used);
  assert.equal(first.changed, false);
  assert.equal(duplicate.changed, true);
  assert.match(duplicate.ticketNo, /^TKT-20260829-[0-9A-F]{8}$/);

  const set = buildCanonicalSet({
    category: 'fees',
    priority: 'normal',
    status: 'Resolved',
    requesterType: '',
    createdAt: new Date(Date.now() - 3600000),
    updatedAt: new Date(),
    thread: [
      { author: 'Requester', role: 'Requester', body: 'Initial', createdAt: new Date(Date.now() - 3600000) },
      { author: 'Agent', role: 'Staff', body: 'Reply', createdAt: new Date(Date.now() - 1800000) },
    ],
  }, 'TKT-00001');
  assert.equal(set.category, 'Finance');
  assert.equal(set.priority, 'Medium');
  assert.equal(set.requesterType, 'External');
  assert.equal(set.stats.replies, 1);
  assert.ok(set.firstResponseAt instanceof Date);
  assert.ok(set.resolvedAt instanceof Date);
  assert.equal(set.thread[0].authorUserId, null);
  assert.equal(isTicketNoIndex({ key: { ticketNo: 1 }, unique: false }), true);
});

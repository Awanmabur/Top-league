const mongoose = require("mongoose");
const { sendMail } = require("../../utils/mailer");

const STAFF_ROLES = ["staff", "lecturer", "finance", "librarian", "hostel", "registrar"];

function str(v) {
  return String(v ?? "").trim();
}

function escapeRegex(v) {
  return str(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactRegex(v) {
  const value = escapeRegex(v);
  return value ? new RegExp(`^${value}$`, "i") : null;
}

function isValidId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || ""));
}

function normalizeAudienceType(v) {
  const value = str(v);
  const aliases = {
    Students: "All Students",
    Staff: "All Staff",
    Parents: "All Parents",
    "Specific Class": "Specific Program",
    Program: "Specific Program",
    Cohort: "Year/Cohort",
    Hostel: "Hostel Residents",
  };
  return aliases[value] || value || "All Students";
}

function publicationFilter(now = new Date()) {
  return {
    isDeleted: { $ne: true },
    status: "Published",
    $and: [
      { $or: [{ publishedAt: null }, { publishedAt: { $exists: false } }, { publishedAt: { $lte: now } }] },
      { $or: [{ expiryDate: null }, { expiryDate: { $exists: false } }, { expiryDate: { $gt: now } }] },
    ],
  };
}

function userName(user = {}) {
  return str(user.fullName) || [user.firstName, user.lastName].map(str).filter(Boolean).join(" ") || str(user.email) || "Portal User";
}

function primaryRole(user = {}, fallback = "") {
  const roles = Array.isArray(user.roles) ? user.roles.map((r) => str(r).toLowerCase()) : [];
  if (roles.includes("student")) return "Student";
  if (roles.includes("parent")) return "Parent";
  if (roles.some((r) => STAFF_ROLES.includes(r))) return "Staff";
  if (roles.includes("admin")) return "Admin";
  return fallback || roles[0] || "User";
}

function fieldMatches(value, expected) {
  const left = str(value).toLowerCase();
  const right = str(expected).toLowerCase();
  return !!left && !!right && left === right;
}

function anyFieldMatches(values, expected) {
  return (values || []).some((value) => fieldMatches(value, expected));
}

function studentMatchesAudience(student = {}, type, value, extra = {}) {
  type = normalizeAudienceType(type);
  value = str(value);

  if (type === "All Students") return true;

  if (type === "Specific Program") {
    return anyFieldMatches(
      [
        student.classId,
        student.className,
        student.classCode,
        student.schoolUnitId,
        student.schoolUnitName,
        student.schoolUnitCode,
        student.programId,
        student.program,
        student.programName,
      ],
      value
    );
  }

  if (type === "Specific Department") {
    return anyFieldMatches(
      [student.schoolUnitId, student.schoolUnitName, student.schoolUnitCode, student.departmentId, student.departmentName, student.department],
      value
    );
  }

  if (type === "Specific Subject") {
    return (student.subjects || []).map(String).includes(value);
  }

  if (type === "Year/Cohort") {
    return anyFieldMatches(
      [student.classLevel, student.academicYear, student.intakeId, student.yearLevel, student.year, student.cohort],
      value
    );
  }

  if (type === "Hostel Residents") {
    if (!extra.hostelResident) return false;
    if (!value || value === "—") return true;
    return anyFieldMatches([extra.hostelId, extra.hostelName, extra.hostelCode], value);
  }

  return false;
}

function staffMatchesAudience(staff = {}, type, value, extra = {}) {
  type = normalizeAudienceType(type);
  value = str(value);

  if (type === "All Staff") return true;
  if (type !== "Specific Department") return false;

  return anyFieldMatches(
    [staff.departmentId, extra.departmentName, extra.departmentCode, staff.jobTitle],
    value
  );
}

function announcementMatchesContext(announcement = {}, context = {}) {
  const type = normalizeAudienceType(announcement.audienceType);
  const value = announcement.audienceValue;

  if (context.role === "student") {
    return studentMatchesAudience(context.student || {}, type, value, context);
  }

  if (context.role === "staff") {
    return staffMatchesAudience(context.staff || {}, type, value, context);
  }

  if (context.role === "parent") {
    if (type === "All Parents") return true;
    const children = Array.isArray(context.children) ? context.children : [];
    return children.some((child) => studentMatchesAudience(child.student || child, type, value, child));
  }

  if (context.role === "admin") return true;
  return false;
}

async function departmentLookup(Staff, value) {
  if (!Staff || !value) return { id: isValidId(value) ? value : null, name: "", code: "" };
  if (isValidId(value)) return { id: value, name: "", code: "" };

  try {
    const re = exactRegex(value);
    const raw = await Staff.db.collection("departments").findOne({
      $or: [{ name: re }, { title: re }, { code: re }],
    });
    return raw ? { id: raw._id, name: raw.name || raw.title || "", code: raw.code || "" } : { id: null, name: "", code: "" };
  } catch {
    return { id: null, name: "", code: "" };
  }
}

async function hostelLookup(HostelAllocation, value) {
  if (!HostelAllocation || !value || value === "—") return { id: null, name: "", code: "" };
  if (isValidId(value)) return { id: value, name: "", code: "" };
  try {
    const re = exactRegex(value);
    const raw = await HostelAllocation.db.collection("hostels").findOne({
      $or: [{ name: re }, { title: re }, { code: re }],
    });
    return raw ? { id: raw._id, name: raw.name || raw.title || "", code: raw.code || "" } : { id: null, name: "", code: "" };
  } catch {
    return { id: null, name: "", code: "" };
  }
}

async function usersForStudents(models, studentIds = []) {
  const { User, Student } = models || {};
  if (!User || !Student || !studentIds.length) return [];
  const students = await Student.find({ _id: { $in: studentIds }, isDeleted: { $ne: true } })
    .select("_id userId")
    .lean();
  const profileUserIds = students.map((s) => s.userId).filter(Boolean);
  return User.find({
    deletedAt: null,
    status: "active",
    $or: [
      { _id: { $in: profileUserIds } },
      { studentId: { $in: studentIds } },
    ],
  })
    .select("_id email firstName lastName roles studentId")
    .lean();
}

async function usersForParentsOfStudents(models, studentIds = []) {
  const { User, Parent } = models || {};
  if (!User || !studentIds.length) return [];

  const combined = await User.find({
    deletedAt: null,
    status: "active",
    roles: "parent",
    childrenStudentIds: { $in: studentIds },
  })
    .select("_id email firstName lastName roles childrenStudentIds")
    .lean();

  if (Parent) {
    const parents = await Parent.find({
      status: "active",
      childrenStudentIds: { $in: studentIds },
    })
      .select("userId")
      .lean();
    const parentUserIds = parents.map((row) => row.userId).filter(Boolean);
    if (parentUserIds.length) {
      combined.push(...(await User.find({
        _id: { $in: parentUserIds },
        deletedAt: null,
        status: "active",
        roles: "parent",
      })
        .select("_id email firstName lastName roles childrenStudentIds")
        .lean()));
    }
  }

  const byId = new Map();
  for (const user of combined) if (user?._id) byId.set(String(user._id), user);
  return [...byId.values()];
}

async function usersForStudentAudience(models, studentIds = []) {
  const [students, parents] = await Promise.all([
    usersForStudents(models, studentIds),
    usersForParentsOfStudents(models, studentIds),
  ]);
  const byId = new Map();
  for (const user of [...students, ...parents]) if (user?._id) byId.set(String(user._id), user);
  return [...byId.values()];
}

async function resolveDirectRecipients(req, announcement) {
  const models = req.models || {};
  const { User, Student, Staff, Subject, HostelAllocation } = models;
  if (!User) return [];

  const type = normalizeAudienceType(announcement.audienceType);
  const value = str(announcement.audienceValue);
  const userBase = { deletedAt: null, status: "active" };

  let users = [];

  if (type === "All Students") {
    if (Student) {
      const studentRows = await Student.find({ isDeleted: { $ne: true } }).select("_id").lean();
      users = await usersForStudentAudience(models, studentRows.map((row) => row._id));
    } else {
      users = await User.find({ ...userBase, roles: "student" })
        .select("_id email firstName lastName roles studentId")
        .lean();
    }
  } else if (type === "All Staff") {
    users = await User.find({ ...userBase, roles: { $in: STAFF_ROLES } })
      .select("_id email firstName lastName roles staffId")
      .lean();
  } else if (type === "All Parents") {
    users = await User.find({ ...userBase, roles: "parent" })
      .select("_id email firstName lastName roles childrenStudentIds")
      .lean();
  } else if (type === "Specific Department") {
    const dept = await departmentLookup(Staff, value);
    const combined = [];

    if (Staff) {
      const staffFilter = { isDeleted: { $ne: true } };
      if (dept.id) staffFilter.departmentId = dept.id;
      else if (value) staffFilter.jobTitle = exactRegex(value);
      const staff = await Staff.find(staffFilter).select("_id userId email").lean();
      const userIds = staff.map((s) => s.userId).filter(Boolean);
      const staffIds = staff.map((s) => s._id);
      const staffUsers = await User.find({
        ...userBase,
        $or: [{ _id: { $in: userIds } }, { staffId: { $in: staffIds } }],
      })
        .select("_id email firstName lastName roles staffId")
        .lean();
      combined.push(...staffUsers);
    }

    if (Student && value) {
      const re = exactRegex(value);
      const studentOr = [
        { schoolUnitId: value },
        ...(dept.id ? [{ schoolUnitId: String(dept.id) }] : []),
        ...(re ? [{ schoolUnitName: re }, { schoolUnitCode: re }] : []),
        ...(dept.name ? [{ schoolUnitName: exactRegex(dept.name) }] : []),
        ...(dept.code ? [{ schoolUnitCode: exactRegex(dept.code) }] : []),
      ];
      const studentRows = await Student.find({ isDeleted: { $ne: true }, $or: studentOr }).select("_id").lean();
      combined.push(...(await usersForStudentAudience(models, studentRows.map((row) => row._id))));
    }
    users = combined;
  } else if (["Specific Program", "Year/Cohort", "Specific Subject"].includes(type) && Student) {
    const re = exactRegex(value);
    const filter = { isDeleted: { $ne: true } };
    if (type === "Specific Program") {
      filter.$or = re
        ? [
            { classId: value },
            { schoolUnitId: value },
            { className: re },
            { classCode: re },
            { schoolUnitName: re },
            { schoolUnitCode: re },
          ]
        : [];
    } else if (type === "Year/Cohort") {
      filter.$or = re
        ? [{ intakeId: value }, { classLevel: re }, { academicYear: re }]
        : [];
    } else if (type === "Specific Subject") {
      let subjectId = isValidId(value) ? value : null;
      if (!subjectId && Subject && re) {
        const subject = await Subject.findOne({ $or: [{ title: re }, { code: re }, { shortTitle: re }] }).select("_id").lean();
        subjectId = subject?._id || null;
      }
      if (!subjectId) return [];
      filter.subjects = subjectId;
    }
    const rows = await Student.find(filter).select("_id").lean();
    users = await usersForStudentAudience(models, rows.map((s) => s._id));
  } else if (type === "Hostel Residents" && HostelAllocation && Student) {
    const hostel = await hostelLookup(HostelAllocation, value);
    const filter = { isDeleted: { $ne: true }, status: "active" };
    if (value && value !== "—") {
      if (!hostel.id) return [];
      filter.hostel = hostel.id;
    }
    const allocations = await HostelAllocation.find(filter).select("student").lean();
    users = await usersForStudentAudience(models, allocations.map((a) => a.student));
  }

  const byId = new Map();
  for (const user of users || []) {
    if (user?._id) byId.set(String(user._id), user);
  }
  return [...byId.values()];
}

async function materializeRecipients(req, announcement) {
  const { AnnouncementReceipt } = req.models || {};
  if (!AnnouncementReceipt || !announcement?._id) return [];
  const recipients = await resolveDirectRecipients(req, announcement);
  const recipientIds = recipients.map((user) => user?._id).filter(Boolean);

  // Keep receipts authoritative to the announcement's current audience. This prevents
  // users removed by an audience edit from receiving later reminders or appearing as
  // current recipients.
  const staleFilter = { announcementId: announcement._id };
  if (recipientIds.length) staleFilter.userId = { $nin: recipientIds };
  await AnnouncementReceipt.deleteMany(staleFilter);

  if (!recipients.length) return [];

  await AnnouncementReceipt.bulkWrite(
    recipients.map((user) => ({
      updateOne: {
        filter: { announcementId: announcement._id, userId: user._id },
        update: {
          $setOnInsert: {
            announcementId: announcement._id,
            userId: user._id,
            name: userName(user),
            email: str(user.email).toLowerCase(),
            role: primaryRole(user),
            status: "Unread",
          },
          $set: {
            name: userName(user),
            email: str(user.email).toLowerCase(),
            role: primaryRole(user),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  return recipients;
}

function escapeHtml(v) {
  return str(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function deliverEmailChannel(req, announcement, recipients) {
  const { AnnouncementReceipt, Announcement } = req.models || {};
  if (!announcement?.channels?.email || !AnnouncementReceipt || !Announcement) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const subject = `[${req.tenant?.name || "Classic Academy"}] ${announcement.title}`;
  const text = str(announcement.body);
  const html = `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;

  for (const user of recipients || []) {
    const email = str(user.email).toLowerCase();
    if (!email) continue;
    try {
      const existingReceipt = await AnnouncementReceipt.findOne({
        announcementId: announcement._id,
        userId: user._id,
      }).select("emailDeliveryStatus").lean();
      if (existingReceipt?.emailDeliveryStatus === "Sent") continue;

      await AnnouncementReceipt.updateOne(
        { announcementId: announcement._id, userId: user._id },
        { $set: { emailDeliveryStatus: "Pending", emailError: "" } }
      );
      await sendMail({ to: email, subject, text, html });
      sent += 1;
      await AnnouncementReceipt.updateOne(
        { announcementId: announcement._id, userId: user._id },
        { $set: { emailDeliveryStatus: "Sent", emailDeliveredAt: new Date(), emailError: "" } }
      );
    } catch (err) {
      failed += 1;
      await AnnouncementReceipt.updateOne(
        { announcementId: announcement._id, userId: user._id },
        { $set: { emailDeliveryStatus: "Failed", emailError: str(err?.message).slice(0, 500) } }
      ).catch(() => {});
    }
  }

  if (sent) {
    await Announcement.updateOne({ _id: announcement._id }, { $inc: { "stats.emailDelivered": sent } });
  }
  return { sent, failed };
}

async function activateAnnouncement(req, announcement, now = new Date(), options = {}) {
  if (!announcement) return null;
  if (announcement.expiryDate && new Date(announcement.expiryDate) <= now) {
    announcement.status = "Unpublished";
    announcement.scheduleAt = null;
    announcement.scheduleClaimedAt = null;
    if (options.updatedBy !== undefined) announcement.updatedBy = options.updatedBy;
    await announcement.save();
    return null;
  }
  announcement.status = "Published";
  announcement.scheduleAt = null;
  announcement.scheduleClaimedAt = null;
  announcement.publishedAt = announcement.publishedAt || now;
  if (options.updatedBy !== undefined) announcement.updatedBy = options.updatedBy;
  await announcement.save();
  const recipients = await materializeRecipients(req, announcement);
  await deliverEmailChannel(req, announcement, recipients);
  return announcement;
}

async function expireAnnouncements(req, now = new Date()) {
  const { Announcement } = req.models || {};
  if (!Announcement) return 0;
  const result = await Announcement.updateMany(
    {
      isDeleted: { $ne: true },
      status: { $in: ["Published", "Scheduled"] },
      expiryDate: { $ne: null, $lte: now },
    },
    {
      $set: {
        status: "Unpublished",
        scheduleAt: null,
        scheduleClaimedAt: null,
      },
    }
  );
  return Number(result.modifiedCount || 0);
}

async function publishDueAnnouncements(req, now = new Date()) {
  const { Announcement } = req.models || {};
  if (!Announcement) return 0;
  await expireAnnouncements(req, now);

  const leaseMs = Math.max(60_000, Number(process.env.ANNOUNCEMENT_SCHEDULE_LEASE_MS || 300_000));
  const staleClaim = new Date(now.getTime() - leaseMs);
  let published = 0;

  for (let i = 0; i < 100; i += 1) {
    const announcement = await Announcement.findOneAndUpdate(
      {
        isDeleted: { $ne: true },
        status: "Scheduled",
        scheduleAt: { $ne: null, $lte: now },
        $and: [
          { $or: [{ expiryDate: null }, { expiryDate: { $exists: false } }, { expiryDate: { $gt: now } }] },
          { $or: [{ scheduleClaimedAt: null }, { scheduleClaimedAt: { $exists: false } }, { scheduleClaimedAt: { $lt: staleClaim } }] },
        ],
      },
      { $set: { scheduleClaimedAt: now } },
      { new: true, sort: { scheduleAt: 1, createdAt: 1 } }
    );

    if (!announcement) break;

    try {
      // Prepare recipients and channel delivery while the row is lease-claimed.
      // Email delivery is receipt-idempotent, so a recovered stale lease will not resend successful deliveries.
      const recipients = await materializeRecipients(req, announcement);
      await deliverEmailChannel(req, announcement, recipients);

      announcement.status = "Published";
      announcement.scheduleAt = null;
      announcement.scheduleClaimedAt = null;
      announcement.publishedAt = announcement.publishedAt || now;
      await announcement.save();
      published += 1;
    } catch (err) {
      await Announcement.updateOne(
        { _id: announcement._id, status: "Scheduled" },
        { $set: { scheduleClaimedAt: null } }
      ).catch(() => {});
      throw err;
    }
  }

  return published;
}

async function buildStudentContext(req, user, student) {
  const { HostelAllocation } = req.models || {};
  const context = { role: "student", user, student, hostelResident: false };
  if (!student || !HostelAllocation) return context;

  const allocation = await HostelAllocation.findOne({
    student: student._id,
    status: "active",
    isDeleted: { $ne: true },
  }).lean().catch(() => null);

  if (!allocation) return context;
  context.hostelResident = true;
  context.hostelId = allocation.hostel ? String(allocation.hostel) : "";
  return context;
}

async function buildParentContext(req, user, parent) {
  const { Student, HostelAllocation } = req.models || {};
  const ids = [...new Set([
    ...((parent?.childrenStudentIds || []).map(String)),
    ...((user?.childrenStudentIds || []).map(String)),
  ].filter((id) => isValidId(id)))];

  const students = Student && ids.length
    ? await Student.find({ _id: { $in: ids }, isDeleted: { $ne: true } }).lean().catch(() => [])
    : [];

  let activeHostelByStudent = new Map();
  if (HostelAllocation && students.length) {
    const allocations = await HostelAllocation.find({
      student: { $in: students.map((s) => s._id) },
      status: "active",
      isDeleted: { $ne: true },
    }).lean().catch(() => []);
    activeHostelByStudent = new Map(allocations.map((a) => [String(a.student), a]));
  }

  return {
    role: "parent",
    user,
    parent,
    children: students.map((student) => {
      const allocation = activeHostelByStudent.get(String(student._id));
      return {
        student,
        hostelResident: !!allocation,
        hostelId: allocation?.hostel ? String(allocation.hostel) : "",
      };
    }),
  };
}

async function buildStaffContext(req, user, staff) {
  const context = { role: "staff", user, staff, departmentName: "", departmentCode: "" };
  if (!staff?.departmentId || !req.models?.Staff) return context;
  try {
    const dep = await req.models.Staff.db.collection("departments").findOne({ _id: staff.departmentId });
    if (dep) {
      context.departmentName = dep.name || dep.title || "";
      context.departmentCode = dep.code || "";
    }
  } catch {}
  return context;
}

async function ensureCurrentUserReceipt(req, announcement, context) {
  const { AnnouncementReceipt } = req.models || {};
  const user = context?.user;
  if (!AnnouncementReceipt || !announcement?._id || !user?._id) return null;

  return AnnouncementReceipt.findOneAndUpdate(
    { announcementId: announcement._id, userId: user._id },
    {
      $setOnInsert: {
        announcementId: announcement._id,
        userId: user._id,
        status: "Unread",
      },
      $set: {
        name: userName(user),
        email: str(user.email).toLowerCase(),
        role: primaryRole(user, context.role),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function markAnnouncementRead(req, announcement, context, now = new Date()) {
  const { AnnouncementReceipt, Announcement } = req.models || {};
  if (!AnnouncementReceipt || !Announcement || !context?.user?._id) return false;
  await ensureCurrentUserReceipt(req, announcement, context);
  const result = await AnnouncementReceipt.updateOne(
    {
      announcementId: announcement._id,
      userId: context.user._id,
      status: "Unread",
    },
    { $set: { status: "Read", readAt: now } }
  );
  if (result.modifiedCount) {
    await Announcement.updateOne({ _id: announcement._id }, { $inc: { "stats.views": 1 } });
    return true;
  }
  return false;
}

async function findVisibleAnnouncements(req, context, options = {}) {
  const { Announcement } = req.models || {};
  if (!Announcement) return [];
  const now = options.now || new Date();
  await publishDueAnnouncements(req, now);

  const candidates = await Announcement.find(publicationFilter(now))
    .sort({ priority: -1, publishedAt: -1, createdAt: -1 })
    .limit(Math.max(Number(options.scanLimit || 250), Number(options.limit || 100)))
    .lean();

  const matches = candidates.filter((announcement) => announcementMatchesContext(announcement, context));
  const limited = matches.slice(0, Number(options.limit || 100));

  if (context?.user?._id) {
    for (const announcement of limited) {
      await ensureCurrentUserReceipt(req, announcement, context);
      if (options.markRead !== false) await markAnnouncementRead(req, announcement, context, now);
    }
  }
  return limited;
}

async function acknowledgeAnnouncement(req, announcementId, context, now = new Date()) {
  const { Announcement, AnnouncementReceipt } = req.models || {};
  if (!Announcement || !AnnouncementReceipt || !context?.user?._id || !isValidId(announcementId)) {
    return { ok: false, reason: "invalid" };
  }
  await publishDueAnnouncements(req, now);
  const announcement = await Announcement.findOne({ _id: announcementId, ...publicationFilter(now) }).lean();
  if (!announcement || !announcementMatchesContext(announcement, context)) {
    return { ok: false, reason: "not_found" };
  }
  if (!announcement.requiresAcknowledgement) {
    return { ok: false, reason: "not_required" };
  }

  await ensureCurrentUserReceipt(req, announcement, context);
  const receipt = await AnnouncementReceipt.findOne({ announcementId: announcement._id, userId: context.user._id });
  if (!receipt) return { ok: false, reason: "receipt" };
  if (receipt.status === "Acknowledged") return { ok: true, already: true, announcement };

  const wasUnread = receipt.status === "Unread";
  receipt.status = "Acknowledged";
  receipt.readAt = receipt.readAt || now;
  receipt.ackAt = now;
  await receipt.save();
  await Announcement.updateOne(
    { _id: announcement._id },
    { $inc: { "stats.acknowledgements": 1, ...(wasUnread ? { "stats.views": 1 } : {}) } }
  );
  return { ok: true, announcement };
}

async function getReceipts(req, announcementIds = []) {
  const { AnnouncementReceipt } = req.models || {};
  if (!AnnouncementReceipt || !announcementIds.length) return new Map();
  const rows = await AnnouncementReceipt.find({ announcementId: { $in: announcementIds } })
    .sort({ status: 1, name: 1, createdAt: 1 })
    .lean();
  const map = new Map();
  for (const row of rows) {
    const key = String(row.announcementId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function remindUnreadRecipients(req, announcement) {
  const { AnnouncementReceipt, Notification } = req.models || {};
  if (!AnnouncementReceipt || !announcement?._id) return { reminded: 0, emailed: 0, failedEmails: 0 };

  await materializeRecipients(req, announcement);
  const filter = announcement.requiresAcknowledgement
    ? { status: { $ne: "Acknowledged" } }
    : { status: "Unread" };
  const receipts = await AnnouncementReceipt.find({ announcementId: announcement._id, ...filter }).lean();

  const now = new Date();
  let reminded = 0;
  if (Notification && receipts.length) {
    const ops = receipts.map((receipt) => ({
      insertOne: {
        document: {
          audience: String(receipt.role || "").toLowerCase() === "student"
            ? "student"
            : (String(receipt.role || "").toLowerCase() === "parent" ? "parent" : "staff"),
          userId: receipt.userId,
          title: `Reminder: ${announcement.title}`,
          message: announcement.requiresAcknowledgement
            ? "Please read and acknowledge this announcement."
            : "You have an unread school announcement.",
          type: announcement.priority === "Pinned" ? "warning" : "info",
          url: String(receipt.role || "").toLowerCase() === "student"
            ? "/student/notifications"
            : (String(receipt.role || "").toLowerCase() === "parent"
              ? "/parent/announcements"
              : "/staff/announcements"),
          entityType: "Announcement",
          entityId: announcement._id,
          createdBy: req.user?.userId || req.user?._id || null,
        },
      },
    }));
    if (ops.length) await Notification.bulkWrite(ops, { ordered: false });
    reminded = receipts.length;
  }

  if (receipts.length) {
    await AnnouncementReceipt.updateMany(
      { _id: { $in: receipts.map((r) => r._id) } },
      { $inc: { reminderCount: 1 }, $set: { lastRemindedAt: now } }
    );
  }

  let emailed = 0;
  let failedEmails = 0;
  if (announcement.channels?.email) {
    const fakeUsers = receipts
      .filter((r) => r.email)
      .map((r) => ({ _id: r.userId, email: r.email, firstName: r.name, roles: [str(r.role).toLowerCase()] }));
    const result = await deliverEmailChannel(req, announcement, fakeUsers);
    emailed = result.sent;
    failedEmails = result.failed;
  }

  return { reminded, emailed, failedEmails };
}

module.exports = {
  STAFF_ROLES,
  escapeRegex,
  normalizeAudienceType,
  publicationFilter,
  announcementMatchesContext,
  studentMatchesAudience,
  staffMatchesAudience,
  resolveDirectRecipients,
  materializeRecipients,
  activateAnnouncement,
  expireAnnouncements,
  publishDueAnnouncements,
  buildStudentContext,
  buildParentContext,
  buildStaffContext,
  ensureCurrentUserReceipt,
  markAnnouncementRead,
  findVisibleAnnouncements,
  acknowledgeAnnouncement,
  getReceipts,
  remindUnreadRecipients,
};

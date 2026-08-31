const crypto = require("crypto");
const mongoose = require("mongoose");

const LETTER_TYPES = new Set([
  "Admission Letter",
  "Registration Letter",
  "Bonafide Student Letter",
  "Study Load Confirmation",
]);
const JOB_STATUSES = new Set(["Draft", "Published", "Closed", "Archived"]);
const APP_STATUSES = new Set(["Submitted", "Reviewing", "Shortlisted", "Interview", "Accepted", "Rejected", "Withdrawn"]);
const LETTER_STATUSES = new Set(["Pending", "Approved", "Rejected", "Ready", "Collected", "Cancelled"]);

const str = (value, max = 300) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (value) => {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};
const sameId = (a, b) => !!idText(a) && idText(a) === idText(b);
const isValidId = (value) => mongoose.Types.ObjectId.isValid(String(value || "").trim());
const cleanYear = (value) => str(value, 20);
const cleanTerm = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : 0;
};

function activeStudent(student) {
  return !!student && student.isDeleted !== true && String(student.status || "active").toLowerCase() === "active";
}

async function claimStudentSelfServiceLease(Student, { studentId, actorUserId = null, now = new Date(), ttlMs = 20000 } = {}) {
  if (!Student || !isValidId(studentId)) throw new Error("Student self-service is not configured.");
  const token = crypto.randomBytes(18).toString("hex");
  const expiresAt = new Date(now.getTime() + Math.max(5000, Math.min(60000, Number(ttlMs) || 20000)));
  const claimed = await Student.findOneAndUpdate(
    {
      _id: studentId,
      status: "active",
      isDeleted: { $ne: true },
      $or: [
        { selfServiceLeaseToken: { $in: ["", null] } },
        { selfServiceLeaseToken: { $exists: false } },
        { selfServiceLeaseExpiresAt: { $lte: now } },
        { selfServiceLeaseExpiresAt: null },
      ],
    },
    { $set: { selfServiceLeaseToken: token, selfServiceLeaseExpiresAt: expiresAt, selfServiceLeaseBy: actorUserId || null } },
    { new: true }
  ).lean();
  if (!claimed) throw new Error("Another student self-service update is in progress. Please try again.");
  return { token, student: claimed };
}

async function releaseStudentSelfServiceLease(Student, { studentId, token } = {}) {
  if (!Student || !studentId || !token) return;
  await Student.updateOne(
    { _id: studentId, selfServiceLeaseToken: token },
    { $set: { selfServiceLeaseToken: "", selfServiceLeaseExpiresAt: null, selfServiceLeaseBy: null } }
  ).catch(() => {});
}

function subjectMatchesStudent(subject, student) {
  if (!subject || !student || subject.isDeleted === true || String(subject.status || "").toLowerCase() !== "active") return false;

  const studentClassId = idText(student.classId);
  const subjectClassId = idText(subject.classId);
  const studentLevel = str(student.classLevel || student.level, 20).toUpperCase();
  const subjectLevel = str(subject.classLevel, 20).toUpperCase();

  if (subjectClassId && studentClassId) {
    if (subjectClassId !== studentClassId) return false;
  } else if (subjectLevel && studentLevel && subjectLevel !== studentLevel) {
    return false;
  } else if (!subjectClassId && !subjectLevel) {
    return false;
  }

  const scopedPairs = [
    [subject.sectionId, student.sectionId || student.section],
    [subject.streamId, student.streamId || student.stream],
  ];
  for (const [required, actual] of scopedPairs) {
    if (idText(required) && idText(required) !== idText(actual)) return false;
  }

  const subjectYear = cleanYear(subject.academicYear);
  const studentYear = cleanYear(student.academicYear);
  if (subjectYear && studentYear && subjectYear !== studentYear) return false;
  const subjectTerm = cleanTerm(subject.term);
  const studentTerm = cleanTerm(student.term);
  if (subjectTerm && studentTerm && subjectTerm !== studentTerm) return false;
  return true;
}

function windowMatchesStudent(window, student, now = new Date()) {
  if (!window || !student || window.isDeleted === true || String(window.status || "").toLowerCase() !== "open") return false;
  const opens = window.opensAt ? new Date(window.opensAt) : null;
  const closes = window.closesAt ? new Date(window.closesAt) : null;
  if (!opens || !closes || Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime())) return false;
  if (opens > now || closes < now) return false;
  if (cleanYear(window.academicYear) !== cleanYear(student.academicYear)) return false;
  if (cleanTerm(window.term) !== cleanTerm(student.term)) return false;

  const exact = [
    [window.classId, student.classId],
    [window.sectionId, student.sectionId || student.section],
    [window.streamId, student.streamId || student.stream],
  ];
  for (const [required, actual] of exact) if (idText(required) && idText(required) !== idText(actual)) return false;

  const requiredLevel = str(window.classLevel, 20).toUpperCase();
  const actualLevel = str(student.classLevel || student.level, 20).toUpperCase();
  if (requiredLevel && requiredLevel !== actualLevel) return false;
  return true;
}

function windowSpecificity(window) {
  return [window?.classId, window?.classLevel, window?.sectionId, window?.streamId].filter((x) => str(x, 100)).length;
}

function pickActiveRegistrationWindow(windows = [], student, now = new Date()) {
  return windows
    .filter((w) => windowMatchesStudent(w, student, now))
    .sort((a, b) => windowSpecificity(b) - windowSpecificity(a) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
}

async function blockingRegistrationHolds(StudentHold, student, now = new Date()) {
  const inline = [];
  if (String(student?.status || "").toLowerCase() === "on_hold") {
    inline.push({ type: student.holdType || "academic", reason: student.holdReason || "Student account is on hold." });
  }
  if (!StudentHold || !student?._id) return inline;
  const rows = await StudentHold.find({
    studentId: student._id,
    status: "active",
    blocksSubjectRegistration: true,
    isDeleted: { $ne: true },
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  }).sort({ createdAt: -1 }).lean();
  return [...inline, ...rows];
}

async function findRegistrationWindow(RegistrationWindow, student, now = new Date()) {
  if (!RegistrationWindow || !student) return null;
  const rows = await RegistrationWindow.find({
    academicYear: cleanYear(student.academicYear),
    term: cleanTerm(student.term),
    status: "open",
    isDeleted: { $ne: true },
    opensAt: { $lte: now },
    closesAt: { $gte: now },
  }).sort({ createdAt: -1 }).limit(100).lean();
  return pickActiveRegistrationWindow(rows, student, now);
}

async function requestSubjectRegistration(models, { student, subjectId, actorUserId = null, now = new Date(), _leaseHeld = false } = {}) {
  const { Subject, CourseRegistration, RegistrationWindow, StudentHold, Student } = models || {};
  if (Student && !_leaseHeld) {
    const lease = await claimStudentSelfServiceLease(Student, { studentId: student?._id, actorUserId, now });
    try {
      return await requestSubjectRegistration(models, { student: lease.student, subjectId, actorUserId, now, _leaseHeld: true });
    } finally {
      await releaseStudentSelfServiceLease(Student, { studentId: student?._id, token: lease.token });
    }
  }
  if (!Subject || !CourseRegistration || !RegistrationWindow) throw new Error("Subject registration is not configured.");
  if (!activeStudent(student)) throw new Error("Only active students can change subject registration.");
  if (!isValidId(subjectId)) throw new Error("Invalid subject.");
  const academicYear = cleanYear(student.academicYear);
  const term = cleanTerm(student.term);
  if (!academicYear || !term) throw new Error("Student academic year and term must be configured first.");

  const [subject, window, holds] = await Promise.all([
    Subject.findOne({ _id: subjectId, status: "active" }).lean(),
    findRegistrationWindow(RegistrationWindow, student, now),
    blockingRegistrationHolds(StudentHold, student, now),
  ]);
  if (!subject || !subjectMatchesStudent(subject, student)) throw new Error("This subject is not available for your current class and term.");
  if (subject.isCompulsory !== false) throw new Error("This is a compulsory subject and does not need to be added manually.");
  if (!window) throw new Error("Subject registration is currently closed.");
  if (holds.length) throw new Error(str(holds[0].reason || "A student hold blocks subject registration.", 300));

  const existing = await CourseRegistration.findOne({ studentId: student._id, subjectId: subject._id, academicYear, term, isDeleted: { $ne: true } });
  if (existing && ["pending", "approved"].includes(existing.status)) throw new Error("This subject is already selected.");

  const maxOptional = Math.max(0, Math.min(30, Number(window.maxOptionalSubjects ?? 4) || 0));
  const activeCount = await CourseRegistration.countDocuments({
    studentId: student._id,
    academicYear,
    term,
    status: { $in: ["pending", "approved"] },
    isDeleted: { $ne: true },
  });
  if (maxOptional && activeCount >= maxOptional) throw new Error(`You can select at most ${maxOptional} optional subject(s) this term.`);

  const snapshot = {
    subjectCode: str(subject.code, 40).toUpperCase(),
    subjectTitle: str(subject.title || subject.shortTitle, 180),
    weeklyPeriods: Math.max(0, Number(subject.weeklyPeriods || 0) || 0),
  };

  if (existing) {
    const expected = Number(existing.revision || 1);
    const write = await CourseRegistration.findOneAndUpdate(
      { _id: existing._id, revision: expected, status: { $in: ["rejected", "dropped"] }, isDeleted: { $ne: true } },
      {
        $set: { status: "pending", requestedAt: now, decidedAt: null, decidedBy: null, decisionNote: "", droppedAt: null, updatedBy: actorUserId, ...snapshot },
        $push: { history: { action: "resubmitted", fromStatus: existing.status, toStatus: "pending", actorUserId, at: now } },
        $inc: { revision: 1 },
      },
      { new: true }
    );
    if (!write) throw new Error("Subject registration changed in another session. Reload and try again.");
    return write;
  }

  try {
    return await CourseRegistration.create({
      studentId: student._id,
      subjectId: subject._id,
      academicYear,
      term,
      status: "pending",
      requestedAt: now,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      history: [{ action: "submitted", fromStatus: "", toStatus: "pending", actorUserId, at: now }],
      ...snapshot,
    });
  } catch (err) {
    if (err?.code === 11000) throw new Error("This subject has already been selected for the current term.");
    throw err;
  }
}

async function dropSubjectRegistration(models, { student, registrationId, actorUserId = null, now = new Date() } = {}) {
  const { CourseRegistration, RegistrationWindow } = models || {};
  if (!CourseRegistration || !RegistrationWindow) throw new Error("Subject registration is not configured.");
  if (!activeStudent(student)) throw new Error("Only active students can change subject registration.");
  if (!isValidId(registrationId)) throw new Error("Invalid subject registration.");
  const [registration, window] = await Promise.all([
    CourseRegistration.findOne({ _id: registrationId, studentId: student._id, isDeleted: { $ne: true } }).lean(),
    findRegistrationWindow(RegistrationWindow, student, now),
  ]);
  if (!registration) throw new Error("Subject registration not found.");
  if (!window || window.allowDrop !== true) throw new Error("Dropping subjects is not allowed in the current registration window.");
  if (!["pending", "approved"].includes(registration.status)) throw new Error("This subject registration cannot be dropped.");
  const expected = Number(registration.revision || 1);
  const write = await CourseRegistration.findOneAndUpdate(
    { _id: registration._id, studentId: student._id, revision: expected, status: registration.status, isDeleted: { $ne: true } },
    {
      $set: { status: "dropped", droppedAt: now, updatedBy: actorUserId },
      $push: { history: { action: "dropped", fromStatus: registration.status, toStatus: "dropped", actorUserId, at: now } },
      $inc: { revision: 1 },
    },
    { new: true }
  );
  if (!write) throw new Error("Subject registration changed in another session. Reload and try again.");
  return write;
}

async function decideSubjectRegistration(CourseRegistration, { id, revision, status, actorUserId = null, note = "", now = new Date() } = {}) {
  if (!CourseRegistration || !isValidId(id)) throw new Error("Subject registration not found.");
  const target = String(status || "").toLowerCase();
  if (!["approved", "rejected"].includes(target)) throw new Error("Invalid registration decision.");
  const expected = Number(revision);
  if (!Number.isInteger(expected) || expected < 1) throw new Error("Registration revision is required.");
  const write = await CourseRegistration.findOneAndUpdate(
    { _id: id, revision: expected, status: "pending", isDeleted: { $ne: true } },
    {
      $set: { status: target, decidedAt: now, decidedBy: actorUserId, decisionNote: str(note, 500), updatedBy: actorUserId },
      $push: { history: { action: target, fromStatus: "pending", toStatus: target, actorUserId, note: str(note, 500), at: now } },
      $inc: { revision: 1 },
    },
    { new: true }
  );
  if (!write) throw new Error("Registration is no longer pending or changed in another session.");
  return write;
}

function safeExternalUrl(value) {
  const raw = str(value, 1000);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return ["http:", "https:"].includes(u.protocol) ? u.toString() : "";
  } catch (_) {
    return "";
  }
}

function jobVisibleToStudent(job, student, now = new Date()) {
  if (!job || job.isDeleted === true || job.status !== "Published") return false;
  if (job.publishAt && new Date(job.publishAt) > now) return false;
  if (job.deadline && new Date(job.deadline) < now) return false;
  const eligible = Array.isArray(job.eligibleClassLevels) ? job.eligibleClassLevels.map((x) => str(x, 20).toUpperCase()).filter(Boolean) : [];
  const level = str(student?.classLevel || student?.level, 20).toUpperCase();
  return !eligible.length || (!!level && eligible.includes(level));
}

const JOB_TRANSITIONS = {
  Draft: new Set(["Published", "Archived"]),
  Published: new Set(["Closed", "Archived"]),
  Closed: new Set(["Published", "Archived"]),
  Archived: new Set(),
};

async function transitionJob(JobOpportunity, { id, revision, status, actorUserId = null, now = new Date() } = {}) {
  if (!JobOpportunity || !isValidId(id)) throw new Error("Job opportunity not found.");
  if (!JOB_STATUSES.has(status)) throw new Error("Invalid job status.");
  const current = await JobOpportunity.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
  if (!current) throw new Error("Job opportunity not found.");
  if (!JOB_TRANSITIONS[current.status]?.has(status)) throw new Error(`Job cannot move from ${current.status} to ${status}.`);
  if (status === "Published" && current.deadline && new Date(current.deadline) < now) throw new Error("A job with a past deadline cannot be published.");
  const expected = Number(revision);
  if (!Number.isInteger(expected) || expected !== Number(current.revision || 1)) throw new Error("Job changed in another session. Reload and try again.");
  const write = await JobOpportunity.findOneAndUpdate(
    { _id: id, revision: expected, status: current.status, isDeleted: { $ne: true } },
    { $set: { status, updatedBy: actorUserId }, $inc: { revision: 1 } },
    { new: true }
  );
  if (!write) throw new Error("Job changed in another session. Reload and try again.");
  return write;
}

async function createJobApplication(models, { student, userId = null, jobId, coverNote = "", now = new Date() } = {}) {
  const { JobOpportunity, JobApplication } = models || {};
  if (!JobOpportunity || !JobApplication) throw new Error("Job applications are not configured.");
  if (!activeStudent(student)) throw new Error("Only active students can apply for opportunities.");
  if (!isValidId(jobId)) throw new Error("Invalid opportunity.");
  const job = await JobOpportunity.findOne({ _id: jobId, isDeleted: { $ne: true } }).lean();
  if (!job || !jobVisibleToStudent(job, student, now)) throw new Error("This opportunity is not open for applications.");
  const existing = await JobApplication.findOne({ jobId: job._id, studentId: student._id, isDeleted: { $ne: true } });
  if (existing && existing.status !== "Withdrawn") throw new Error("You have already applied for this opportunity.");
  if (existing) {
    const expected = Number(existing.revision || 1);
    const write = await JobApplication.findOneAndUpdate(
      { _id: existing._id, revision: expected, status: "Withdrawn", isDeleted: { $ne: true } },
      {
        $set: { status: "Submitted", coverNote: str(coverNote, 2000), submittedAt: now, withdrawnAt: null, decidedAt: null, decidedBy: null, userId: userId || existing.userId || null },
        $push: { history: { fromStatus: "Withdrawn", toStatus: "Submitted", actorUserId: userId, note: "Re-applied", at: now } },
        $inc: { revision: 1 },
      },
      { new: true }
    );
    if (!write) throw new Error("Application changed in another session. Reload and try again.");
    return write;
  }
  try {
    return await JobApplication.create({
      jobId: job._id,
      studentId: student._id,
      userId: userId || null,
      coverNote: str(coverNote, 2000),
      status: "Submitted",
      submittedAt: now,
      history: [{ fromStatus: "", toStatus: "Submitted", actorUserId: userId, at: now }],
    });
  } catch (err) {
    if (err?.code === 11000) throw new Error("You have already applied for this opportunity.");
    throw err;
  }
}

async function withdrawJobApplication(JobApplication, { student, applicationId, userId = null, now = new Date() } = {}) {
  if (!JobApplication || !isValidId(applicationId)) throw new Error("Application not found.");
  const current = await JobApplication.findOne({ _id: applicationId, studentId: student?._id, isDeleted: { $ne: true } }).lean();
  if (!current) throw new Error("Application not found.");
  if (!["Submitted", "Reviewing", "Shortlisted"].includes(current.status)) throw new Error("This application can no longer be withdrawn online.");
  const expected = Number(current.revision || 1);
  const write = await JobApplication.findOneAndUpdate(
    { _id: current._id, studentId: student._id, revision: expected, status: current.status, isDeleted: { $ne: true } },
    {
      $set: { status: "Withdrawn", withdrawnAt: now },
      $push: { history: { fromStatus: current.status, toStatus: "Withdrawn", actorUserId: userId, at: now } },
      $inc: { revision: 1 },
    },
    { new: true }
  );
  if (!write) throw new Error("Application changed in another session. Reload and try again.");
  return write;
}

const APP_TRANSITIONS = {
  Submitted: new Set(["Reviewing", "Shortlisted", "Rejected"]),
  Reviewing: new Set(["Shortlisted", "Interview", "Rejected"]),
  Shortlisted: new Set(["Interview", "Rejected"]),
  Interview: new Set(["Accepted", "Rejected"]),
  Accepted: new Set(),
  Rejected: new Set(),
  Withdrawn: new Set(),
};

async function transitionJobApplication(JobApplication, { id, revision, status, actorUserId = null, note = "", now = new Date() } = {}) {
  if (!JobApplication || !isValidId(id) || !APP_STATUSES.has(status)) throw new Error("Invalid application update.");
  const current = await JobApplication.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
  if (!current) throw new Error("Application not found.");
  if (!APP_TRANSITIONS[current.status]?.has(status)) throw new Error(`Application cannot move from ${current.status} to ${status}.`);
  const expected = Number(revision);
  if (!Number.isInteger(expected) || expected !== Number(current.revision || 1)) throw new Error("Application changed in another session. Reload and try again.");
  const terminal = ["Accepted", "Rejected"].includes(status);
  const write = await JobApplication.findOneAndUpdate(
    { _id: id, revision: expected, status: current.status, isDeleted: { $ne: true } },
    {
      $set: { status, decidedAt: terminal ? now : null, decidedBy: terminal ? actorUserId : null },
      $push: { history: { fromStatus: current.status, toStatus: status, actorUserId, note: str(note, 500), at: now } },
      $inc: { revision: 1 },
    },
    { new: true }
  );
  if (!write) throw new Error("Application changed in another session. Reload and try again.");
  return write;
}

function newLetterRequestNumber(now = new Date(), randomBytes = crypto.randomBytes) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `CA-LTR-${y}${m}${d}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

async function createLetterRequest(modelsOrLetterRequest, { student, userId = null, type, purpose = "", now = new Date(), maxPerTerm = 5, _leaseHeld = false } = {}) {
  const models = modelsOrLetterRequest && modelsOrLetterRequest.LetterRequest ? modelsOrLetterRequest : null;
  const LetterRequest = models ? models.LetterRequest : modelsOrLetterRequest;
  const Student = models?.Student || null;
  if (!LetterRequest) throw new Error("Official letter requests are not configured.");
  if (Student && !_leaseHeld) {
    const lease = await claimStudentSelfServiceLease(Student, { studentId: student?._id, actorUserId: userId, now });
    try {
      return await createLetterRequest(models, { student: lease.student, userId, type, purpose, now, maxPerTerm, _leaseHeld: true });
    } finally {
      await releaseStudentSelfServiceLease(Student, { studentId: student?._id, token: lease.token });
    }
  }
  if (!activeStudent(student)) throw new Error("Only active students can request official letters.");
  const cleanType = str(type, 80);
  if (!LETTER_TYPES.has(cleanType)) throw new Error("Unsupported official letter type.");
  const academicYear = cleanYear(student.academicYear);
  const term = cleanTerm(student.term);
  if (!academicYear || !term) throw new Error("Student academic year and term must be configured first.");

  const duplicate = await LetterRequest.findOne({
    studentId: student._id,
    type: cleanType,
    academicYear,
    term,
    status: { $in: ["Pending", "Approved", "Ready"] },
    isDeleted: { $ne: true },
  }).lean();
  if (duplicate) throw new Error("You already have an active request for this letter type.");

  const count = await LetterRequest.countDocuments({
    studentId: student._id,
    academicYear,
    term,
    status: { $nin: ["Cancelled"] },
    isDeleted: { $ne: true },
  });
  const cap = Math.max(1, Math.min(20, Number(maxPerTerm) || 5));
  if (count >= cap) throw new Error(`You can submit at most ${cap} official letter requests per term.`);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await LetterRequest.create({
        requestNumber: newLetterRequestNumber(now),
        studentId: student._id,
        userId: userId || null,
        type: cleanType,
        purpose: str(purpose, 1000),
        academicYear,
        term,
        status: "Pending",
        requestedAt: now,
        history: [{ fromStatus: "", toStatus: "Pending", actorUserId: userId, at: now }],
      });
    } catch (err) {
      if (err?.code === 11000 && (err?.keyPattern?.requestNumber || /requestNumber/i.test(err.message || ""))) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a unique official letter request number.");
}

async function cancelLetterRequest(LetterRequest, { student, requestId, userId = null, now = new Date() } = {}) {
  if (!LetterRequest || !isValidId(requestId)) throw new Error("Letter request not found.");
  const current = await LetterRequest.findOne({ _id: requestId, studentId: student?._id, status: "Pending", isDeleted: { $ne: true } }).lean();
  if (!current) throw new Error("Only a pending letter request can be cancelled.");
  const expected = Number(current.revision || 1);
  const write = await LetterRequest.findOneAndUpdate(
    { _id: current._id, studentId: student._id, revision: expected, status: "Pending", isDeleted: { $ne: true } },
    {
      $set: { status: "Cancelled" },
      $push: { history: { fromStatus: "Pending", toStatus: "Cancelled", actorUserId: userId, at: now } },
      $inc: { revision: 1 },
    },
    { new: true }
  );
  if (!write) throw new Error("Letter request changed in another session. Reload and try again.");
  return write;
}

const LETTER_TRANSITIONS = {
  Pending: new Set(["Approved", "Rejected"]),
  Approved: new Set(["Ready", "Rejected"]),
  Ready: new Set(["Collected"]),
  Rejected: new Set(),
  Collected: new Set(),
  Cancelled: new Set(),
};

async function transitionLetterRequest(LetterRequest, { id, revision, status, actorUserId = null, note = "", issuedSnapshot = null, now = new Date() } = {}) {
  if (!LetterRequest || !isValidId(id) || !LETTER_STATUSES.has(status)) throw new Error("Invalid letter request update.");
  const current = await LetterRequest.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
  if (!current) throw new Error("Letter request not found.");
  if (!LETTER_TRANSITIONS[current.status]?.has(status)) throw new Error(`Letter request cannot move from ${current.status} to ${status}.`);
  const expected = Number(revision);
  if (!Number.isInteger(expected) || expected !== Number(current.revision || 1)) throw new Error("Letter request changed in another session. Reload and try again.");
  const set = { status, reviewNote: str(note, 500) };
  if (["Approved", "Rejected"].includes(status)) Object.assign(set, { reviewedAt: now, reviewedBy: actorUserId });
  if (status === "Ready") {
    const snap = issuedSnapshot || {};
    const studentName = str(snap.studentName, 220);
    if (!studentName) throw new Error("A stable student identity snapshot is required before releasing an official letter.");
    set.readyAt = now;
    set.issuedSnapshot = {
      studentName,
      registrationNumber: str(snap.registrationNumber, 100),
      classLevel: str(snap.classLevel, 40),
      academicYear: cleanYear(snap.academicYear || current.academicYear),
      term: cleanTerm(snap.term || current.term),
      purpose: str(snap.purpose ?? current.purpose, 1000),
    };
  }
  if (status === "Collected") set.collectedAt = now;
  const write = await LetterRequest.findOneAndUpdate(
    { _id: id, revision: expected, status: current.status, isDeleted: { $ne: true } },
    {
      $set: set,
      $push: { history: { fromStatus: current.status, toStatus: status, actorUserId, note: str(note, 500), at: now } },
      $inc: { revision: 1 },
    },
    { new: true }
  );
  if (!write) throw new Error("Letter request changed in another session. Reload and try again.");
  return write;
}

function documentSigningSecret() {
  return String(process.env.DOCUMENT_SIGNING_SECRET || process.env.TRANSCRIPT_SIGNING_SECRET || "");
}

function assertDocumentSigningConfigured() {
  const secret = documentSigningSecret();
  if (Buffer.byteLength(secret) < 32) throw new Error("DOCUMENT_SIGNING_SECRET or TRANSCRIPT_SIGNING_SECRET must be configured with at least 32 bytes.");
  return secret;
}

function letterCredentialPayload(letter = {}) {
  const readyAt = letter.readyAt ? new Date(letter.readyAt).toISOString() : "";
  const snap = letter.issuedSnapshot || {};
  return [
    str(letter.requestNumber, 80), idText(letter.studentId), str(letter.type, 80), readyAt,
    str(snap.studentName, 220), str(snap.registrationNumber, 100), str(snap.classLevel, 40),
    cleanYear(snap.academicYear || letter.academicYear), cleanTerm(snap.term || letter.term),
    str(snap.purpose ?? letter.purpose, 1000),
  ].join("|");
}

function signLetterCredential(letter = {}, secret = documentSigningSecret()) {
  if (Buffer.byteLength(String(secret || "")) < 32) return "";
  return crypto.createHmac("sha256", secret).update(letterCredentialPayload(letter)).digest("hex");
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return !!left.length && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyLetterCredential(letter = {}, signature = "", secret = documentSigningSecret()) {
  if (!letter || letter.isDeleted === true) return { ok: false, reason: "Letter is not verifiable." };
  if (!["Ready", "Collected"].includes(letter.status) || !letter.readyAt) return { ok: false, reason: "Letter is not ready or issued." };
  if (!str(letter.issuedSnapshot?.studentName, 220)) return { ok: false, reason: "Letter issuance snapshot is missing; Registry must reissue this document." };
  if (Buffer.byteLength(String(secret || "")) < 32) return { ok: false, reason: "Verification secret not configured on server.", serverError: true };
  const expected = signLetterCredential(letter, secret);
  if (!timingSafeEqualText(String(signature || "").toLowerCase(), expected)) return { ok: false, reason: "Invalid verification signature." };
  return { ok: true };
}

module.exports = {
  LETTER_TYPES,
  str,
  idText,
  sameId,
  isValidId,
  cleanYear,
  cleanTerm,
  activeStudent,
  claimStudentSelfServiceLease,
  releaseStudentSelfServiceLease,
  subjectMatchesStudent,
  windowMatchesStudent,
  pickActiveRegistrationWindow,
  blockingRegistrationHolds,
  findRegistrationWindow,
  requestSubjectRegistration,
  dropSubjectRegistration,
  decideSubjectRegistration,
  safeExternalUrl,
  jobVisibleToStudent,
  transitionJob,
  createJobApplication,
  withdrawJobApplication,
  transitionJobApplication,
  newLetterRequestNumber,
  createLetterRequest,
  cancelLetterRequest,
  transitionLetterRequest,
  documentSigningSecret,
  assertDocumentSigningConfigured,
  letterCredentialPayload,
  signLetterCredential,
  verifyLetterCredential,
};

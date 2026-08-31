const crypto = require("crypto");
const mongoose = require("mongoose");

const RESERVATION_STATUSES = ["Pending", "Approved", "Denied", "Fulfilled", "Cancelled"];
const FINE_STATUSES = ["Pending", "Paid", "Waived"];
const HOLD_STATUSES = ["Active Hold", "Released"];
const HOLD_TYPES = ["Library Hold", "Clearance Hold", "Borrowing Hold"];
const BOOK_STATUSES = ["Available", "Borrowed", "Reserved", "Damaged"];
const BOOK_CATEGORIES = ["Computer Science", "Mathematics", "Business", "Literature", "Other"];
const BOOK_FORMATS = ["Book", "E-book", "Journal"];
const DEFAULT_POLICY = Object.freeze({ fineRate: 1000, loanDays: 14, maxRenewals: 1 });

const str = (value, max = 1000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const isValidId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactRegex = (value) => new RegExp(`^${escapeRegex(str(value, 180))}$`, "i");
const actorUserId = (req) => req?.user?.userId || req?.user?._id || req?.session?.tenantUser?.id || null;

function borrowerName(student) {
  return str(student?.fullName || [student?.firstName, student?.middleName, student?.lastName].filter(Boolean).join(" ") || student?.regNo || "Student", 160);
}

function codeCandidate(prefix, now = new Date(), bytes = 4) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${date}-${crypto.randomBytes(bytes).toString("hex").toUpperCase()}`;
}

async function uniqueCode(Model, field, prefix, now = new Date()) {
  for (let i = 0; i < 16; i += 1) {
    const candidate = codeCandidate(prefix, now);
    const exists = typeof Model.exists === "function"
      ? await Model.exists({ [field]: candidate })
      : await Model.findOne({ [field]: candidate }).lean();
    if (!exists) return candidate;
  }
  throw new Error(`Could not allocate a unique ${prefix} identifier.`);
}

function normalizePolicy(raw = {}) {
  const fineRate = Number(raw.fineRate);
  const loanDays = Number(raw.loanDays);
  const maxRenewals = Number(raw.maxRenewals);
  return {
    fineRate: Number.isFinite(fineRate) ? Math.max(0, Math.min(1000000, Math.round(fineRate))) : DEFAULT_POLICY.fineRate,
    loanDays: Number.isFinite(loanDays) ? Math.max(1, Math.min(365, Math.round(loanDays))) : DEFAULT_POLICY.loanDays,
    maxRenewals: Number.isFinite(maxRenewals) ? Math.max(0, Math.min(12, Math.round(maxRenewals))) : DEFAULT_POLICY.maxRenewals,
  };
}

async function readPolicy(Setting) {
  if (!Setting) return { ...DEFAULT_POLICY };
  const row = await Setting.findOne({ key: "library_policy", isDeleted: { $ne: true } }).lean().catch(() => null);
  return normalizePolicy(row?.value && typeof row.value === "object" ? row.value : {});
}

async function resolveStudent(models, input = {}) {
  const Student = models?.Student;
  if (!Student) throw new Error("Student model is unavailable.");
  const studentId = str(input.studentId, 80);
  const regNo = str(input.regNo, 80);
  const name = str(input.studentName || input.borrowerName, 160);
  if (studentId && isValidId(studentId)) {
    const row = await Student.findOne({ _id: studentId, isDeleted: { $ne: true } });
    if (row) return row;
  }
  if (regNo) {
    const row = await Student.findOne({ regNo: exactRegex(regNo), isDeleted: { $ne: true } });
    if (row) return row;
  }
  if (name) {
    const rows = await Student.find({
      isDeleted: { $ne: true },
      $or: [{ fullName: exactRegex(name) }, { firstName: exactRegex(name) }],
    }).limit(2);
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) throw new Error("More than one student matches that name. Use the registration number.");
  }
  throw new Error("A valid student registration number is required.");
}

async function notifyStudent(models, student, payload = {}) {
  const Notification = models?.Notification;
  if (!Notification || !student?.userId) return null;
  return Notification.create({
    audience: "student",
    userId: student.userId,
    title: str(payload.title || "Library update", 180),
    message: str(payload.message || "Your library record was updated.", 2000),
    type: str(payload.type || "info", 30),
    url: "/student/library",
    entityType: str(payload.entityType || "LibraryBook", 80),
    entityId: payload.entityId || null,
    createdBy: payload.createdBy || null,
  }).catch(() => null);
}

function dueDateFrom(now, days) {
  const d = new Date(now || Date.now());
  d.setUTCDate(d.getUTCDate() + Number(days || DEFAULT_POLICY.loanDays));
  return d;
}

async function activeHoldForStudent(models, studentId) {
  const Hold = models?.LibraryHold;
  if (!Hold) return null;
  return Hold.findOne({ student: studentId, status: "Active Hold", isDeleted: { $ne: true } }).lean();
}

async function approvedReservationsForOther(models, bookId, studentId) {
  const Reservation = models?.LibraryReservation;
  if (!Reservation) return 0;
  return Reservation.countDocuments({
    book: bookId,
    student: { $ne: studentId },
    status: "Approved",
    isDeleted: { $ne: true },
  });
}

async function claimBookCopy(LibraryBook, bookId, actorId = null) {
  const book = await LibraryBook.findOneAndUpdate(
    {
      _id: bookId,
      isDeleted: { $ne: true },
      status: { $ne: "Damaged" },
      available: { $gt: 0 },
    },
    { $inc: { available: -1 }, $set: { updatedBy: actorId } },
    { new: true }
  );
  if (!book) throw new Error("No available copy for this book.");
  if (Number(book.available || 0) <= 0 && book.status !== "Damaged") {
    book.status = "Borrowed";
    await book.save();
  }
  return book;
}

async function releaseBookCopy(models, bookId, actorId = null) {
  const { LibraryBook, LibraryReservation } = models || {};
  if (!LibraryBook) return null;
  let book = await LibraryBook.findOneAndUpdate(
    { _id: bookId, $expr: { $lt: [{ $ifNull: ["$available", 0] }, { $ifNull: ["$copies", 0] }] } },
    { $inc: { available: 1 }, $set: { updatedBy: actorId } },
    { new: true }
  );
  if (!book) book = await LibraryBook.findById(bookId);
  if (!book || book.status === "Damaged") return book;
  const hasApprovedReservation = LibraryReservation
    ? !!(await LibraryReservation.exists({ book: bookId, status: "Approved", isDeleted: { $ne: true } }))
    : false;
  const next = hasApprovedReservation ? "Reserved" : (Number(book.available || 0) > 0 ? "Available" : "Borrowed");
  if (book.status !== next) {
    book.status = next;
    book.updatedBy = actorId;
    await book.save();
  }
  return book;
}

async function createLoan(models, input = {}) {
  const { LibraryBook, LibraryLoan, LibraryReservation } = models || {};
  if (!LibraryBook || !LibraryLoan) throw new Error("Library loan service is unavailable.");
  const student = input.student || await resolveStudent(models, input);
  const bookId = str(input.bookId, 80);
  if (!isValidId(bookId)) throw new Error("Choose a valid book.");
  if (await activeHoldForStudent(models, student._id)) throw new Error("This student has an active library hold.");
  const catalogueBook = await LibraryBook.findOne({ _id: bookId, isDeleted: { $ne: true } }).lean();
  if (!catalogueBook || catalogueBook.status === "Damaged") throw new Error("That book is not available for borrowing.");
  const reservedForOthers = await approvedReservationsForOther(models, bookId, student._id);
  if (reservedForOthers >= Number(catalogueBook.available || 0)) throw new Error("Available copies are being held for approved reservations.");
  const existing = await LibraryLoan.findOne({ book: bookId, borrowerType: "student", borrowerId: student._id, status: { $in: ["issued", "overdue"] }, isDeleted: { $ne: true } }).lean();
  if (existing) throw new Error("This student already has an active loan for this book.");

  const policy = input.policy || await readPolicy(models.Setting);
  const now = input.now || new Date();
  let dueAt = input.dueAt || input.dueDate ? new Date(input.dueAt || input.dueDate) : dueDateFrom(now, policy.loanDays);
  if (Number.isNaN(dueAt.getTime()) || dueAt <= new Date(now)) dueAt = dueDateFrom(now, policy.loanDays);
  const book = await claimBookCopy(LibraryBook, bookId, input.actorUserId || null);
  try {
    const loanNo = await uniqueCode(LibraryLoan, "loanNo", "LN", now);
    const loan = await LibraryLoan.create({
      loanNo,
      book: book._id,
      borrowerType: "student",
      borrowerId: student._id,
      student: student._id,
      studentId: student._id,
      borrowerName: borrowerName(student),
      regNo: str(student.regNo, 80),
      bookTitle: str(book.title, 300),
      copyId: str(input.copyId, 80),
      issuedAt: now,
      dueAt,
      status: "issued",
      notes: str(input.note || input.notes, 1000),
      createdBy: input.actorUserId || null,
      updatedBy: input.actorUserId || null,
    });
    if (LibraryReservation) {
      const reservation = await LibraryReservation.findOne({ book: book._id, student: student._id, status: { $in: ["Pending", "Approved"] }, isDeleted: { $ne: true } }).sort({ requestedAt: 1 });
      if (reservation) {
        await setReservationStatus(models, reservation, "Fulfilled", input.actorUserId || null);
      }
    }
    return { loan, student, book };
  } catch (error) {
    await releaseBookCopy(models, book._id, input.actorUserId || null).catch(() => null);
    if (error?.code === 11000) throw new Error("This student already has an active loan for this book.");
    throw error;
  }
}

async function createFine(models, input = {}) {
  const Fine = models?.LibraryFine;
  if (!Fine) throw new Error("Library fine service is unavailable.");
  const student = input.student || await resolveStudent(models, input);
  const amount = Number(input.amount);
  const reason = str(input.reason, 1000);
  if (!reason) throw new Error("Fine reason is required.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Fine amount must be greater than zero.");
  const now = input.now || new Date();
  const fineNo = await uniqueCode(Fine, "fineNo", "LF", now);
  const fine = await Fine.create({
    fineNo,
    book: input.bookId && isValidId(input.bookId) ? input.bookId : null,
    loan: input.loanId && isValidId(input.loanId) ? input.loanId : null,
    student: student._id,
    studentId: student._id,
    studentName: borrowerName(student),
    regNo: str(student.regNo, 80),
    bookTitle: str(input.bookTitle, 300),
    reason,
    amount: Math.round(amount),
    status: "Pending",
    createdAtRecord: now,
    note: str(input.note, 1500),
    createdBy: input.actorUserId || null,
    updatedBy: input.actorUserId || null,
  });
  return { fine, student };
}

async function returnLoan(models, input = {}) {
  const { LibraryLoan, LibraryFine } = models || {};
  if (!LibraryLoan) throw new Error("Library loan service is unavailable.");
  const loanId = str(input.loanId, 80);
  if (!isValidId(loanId)) throw new Error("Invalid loan record.");
  const now = input.now || new Date();
  const loan = await LibraryLoan.findOneAndUpdate(
    { _id: loanId, status: { $in: ["issued", "overdue"] }, isDeleted: { $ne: true } },
    { $set: { status: "returned", returnedAt: now, updatedBy: input.actorUserId || null } },
    { new: true }
  );
  if (!loan) throw new Error("Active loan record not found.");
  await releaseBookCopy(models, loan.book, input.actorUserId || null);

  let fine = null;
  const policy = input.policy || await readPolicy(models.Setting);
  const lateMs = new Date(now).getTime() - new Date(loan.dueAt).getTime();
  const lateDays = lateMs > 0 ? Math.ceil(lateMs / 86400000) : 0;
  if (lateDays > 0 && policy.fineRate > 0 && LibraryFine) {
    const exists = await LibraryFine.findOne({ loan: loan._id, isDeleted: { $ne: true } }).lean();
    if (!exists) {
      const Student = models.Student;
      const student = Student ? await Student.findById(loan.student || loan.studentId || loan.borrowerId) : null;
      if (student) {
        ({ fine } = await createFine(models, {
          student,
          bookId: loan.book,
          loanId: loan._id,
          bookTitle: loan.bookTitle,
          reason: `Overdue return (${lateDays} day${lateDays === 1 ? "" : "s"})`,
          amount: lateDays * policy.fineRate,
          now,
          actorUserId: input.actorUserId || null,
        }));
      }
    }
  }
  return { loan, fine, lateDays };
}

async function renewLoan(models, input = {}) {
  const { LibraryLoan, LibraryReservation } = models || {};
  if (!LibraryLoan) throw new Error("Library loan service is unavailable.");
  const student = input.student || await resolveStudent(models, input);
  const policy = input.policy || await readPolicy(models.Setting);
  const loan = await LibraryLoan.findOne({
    _id: input.loanId,
    borrowerType: "student",
    borrowerId: student._id,
    status: { $in: ["issued", "overdue"] },
    isDeleted: { $ne: true },
  });
  if (!loan) throw new Error("Active loan record not found.");
  if (await activeHoldForStudent(models, student._id)) throw new Error("This student has an active library hold.");
  if (Number(loan.renewalCount || 0) >= policy.maxRenewals) throw new Error("This loan has reached the renewal limit.");
  if (LibraryReservation) {
    const waiting = await LibraryReservation.exists({
      book: loan.book,
      student: { $ne: student._id },
      status: { $in: ["Pending", "Approved"] },
      isDeleted: { $ne: true },
    });
    if (waiting) throw new Error("This item cannot be renewed because another student is waiting for it.");
  }
  const now = input.now || new Date();
  const base = new Date(loan.dueAt) > new Date(now) ? new Date(loan.dueAt) : new Date(now);
  loan.dueAt = dueDateFrom(base, policy.loanDays);
  loan.status = "issued";
  loan.renewalCount = Number(loan.renewalCount || 0) + 1;
  loan.lastRenewedAt = now;
  loan.updatedBy = input.actorUserId || null;
  await loan.save();
  return loan;
}

function reservationTransitionAllowed(from, to) {
  if (!RESERVATION_STATUSES.includes(to)) return false;
  if (from === to) return true;
  if (["Denied", "Fulfilled", "Cancelled"].includes(from)) return false;
  if (from === "Approved") return ["Denied", "Fulfilled", "Cancelled"].includes(to);
  return ["Approved", "Denied", "Cancelled"].includes(to);
}

async function createReservation(models, input = {}) {
  const { LibraryBook, LibraryReservation, LibraryLoan } = models || {};
  if (!LibraryBook || !LibraryReservation) throw new Error("Library reservation service is unavailable.");
  const student = input.student || await resolveStudent(models, input);
  const bookId = str(input.bookId, 80);
  if (!isValidId(bookId)) throw new Error("Choose a valid book.");
  const book = await LibraryBook.findOne({ _id: bookId, isDeleted: { $ne: true } });
  if (!book || book.status === "Damaged") throw new Error("That book is not available for reservation.");
  if (LibraryLoan) {
    const ownLoan = await LibraryLoan.exists({ book: book._id, borrowerId: student._id, status: { $in: ["issued", "overdue"] }, isDeleted: { $ne: true } });
    if (ownLoan) throw new Error("You already have this book on loan.");
  }
  const active = await LibraryReservation.findOne({ book: book._id, student: student._id, status: { $in: ["Pending", "Approved"] }, isDeleted: { $ne: true } }).lean();
  if (active) throw new Error("You already have an active reservation for this book.");
  const now = input.now || new Date();
  const reservationNo = await uniqueCode(LibraryReservation, "reservationNo", "RSV", now);
  const reservation = await LibraryReservation.create({
    reservationNo,
    book: book._id,
    student: student._id,
    studentId: student._id,
    studentName: borrowerName(student),
    regNo: str(student.regNo, 80),
    bookTitle: str(book.title, 300),
    priority: input.priority === "High" ? "High" : "Normal",
    status: "Pending",
    requestedAt: now,
    note: str(input.note, 1500),
    createdBy: input.actorUserId || null,
    updatedBy: input.actorUserId || null,
  });
  return { reservation, student, book };
}

async function setReservationStatus(models, reservation, nextStatus, actorId = null) {
  if (!reservation) throw new Error("Reservation not found.");
  const next = str(nextStatus, 30);
  if (!reservationTransitionAllowed(reservation.status, next)) throw new Error(`Reservation cannot move from ${reservation.status} to ${next}.`);
  const now = new Date();
  if (next === "Approved" && reservation.status !== "Approved") {
    const book = models?.LibraryBook ? await models.LibraryBook.findById(reservation.book).lean() : null;
    if (!book || book.status === "Damaged") throw new Error("This book is not available for reservation approval.");
    const approved = await models.LibraryReservation.countDocuments({ _id: { $ne: reservation._id }, book: reservation.book, status: "Approved", isDeleted: { $ne: true } });
    if (approved >= Number(book.available || 0)) throw new Error("No uncommitted available copy remains for another approved reservation.");
  }
  reservation.status = next;
  if (["Approved", "Denied"].includes(next)) reservation.decidedAt = now;
  if (next === "Fulfilled") reservation.fulfilledAt = now;
  reservation.updatedBy = actorId;
  await reservation.save();
  const book = models?.LibraryBook ? await models.LibraryBook.findById(reservation.book) : null;
  if (book && book.status !== "Damaged") {
    if (next === "Approved" && Number(book.available || 0) > 0) book.status = "Reserved";
    if (["Denied", "Cancelled", "Fulfilled"].includes(next) && book.status === "Reserved") {
      const otherApproved = await models.LibraryReservation.exists({ _id: { $ne: reservation._id }, book: book._id, status: "Approved", isDeleted: { $ne: true } });
      book.status = otherApproved ? "Reserved" : (Number(book.available || 0) > 0 ? "Available" : "Borrowed");
    }
    book.updatedBy = actorId;
    await book.save();
  }
  return reservation;
}

async function setFineStatus(fine, nextStatus, actorId = null) {
  if (!fine) throw new Error("Fine not found.");
  const next = str(nextStatus, 30);
  if (!FINE_STATUSES.includes(next)) throw new Error("Invalid fine status.");
  if (["Paid", "Waived"].includes(fine.status) && next !== fine.status) throw new Error(`${fine.status} fines are terminal.`);
  fine.status = next;
  fine.paidAt = next === "Paid" ? (fine.paidAt || new Date()) : fine.paidAt;
  fine.waivedAt = next === "Waived" ? (fine.waivedAt || new Date()) : fine.waivedAt;
  fine.updatedBy = actorId;
  await fine.save();
  return fine;
}

async function createHold(models, input = {}) {
  const Hold = models?.LibraryHold;
  if (!Hold) throw new Error("Library hold service is unavailable.");
  const student = input.student || await resolveStudent(models, input);
  const type = HOLD_TYPES.includes(str(input.type, 40)) ? str(input.type, 40) : "Library Hold";
  const reason = str(input.reason, 1000);
  if (!reason) throw new Error("Hold reason is required.");
  const existing = await Hold.findOne({ student: student._id, type, status: "Active Hold", isDeleted: { $ne: true } }).lean();
  if (existing) throw new Error(`This student already has an active ${type.toLowerCase()}.`);
  const now = input.now || new Date();
  const holdNo = await uniqueCode(Hold, "holdNo", "HLD", now);
  const hold = await Hold.create({
    holdNo,
    book: input.bookId && isValidId(input.bookId) ? input.bookId : null,
    student: student._id,
    studentId: student._id,
    studentName: borrowerName(student),
    regNo: str(student.regNo, 80),
    bookTitle: str(input.bookTitle, 300),
    type,
    reason,
    since: now,
    status: "Active Hold",
    note: str(input.note, 1500),
    createdBy: input.actorUserId || null,
    updatedBy: input.actorUserId || null,
  });
  return { hold, student };
}

async function setHoldStatus(hold, nextStatus, actorId = null) {
  if (!hold) throw new Error("Hold not found.");
  const next = str(nextStatus, 30);
  if (!HOLD_STATUSES.includes(next)) throw new Error("Invalid hold status.");
  if (hold.status === "Released" && next !== "Released") throw new Error("Released holds are terminal.");
  hold.status = next;
  if (next === "Released") hold.releasedAt = hold.releasedAt || new Date();
  hold.updatedBy = actorId;
  await hold.save();
  return hold;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ""; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => str(h, 80).toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return rows.filter((r) => r.some((v) => str(v))).map((r) => Object.fromEntries(headers.map((h, i) => [h, str(r[i] || "", 1000)])));
}

module.exports = {
  RESERVATION_STATUSES, FINE_STATUSES, HOLD_STATUSES, HOLD_TYPES, BOOK_STATUSES, BOOK_CATEGORIES, BOOK_FORMATS, DEFAULT_POLICY,
  str, isValidId, escapeRegex, exactRegex, actorUserId, borrowerName, codeCandidate, uniqueCode,
  normalizePolicy, readPolicy, resolveStudent, notifyStudent, dueDateFrom, activeHoldForStudent,
  claimBookCopy, releaseBookCopy, createLoan, returnLoan, renewLoan, approvedReservationsForOther,
  reservationTransitionAllowed, createReservation, setReservationStatus,
  createFine, setFineStatus, createHold, setHoldStatus, csvCell, parseCsv,
};

const { str, exactRegex, uniqueCode } = require("../../src/services/tenant/libraryService");

async function findStudent(Student, legacy = {}) {
  if (!Student) return null;
  const regNo = str(legacy.regNo, 80);
  if (regNo) {
    const byReg = await Student.findOne({ regNo: exactRegex(regNo), isDeleted: { $ne: true } });
    if (byReg) return byReg;
  }
  const name = str(legacy.studentName || legacy.borrowerName, 160);
  if (!name) return null;
  const rows = await Student.find({ isDeleted: { $ne: true }, $or: [{ fullName: exactRegex(name) }, { firstName: exactRegex(name) }] }).limit(2);
  return rows.length === 1 ? rows[0] : null;
}

async function repairUniqueCodes(Model, field, prefix) {
  if (!Model) return 0;
  const rows = await Model.find({}).sort({ createdAt: 1, _id: 1 });
  const seen = new Set();
  let repaired = 0;
  for (const row of rows) {
    const raw = str(row[field], 80).toUpperCase();
    if (raw && !seen.has(raw)) { seen.add(raw); continue; }
    row[field] = await uniqueCode(Model, field, prefix, row.createdAt || new Date());
    await row.save();
    seen.add(row[field]);
    repaired += 1;
  }
  return repaired;
}

async function normalizeExistingLoans(models) {
  const { LibraryLoan, Student, LibraryBook } = models;
  if (!LibraryLoan) return { normalized: 0, unresolved: 0 };
  const rows = await LibraryLoan.find({});
  let normalized = 0, unresolved = 0;
  for (const row of rows) {
    let changed = false;
    if (row.status === "issued" && row.dueAt && new Date(row.dueAt) < new Date()) { row.status = "overdue"; changed = true; }
    if (row.borrowerType === "student") {
      let studentId = row.student || row.studentId || row.borrowerId;
      let student = studentId && Student ? await Student.findById(studentId).catch(() => null) : null;
      if (!student && Student) student = await findStudent(Student, row);
      if (student) {
        row.student = student._id; row.studentId = student._id; row.borrowerId = student._id;
        if (!row.borrowerName) row.borrowerName = str(student.fullName || [student.firstName, student.lastName].filter(Boolean).join(" "), 160);
        if (!row.regNo) row.regNo = str(student.regNo, 80);
        changed = true;
      } else unresolved += 1;
    }
    if (!row.bookTitle && row.book && LibraryBook) {
      const book = await LibraryBook.findById(row.book).lean().catch(() => null);
      if (book) { row.bookTitle = str(book.title, 300); changed = true; }
    }
    if (changed) { await row.save(); normalized += 1; }
  }
  return { normalized, unresolved };
}

async function migrateEmbedded(models, books) {
  const { LibraryLoan, LibraryReservation, LibraryFine, LibraryHold, Student } = models;
  const counts = { loans: 0, reservations: 0, fines: 0, holds: 0, unresolved: 0, conflicts: 0 };
  for (const book of books) {
    for (const legacy of book.borrows || []) {
      const legacyId = str(legacy._id, 80);
      if (legacyId && await LibraryLoan.exists({ legacyEmbeddedId: legacyId })) continue;
      const student = await findStudent(Student, legacy);
      if (!student) { counts.unresolved += 1; continue; }
      const active = ["Borrowed", "Overdue"].includes(legacy.status);
      if (active && await LibraryLoan.exists({ book: book._id, borrowerType: "student", borrowerId: student._id, status: { $in: ["issued", "overdue"] }, isDeleted: { $ne: true } })) { counts.conflicts += 1; continue; }
      await LibraryLoan.create({
        loanNo: await uniqueCode(LibraryLoan, "loanNo", "LN", legacy.borrowedAt || book.createdAt || new Date()),
        book: book._id, borrowerType: "student", borrowerId: student._id, student: student._id, studentId: student._id,
        borrowerName: str(student.fullName || legacy.studentName, 160), regNo: str(student.regNo || legacy.regNo, 80), bookTitle: str(book.title, 300), copyId: str(legacy.copyId, 80),
        issuedAt: legacy.borrowedAt || book.createdAt || new Date(), dueAt: legacy.dueDate || new Date(Date.now()+14*86400000), returnedAt: legacy.returnedAt || null,
        status: legacy.status === "Returned" ? "returned" : legacy.status === "Overdue" ? "overdue" : "issued", notes: str(legacy.note, 1000), legacyEmbeddedId: legacyId,
      }); counts.loans += 1;
    }
    for (const legacy of book.reservations || []) {
      const legacyId = str(legacy._id, 80);
      if (legacyId && await LibraryReservation.exists({ legacyEmbeddedId: legacyId })) continue;
      const student = await findStudent(Student, legacy);
      if (!student) { counts.unresolved += 1; continue; }
      const active = ["Pending", "Approved"].includes(legacy.status);
      if (active && await LibraryReservation.exists({ book: book._id, student: student._id, status: { $in: ["Pending", "Approved"] }, isDeleted: { $ne: true } })) { counts.conflicts += 1; continue; }
      const status = ["Pending", "Approved", "Denied", "Fulfilled"].includes(legacy.status) ? legacy.status : "Pending";
      await LibraryReservation.create({ reservationNo: await uniqueCode(LibraryReservation, "reservationNo", "RSV", legacy.requestedAt || book.createdAt || new Date()), book: book._id, student: student._id, studentId: student._id, studentName: str(student.fullName || legacy.studentName,160), regNo: str(student.regNo || legacy.regNo,80), bookTitle: str(book.title,300), priority: legacy.priority === "High" ? "High" : "Normal", status, requestedAt: legacy.requestedAt || book.createdAt || new Date(), decidedAt: ["Approved","Denied"].includes(status) ? (legacy.updatedAt || book.updatedAt || new Date()) : null, fulfilledAt: status === "Fulfilled" ? (legacy.updatedAt || book.updatedAt || new Date()) : null, note: str(legacy.note,1500), legacyEmbeddedId: legacyId }); counts.reservations += 1;
    }
    for (const legacy of book.fines || []) {
      const legacyId = str(legacy._id, 80);
      if (legacyId && await LibraryFine.exists({ legacyEmbeddedId: legacyId })) continue;
      const student = await findStudent(Student, legacy);
      if (!student) { counts.unresolved += 1; continue; }
      const status = ["Pending","Paid","Waived"].includes(legacy.status) ? legacy.status : "Pending";
      await LibraryFine.create({ fineNo: await uniqueCode(LibraryFine,"fineNo","LF",legacy.createdAt || book.createdAt || new Date()), book: book._id, student: student._id, studentId: student._id, studentName: str(student.fullName || legacy.studentName,160), regNo: str(student.regNo || legacy.regNo,80), bookTitle: str(book.title,300), reason: str(legacy.reason || "Legacy library fine",1000), amount: Math.max(0,Number(legacy.amount||0)), status, createdAtRecord: legacy.createdAt || book.createdAt || new Date(), paidAt: legacy.paidAt || (status==="Paid"?new Date():null), waivedAt: status==="Waived"?new Date():null, note: str(legacy.note,1500), legacyEmbeddedId: legacyId }); counts.fines += 1;
    }
    for (const legacy of book.holds || []) {
      const legacyId = str(legacy._id, 80);
      if (legacyId && await LibraryHold.exists({ legacyEmbeddedId: legacyId })) continue;
      const student = await findStudent(Student, legacy);
      if (!student) { counts.unresolved += 1; continue; }
      const type = ["Library Hold","Clearance Hold","Borrowing Hold"].includes(legacy.type) ? legacy.type : "Library Hold";
      const status = legacy.status === "Released" ? "Released" : "Active Hold";
      if (status === "Active Hold" && await LibraryHold.exists({ student: student._id, type, status: "Active Hold", isDeleted: { $ne: true } })) { counts.conflicts += 1; continue; }
      await LibraryHold.create({ holdNo: await uniqueCode(LibraryHold,"holdNo","HLD",legacy.since || book.createdAt || new Date()), book: book._id, student: student._id, studentId: student._id, studentName: str(student.fullName || legacy.studentName,160), regNo: str(student.regNo || legacy.regNo,80), bookTitle: str(book.title,300), type, reason: str(legacy.reason || "Legacy library hold",1000), since: legacy.since || book.createdAt || new Date(), status, releasedAt: status==="Released" ? (legacy.updatedAt || book.updatedAt || new Date()) : null, note: str(legacy.note,1500), legacyEmbeddedId: legacyId }); counts.holds += 1;
    }
  }
  return counts;
}

async function repairBookIds(LibraryBook) {
  if (!LibraryBook) return 0;
  const books = await LibraryBook.find({}).sort({ createdAt: 1, _id: 1 });
  const seen = new Set(); let repaired = 0;
  for (const book of books) {
    const code = str(book.bookId,80).toUpperCase();
    if (code && !seen.has(code)) { seen.add(code); continue; }
    book.bookId = await uniqueCode(LibraryBook,"bookId","BK",book.createdAt || new Date()); await book.save(); seen.add(book.bookId); repaired += 1;
  }
  return repaired;
}

async function syncInventory(models, books) {
  const { LibraryBook, LibraryLoan, LibraryReservation, Student } = models;
  let synced = 0, unresolvedActive = 0;
  for (const book of books) {
    const activeCanonical = await LibraryLoan.countDocuments({ book: book._id, status: { $in: ["issued","overdue"] }, isDeleted: { $ne: true } });
    let unresolved = 0;
    for (const legacy of book.borrows || []) if (["Borrowed","Overdue"].includes(legacy.status) && !(await findStudent(Student,legacy))) unresolved += 1;
    unresolvedActive += unresolved;
    const copies = Math.max(Number(book.copies || 0), activeCanonical + unresolved);
    const available = Math.max(0, copies - activeCanonical - unresolved);
    const approvedReservation = await LibraryReservation.exists({ book: book._id, status: "Approved", isDeleted: { $ne: true } });
    const status = book.status === "Damaged" ? "Damaged" : approvedReservation ? "Reserved" : available > 0 ? "Available" : "Borrowed";
    await LibraryBook.updateOne({ _id: book._id }, { $set: { copies, available: status === "Damaged" ? 0 : available, status } }); synced += 1;
  }
  return { synced, unresolvedActive };
}

async function dropLegacyIndexes(models) {
  let dropped = 0;
  const Loan = models.LibraryLoan;
  if (Loan) {
    const indexes = await Loan.collection.indexes().catch(()=>[]);
    for (const idx of indexes) {
      if (idx.unique && idx.partialFilterExpression?.status === "issued") { await Loan.collection.dropIndex(idx.name).catch(()=>null); dropped += 1; }
    }
  }
  return dropped;
}

async function migrateLibrary(models = {}) {
  if (!models.LibraryBook) return {};
  const legacyIndexesDropped = await dropLegacyIndexes(models);
  const repairedBookIds = await repairBookIds(models.LibraryBook);
  const repairedLoanNos = await repairUniqueCodes(models.LibraryLoan,"loanNo","LN");
  const repairedReservationNos = await repairUniqueCodes(models.LibraryReservation,"reservationNo","RSV");
  const repairedFineNos = await repairUniqueCodes(models.LibraryFine,"fineNo","LF");
  const repairedHoldNos = await repairUniqueCodes(models.LibraryHold,"holdNo","HLD");
  const existing = await normalizeExistingLoans(models);
  const books = await models.LibraryBook.find({});
  const embedded = await migrateEmbedded(models, books);
  const inventory = await syncInventory(models, books);
  return { books: books.length, repairedBookIds, repairedLoanNos, repairedReservationNos, repairedFineNos, repairedHoldNos, normalizedLoans: existing.normalized, unresolvedExistingLoans: existing.unresolved, ...embedded, inventorySynced: inventory.synced, unresolvedActive: inventory.unresolvedActive, legacyIndexesDropped };
}

module.exports = { migrateLibrary, findStudent, repairBookIds, repairUniqueCodes, dropLegacyIndexes };

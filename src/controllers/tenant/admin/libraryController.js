const {
  BOOK_CATEGORIES,
  BOOK_FORMATS,
  BOOK_STATUSES,
  str,
  isValidId,
  escapeRegex,
  actorUserId,
  uniqueCode,
  normalizePolicy,
  readPolicy,
  resolveStudent,
  notifyStudent,
  createLoan,
  returnLoan,
  createReservation,
  setReservationStatus,
  createFine,
  setFineStatus,
  createHold,
  setHoldStatus,
  csvCell,
  parseCsv,
} = require("../../../services/tenant/libraryService");

function actorName(req) {
  return str(req.user?.name || req.user?.fullName || req.session?.tenantUser?.name || "System", 160);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
}

function normalizeBookPayload(body = {}) {
  const copies = Math.max(0, Math.min(100000, Math.round(Number(body.copies ?? 1) || 0)));
  const availableRaw = body.available === "" || body.available == null ? copies : Number(body.available);
  const available = Math.max(0, Math.min(copies, Number.isFinite(availableRaw) ? Math.round(availableRaw) : copies));
  const category = BOOK_CATEGORIES.includes(str(body.category, 80)) ? str(body.category, 80) : "Other";
  const format = BOOK_FORMATS.includes(str(body.format, 40)) ? str(body.format, 40) : "Book";
  const status = BOOK_STATUSES.includes(str(body.status, 40)) ? str(body.status, 40) : (available > 0 ? "Available" : "Borrowed");
  const year = Number(body.year);
  return {
    title: str(body.title, 300),
    author: str(body.author, 240),
    isbn: str(body.isbn, 80),
    category,
    publisher: str(body.publisher, 240),
    year: Number.isInteger(year) && year >= 0 && year <= 9999 ? year : null,
    format,
    location: str(body.location || "Main library", 160) || "Main library",
    copies,
    available,
    status,
    shelf: str(body.shelf, 120),
    notes: str(body.notes, 2000),
  };
}

function buildBookFilter(query = {}) {
  const q = str(query.q, 180);
  const category = str(query.category, 80) || "all";
  const status = str(query.status, 40) || "all";
  const filter = { isDeleted: { $ne: true } };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = ["title", "author", "isbn", "category", "shelf", "publisher", "bookId"].map((field) => ({ [field]: rx }));
  }
  if (category !== "all" && BOOK_CATEGORIES.includes(category)) filter.category = category;
  if (status !== "all" && BOOK_STATUSES.includes(status)) filter.status = status;
  return { filter, q, category, status };
}

function normalizeLoan(row) {
  const status = row.status === "overdue" ? "Overdue" : row.status === "returned" ? "Returned" : "Borrowed";
  return {
    ...row,
    loanId: row.loanNo || row._id,
    bookMongoId: String(row.book || ""),
    borrowedAt: row.issuedAt,
    dueDate: row.dueAt,
    status,
  };
}

function normalizeReservation(row) {
  return { ...row, reservationId: row.reservationNo || row._id, bookMongoId: String(row.book || "") };
}
function normalizeFine(row) {
  return { ...row, fineId: row.fineNo || row._id, bookMongoId: String(row.book || ""), createdAt: row.createdAtRecord || row.createdAt };
}
function normalizeHold(row) {
  return { ...row, holdId: row.holdNo || row._id, bookMongoId: String(row.book || "") };
}

async function markOverdue(models, now = new Date()) {
  if (!models.LibraryLoan) return;
  await models.LibraryLoan.updateMany(
    { status: "issued", dueAt: { $lt: now }, isDeleted: { $ne: true } },
    { $set: { status: "overdue" } }
  ).catch(() => null);
}

exports.index = async (req, res) => {
  try {
    const { LibraryBook, LibraryLoan, LibraryReservation, LibraryFine, LibraryHold } = req.models || {};
    if (!LibraryBook || !LibraryLoan || !LibraryReservation || !LibraryFine || !LibraryHold) throw new Error("Library models are unavailable.");
    await markOverdue(req.models);
    const { filter, q, category, status } = buildBookFilter(req.query);
    const view = ["catalog", "borrow", "reservations", "fines", "holds"].includes(str(req.query.view, 30)) ? str(req.query.view, 30) : "catalog";

    const [books, allBooks, loanRows, reservationRows, fineRows, holdRows, policy] = await Promise.all([
      LibraryBook.find(filter).sort({ createdAt: -1 }).lean(),
      LibraryBook.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean(),
      LibraryLoan.find({ isDeleted: { $ne: true } }).sort({ issuedAt: -1 }).limit(1000).lean(),
      LibraryReservation.find({ isDeleted: { $ne: true } }).sort({ requestedAt: -1 }).limit(1000).lean(),
      LibraryFine.find({ isDeleted: { $ne: true } }).sort({ createdAtRecord: -1 }).limit(1000).lean(),
      LibraryHold.find({ isDeleted: { $ne: true } }).sort({ since: -1 }).limit(1000).lean(),
      readPolicy(req.models.Setting),
    ]);

    const borrows = loanRows.map(normalizeLoan);
    const reservations = reservationRows.map(normalizeReservation);
    const fines = fineRows.map(normalizeFine);
    const holds = holdRows.map(normalizeHold);
    const categories = [...new Set([...BOOK_CATEGORIES, ...allBooks.map((b) => b.category).filter(Boolean)])].sort();
    const kpis = {
      titles: allBooks.length,
      copies: allBooks.reduce((sum, b) => sum + Number(b.copies || 0), 0),
      borrowed: loanRows.filter((x) => ["issued", "overdue"].includes(x.status)).length,
      overdue: loanRows.filter((x) => x.status === "overdue").length,
      fineOutstanding: fineRows.filter((x) => x.status === "Pending").reduce((sum, x) => sum + Number(x.amount || 0), 0),
      finePaid: fineRows.filter((x) => x.status === "Paid").reduce((sum, x) => sum + Number(x.amount || 0), 0),
      activeHolds: holdRows.filter((x) => x.status === "Active Hold").length,
      fineRate: policy.fineRate,
      loanDays: policy.loanDays,
      maxRenewals: policy.maxRenewals,
    };

    return res.render("tenant/library/index", {
      title: "Library", tenant: req.tenant || null, csrfToken: req.csrfToken ? req.csrfToken() : "",
      query: { q, category, status, view }, books, categories, borrows, reservations, fines, holds, kpis,
      helpers: { formatDate },
    });
  } catch (error) {
    console.error("libraryController.index error:", error);
    req.flash?.("error", "Failed to load library page.");
    return res.redirect("/admin/dashboard");
  }
};

exports.createBook = async (req, res) => {
  try {
    const { LibraryBook } = req.models;
    const payload = normalizeBookPayload(req.body);
    if (!payload.title || !payload.author || !payload.isbn) throw new Error("Title, author, and ISBN are required.");
    if (await LibraryBook.exists({ isbn: payload.isbn, isDeleted: { $ne: true } })) throw new Error("A book with that ISBN already exists.");
    payload.bookId = await uniqueCode(LibraryBook, "bookId", "BK");
    payload.createdBy = actorUserId(req);
    payload.updatedBy = actorUserId(req);
    payload.movements = [{ type: "Created", actorName: actorName(req), note: "Book created", date: new Date() }];
    await LibraryBook.create(payload);
    req.flash?.("success", "Book created successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to create book."); }
  return res.redirect("/admin/library");
};

exports.updateBook = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) throw new Error("Invalid book.");
    const { LibraryBook, LibraryLoan } = req.models;
    const book = await LibraryBook.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!book) throw new Error("Book not found.");
    const payload = normalizeBookPayload(req.body);
    if (req.body.format == null || req.body.format === "") payload.format = book.format || "Book";
    if (req.body.location == null || req.body.location === "") payload.location = book.location || "Main library";
    if (!payload.title || !payload.author || !payload.isbn) throw new Error("Title, author, and ISBN are required.");
    if (await LibraryBook.exists({ _id: { $ne: book._id }, isbn: payload.isbn, isDeleted: { $ne: true } })) throw new Error("Another book already uses that ISBN.");
    const activeLoans = await LibraryLoan.countDocuments({ book: book._id, status: { $in: ["issued", "overdue"] }, isDeleted: { $ne: true } });
    if (payload.copies < activeLoans) throw new Error(`Copies cannot be below ${activeLoans} active loan(s).`);
    payload.available = Math.min(payload.available, Math.max(0, payload.copies - activeLoans));
    if (payload.status === "Damaged" && activeLoans) throw new Error("Return active loans before marking the title damaged.");
    Object.assign(book, payload, { updatedBy: actorUserId(req) });
    book.movements.unshift({ type: "Updated", actorName: actorName(req), note: "Book updated", date: new Date() });
    await book.save();
    req.flash?.("success", "Book updated successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to update book."); }
  return res.redirect("/admin/library");
};

exports.addCopy = async (req, res) => {
  try {
    const book = await req.models.LibraryBook.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $inc: { copies: 1, available: 1 }, $set: { updatedBy: actorUserId(req) }, $push: { movements: { $each: [{ type: "Copy Added", actorName: actorName(req), note: "Added one copy", date: new Date() }], $position: 0 } } },
      { new: true }
    );
    if (!book) throw new Error("Book not found.");
    if (book.status !== "Damaged") { book.status = "Available"; await book.save(); }
    req.flash?.("success", "Copy added successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to add copy."); }
  return res.redirect("/admin/library");
};

exports.markDamaged = async (req, res) => {
  try {
    const { LibraryBook, LibraryLoan } = req.models;
    const active = await LibraryLoan.exists({ book: req.params.id, status: { $in: ["issued", "overdue"] }, isDeleted: { $ne: true } });
    if (active) throw new Error("Return active loans before marking this title damaged.");
    const book = await LibraryBook.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Damaged", available: 0, updatedBy: actorUserId(req) }, $push: { movements: { $each: [{ type: "Status Changed", actorName: actorName(req), note: "Marked damaged", date: new Date() }], $position: 0 } } },
      { new: true }
    );
    if (!book) throw new Error("Book not found.");
    req.flash?.("success", "Book marked as damaged.");
  } catch (error) { req.flash?.("error", error.message || "Failed to mark book as damaged."); }
  return res.redirect("/admin/library");
};

exports.borrowBook = async (req, res) => {
  try {
    const result = await createLoan(req.models, { ...req.body, actorUserId: actorUserId(req) });
    await notifyStudent(req.models, result.student, { title: "Library book issued", message: `${result.book.title} is due ${formatDate(result.loan.dueAt)}.`, entityType: "LibraryLoan", entityId: result.loan._id, createdBy: actorUserId(req) });
    req.flash?.("success", "Borrow recorded successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to record borrow."); }
  return res.redirect("/admin/library?view=borrow");
};

exports.returnBook = async (req, res) => {
  try {
    const result = await returnLoan(req.models, { loanId: req.params.borrowId, actorUserId: actorUserId(req) });
    const student = await req.models.Student.findById(result.loan.student || result.loan.studentId || result.loan.borrowerId).catch(() => null);
    if (student) await notifyStudent(req.models, student, { title: "Library return recorded", message: result.fine ? `Return recorded. An overdue fine of UGX ${Number(result.fine.amount || 0).toLocaleString()} was added.` : "Your library return was recorded.", entityType: "LibraryLoan", entityId: result.loan._id, createdBy: actorUserId(req) });
    req.flash?.("success", result.fine ? "Return recorded and overdue fine created." : "Return recorded successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to record return."); }
  return res.redirect("/admin/library?view=borrow");
};

exports.createReservation = async (req, res) => {
  try {
    const result = await createReservation(req.models, { ...req.body, bookId: req.params.id, actorUserId: actorUserId(req) });
    await notifyStudent(req.models, result.student, { title: "Library reservation submitted", message: `Reservation requested for ${result.book.title}.`, entityType: "LibraryReservation", entityId: result.reservation._id, createdBy: actorUserId(req) });
    req.flash?.("success", "Reservation created successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to create reservation."); }
  return res.redirect("/admin/library?view=reservations");
};

exports.changeReservationStatus = async (req, res) => {
  try {
    const reservation = await req.models.LibraryReservation.findOne({ _id: req.params.reservationId, isDeleted: { $ne: true } });
    if (!reservation) throw new Error("Reservation not found.");
    await setReservationStatus(req.models, reservation, req.body.status, actorUserId(req));
    const student = await req.models.Student.findById(reservation.student).catch(() => null);
    if (student) await notifyStudent(req.models, student, { title: "Library reservation updated", message: `${reservation.bookTitle || "Your reservation"} is now ${reservation.status}.`, entityType: "LibraryReservation", entityId: reservation._id, createdBy: actorUserId(req) });
    req.flash?.("success", "Reservation updated successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to update reservation."); }
  return res.redirect("/admin/library?view=reservations");
};

exports.createFine = async (req, res) => {
  try {
    const result = await createFine(req.models, { ...req.body, bookId: req.params.id || req.body.bookId, actorUserId: actorUserId(req) });
    await notifyStudent(req.models, result.student, { title: "Library fine added", message: `${result.fine.reason}: UGX ${Number(result.fine.amount || 0).toLocaleString()}.`, type: "warning", entityType: "LibraryFine", entityId: result.fine._id, createdBy: actorUserId(req) });
    req.flash?.("success", "Fine created successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to create fine."); }
  return res.redirect("/admin/library?view=fines");
};

exports.changeFineStatus = async (req, res) => {
  try {
    const fine = await req.models.LibraryFine.findOne({ _id: req.params.fineId, isDeleted: { $ne: true } });
    if (!fine) throw new Error("Fine not found.");
    await setFineStatus(fine, req.body.status, actorUserId(req));
    const student = await req.models.Student.findById(fine.student).catch(() => null);
    if (student) await notifyStudent(req.models, student, { title: "Library fine updated", message: `${fine.fineNo} is now ${fine.status}.`, entityType: "LibraryFine", entityId: fine._id, createdBy: actorUserId(req) });
    req.flash?.("success", "Fine updated successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to update fine."); }
  return res.redirect("/admin/library?view=fines");
};

exports.createHold = async (req, res) => {
  try {
    const book = req.params.id && isValidId(req.params.id) ? await req.models.LibraryBook.findById(req.params.id).lean().catch(() => null) : null;
    const result = await createHold(req.models, { ...req.body, bookId: book?._id || null, bookTitle: book?.title || "", actorUserId: actorUserId(req) });
    await notifyStudent(req.models, result.student, { title: "Library hold applied", message: `${result.hold.type}: ${result.hold.reason}.`, type: "warning", entityType: "LibraryHold", entityId: result.hold._id, createdBy: actorUserId(req) });
    req.flash?.("success", "Hold created successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to create hold."); }
  return res.redirect("/admin/library?view=holds");
};

exports.updateHold = async (req, res) => {
  try {
    const hold = await req.models.LibraryHold.findOne({ _id: req.params.holdId, status: "Active Hold", isDeleted: { $ne: true } });
    if (!hold) throw new Error("Active hold not found.");
    const type = str(req.body.type, 40);
    const reason = str(req.body.reason, 1000);
    if (!reason) throw new Error("Hold reason is required.");
    if (!["Library Hold", "Clearance Hold", "Borrowing Hold"].includes(type)) throw new Error("Invalid hold type.");
    hold.type = type; hold.reason = reason; hold.note = str(req.body.note, 1500); hold.updatedBy = actorUserId(req);
    await hold.save();
    req.flash?.("success", "Hold updated successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to update hold."); }
  return res.redirect("/admin/library?view=holds");
};

exports.changeHoldStatus = async (req, res) => {
  try {
    const hold = await req.models.LibraryHold.findOne({ _id: req.params.holdId, isDeleted: { $ne: true } });
    if (!hold) throw new Error("Hold not found.");
    await setHoldStatus(hold, req.body.status, actorUserId(req));
    const student = await req.models.Student.findById(hold.student).catch(() => null);
    if (student) await notifyStudent(req.models, student, { title: "Library hold updated", message: `${hold.holdNo} is now ${hold.status}.`, entityType: "LibraryHold", entityId: hold._id, createdBy: actorUserId(req) });
    req.flash?.("success", "Hold updated successfully.");
  } catch (error) { req.flash?.("error", error.message || "Failed to update hold."); }
  return res.redirect("/admin/library?view=holds");
};

exports.bulkAction = async (req, res) => {
  try {
    const ids = str(req.body.ids, 5000).split(",").map((x) => x.trim()).filter(isValidId);
    if (!ids.length) throw new Error("Select at least one book.");
    const action = str(req.body.action, 30);
    const category = str(req.body.category, 80);
    const status = str(req.body.status, 40);
    const note = str(req.body.note, 1000);
    let changed = 0;
    for (const id of ids) {
      const book = await req.models.LibraryBook.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!book) continue;
      const activeLoans = await req.models.LibraryLoan.countDocuments({ book: id, status: { $in: ["issued", "overdue"] }, isDeleted: { $ne: true } });
      if (action === "archive") {
        if (activeLoans) continue;
        book.isDeleted = true; book.deletedAt = new Date(); book.archivedAt = new Date();
      } else if (action === "damaged") {
        if (activeLoans) continue;
        book.status = "Damaged"; book.available = 0;
      } else if (action === "update") {
        if (category && BOOK_CATEGORIES.includes(category)) book.category = category;
        if (status && BOOK_STATUSES.includes(status)) {
          if (status === "Damaged" && activeLoans) continue;
          if (status === "Available" && Number(book.available || 0) < 1) continue;
          if (status === "Borrowed" && Number(book.available || 0) > 0) continue;
          book.status = status;
        }
      } else throw new Error("Invalid bulk action.");
      book.updatedBy = actorUserId(req);
      book.movements.unshift({ type: "Status Changed", actorName: actorName(req), note: note || `Bulk ${action}`, date: new Date() });
      await book.save(); changed += 1;
    }
    req.flash?.("success", `${changed} book${changed === 1 ? "" : "s"} updated.`);
  } catch (error) { req.flash?.("error", error.message || "Bulk update failed."); }
  return res.redirect("/admin/library");
};

exports.importCsv = async (req, res) => {
  try {
    const rows = parseCsv(req.body.csvText);
    if (!rows.length) throw new Error("The CSV has no data rows.");
    let created = 0, skipped = 0;
    for (const row of rows.slice(0, 2000)) {
      const payload = normalizeBookPayload({
        title: row.title, author: row.author, isbn: row.isbn, category: row.category,
        publisher: row.publisher, year: row.year, format: row.format, location: row.location,
        copies: row.copies || 1, available: row.available, status: row.status, shelf: row.shelf, notes: row.notes,
      });
      if (!payload.title || !payload.author || !payload.isbn || await req.models.LibraryBook.exists({ isbn: payload.isbn, isDeleted: { $ne: true } })) { skipped += 1; continue; }
      payload.bookId = await uniqueCode(req.models.LibraryBook, "bookId", "BK");
      payload.createdBy = actorUserId(req); payload.updatedBy = actorUserId(req);
      await req.models.LibraryBook.create(payload); created += 1;
    }
    req.flash?.("success", `Library import complete: ${created} created, ${skipped} skipped.`);
  } catch (error) { req.flash?.("error", error.message || "Library import failed."); }
  return res.redirect("/admin/library");
};

exports.exportCsv = async (req, res) => {
  const { filter } = buildBookFilter(req.query);
  const rows = await req.models.LibraryBook.find(filter).sort({ title: 1 }).lean();
  const headers = ["Book ID", "Title", "Author", "ISBN", "Category", "Format", "Location", "Publisher", "Year", "Copies", "Available", "Status", "Shelf"];
  const lines = [headers.map(csvCell).join(",")];
  for (const b of rows) lines.push([b.bookId, b.title, b.author, b.isbn, b.category, b.format, b.location, b.publisher, b.year, b.copies, b.available, b.status, b.shelf].map(csvCell).join(","));
  res.type("text/csv"); res.setHeader("Content-Disposition", `attachment; filename="library-catalog-${new Date().toISOString().slice(0, 10)}.csv"`); return res.send(lines.join("\n"));
};

exports.reportCsv = async (req, res) => {
  await markOverdue(req.models);
  const [books, loans, reservations, fines, holds, policy] = await Promise.all([
    req.models.LibraryBook.find({ isDeleted: { $ne: true } }).lean(), req.models.LibraryLoan.find({ isDeleted: { $ne: true } }).lean(),
    req.models.LibraryReservation.find({ isDeleted: { $ne: true } }).lean(), req.models.LibraryFine.find({ isDeleted: { $ne: true } }).lean(),
    req.models.LibraryHold.find({ isDeleted: { $ne: true } }).lean(), readPolicy(req.models.Setting),
  ]);
  const data = [
    ["Metric", "Value"], ["Book titles", books.length], ["Copies", books.reduce((s,b)=>s+Number(b.copies||0),0)],
    ["Available copies", books.reduce((s,b)=>s+Number(b.available||0),0)], ["Active loans", loans.filter(x=>["issued","overdue"].includes(x.status)).length],
    ["Overdue loans", loans.filter(x=>x.status==="overdue").length], ["Pending reservations", reservations.filter(x=>x.status==="Pending").length],
    ["Approved reservations", reservations.filter(x=>x.status==="Approved").length], ["Outstanding fines (UGX)", fines.filter(x=>x.status==="Pending").reduce((s,x)=>s+Number(x.amount||0),0)],
    ["Active holds", holds.filter(x=>x.status==="Active Hold").length], ["Fine rate/day (UGX)", policy.fineRate], ["Loan days", policy.loanDays], ["Max renewals", policy.maxRenewals],
  ];
  res.type("text/csv"); res.setHeader("Content-Disposition", `attachment; filename="library-report-${new Date().toISOString().slice(0,10)}.csv"`); return res.send(data.map(r=>r.map(csvCell).join(",")).join("\n"));
};

exports.saveSettings = async (req, res) => {
  try {
    const policy = normalizePolicy(req.body);
    await req.models.Setting.findOneAndUpdate(
      { key: "library_policy" },
      { $set: { key: "library_policy", value: policy, updatedBy: actorUserId(req), isDeleted: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    req.flash?.("success", "Library fine and loan policy updated.");
  } catch (error) { req.flash?.("error", error.message || "Failed to update library policy."); }
  return res.redirect("/admin/library?view=fines");
};

exports._test = { normalizeBookPayload, buildBookFilter, normalizeLoan, markOverdue };

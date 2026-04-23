const LibraryBookModel = require("../../../models/tenant/LibraryBook");

function actorUserId(req) {
  return req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
}

function actorName(req) {
  return req.user?.name || req.session?.tenantUser?.name || "System";
}

function safe(v) {
  return v == null ? "" : String(v).trim();
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function getLibraryBook(req) {
  const conn = req.tenantDb || req.db || req.tenantConnection;
  if (!conn) throw new Error("Tenant DB connection not found on request");
  return LibraryBookModel(conn);
}

function generateCode(prefix) {
  return `${prefix}${Math.floor(100000 + Math.random() * 900000)}`;
}

function bookPayload(body) {
  const copies = Math.max(0, num(body.copies, 1));
  const availableRaw = body.available === undefined || body.available === null || body.available === ""
    ? copies
    : num(body.available, copies);

  return {
    title: safe(body.title),
    author: safe(body.author),
    isbn: safe(body.isbn),
    category: safe(body.category) || "Other",
    publisher: safe(body.publisher),
    year: body.year ? num(body.year, null) : null,
    copies,
    available: Math.max(0, Math.min(availableRaw, copies)),
    status: safe(body.status) || "Available",
    shelf: safe(body.shelf),
    notes: safe(body.notes),
  };
}

exports.index = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);

    const q = safe(req.query.q);
    const category = safe(req.query.category) || "all";
    const status = safe(req.query.status) || "all";
    const view = safe(req.query.view) || "catalog";

    const filter = {};

    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { author: { $regex: q, $options: "i" } },
        { isbn: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } },
        { shelf: { $regex: q, $options: "i" } },
        { publisher: { $regex: q, $options: "i" } },
      ];
    }

    if (category !== "all") filter.category = category;
    if (status !== "all") filter.status = status;

    const books = await LibraryBook.find(filter).sort({ createdAt: -1 }).lean();
    const allBooks = await LibraryBook.find({}).sort({ createdAt: -1 }).lean();

    const categories = [...new Set(allBooks.map((b) => b.category).filter(Boolean))].sort();

    const borrows = allBooks.flatMap((book) =>
      (book.borrows || []).map((b) => ({
        ...b,
        bookMongoId: String(book._id),
        bookTitle: book.title,
        isbn: book.isbn,
      }))
    ).sort((a, b) => new Date(b.borrowedAt || 0) - new Date(a.borrowedAt || 0));

    const reservations = allBooks.flatMap((book) =>
      (book.reservations || []).map((r) => ({
        ...r,
        bookMongoId: String(book._id),
        bookTitle: book.title,
        isbn: book.isbn,
      }))
    ).sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));

    const fines = allBooks.flatMap((book) =>
      (book.fines || []).map((f) => ({
        ...f,
        bookMongoId: String(book._id),
        bookTitle: book.title,
        isbn: book.isbn,
      }))
    ).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const holds = allBooks.flatMap((book) =>
      (book.holds || []).map((h) => ({
        ...h,
        bookMongoId: String(book._id),
        bookTitle: book.title,
        isbn: book.isbn,
      }))
    ).sort((a, b) => new Date(b.since || 0) - new Date(a.since || 0));

    const kpis = {
      titles: allBooks.length,
      copies: allBooks.reduce((sum, b) => sum + (b.copies || 0), 0),
      borrowed: borrows.filter((b) => b.status === "Borrowed" || b.status === "Overdue").length,
      overdue: borrows.filter((b) => b.status === "Overdue").length,
      fineOutstanding: fines
        .filter((f) => f.status === "Pending")
        .reduce((sum, f) => sum + (f.amount || 0), 0),
      finePaid: fines
        .filter((f) => f.status === "Paid")
        .reduce((sum, f) => sum + (f.amount || 0), 0),
      activeHolds: holds.filter((h) => h.status === "Active Hold").length,
      fineRate: 1000,
    };

    return res.render("tenant/library/index", {
      title: "Library",
      tenant: req.tenant || null,
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      query: { q, category, status, view },
      books,
      categories,
      borrows,
      reservations,
      fines,
      holds,
      kpis,
      helpers: { formatDate },
    });
  } catch (error) {
    console.error("libraryController.index error:", error);
    req.flash?.("error", "Failed to load library page.");
    return res.redirect("/tenant/dashboard");
  }
};

exports.createBook = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const payload = bookPayload(req.body);

    if (!payload.title || !payload.author || !payload.isbn) {
      req.flash?.("error", "Title, author, and ISBN are required.");
      return res.redirect("/admin/library");
    }

    const exists = await LibraryBook.findOne({ isbn: payload.isbn }).lean();
    if (exists) {
      req.flash?.("error", "A book with that ISBN already exists.");
      return res.redirect("/admin/library");
    }

    await LibraryBook.create({
      bookId: generateCode("BK"),
      ...payload,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
      movements: [
        {
          type: "Created",
          actorName: actorName(req),
          note: "Book created",
          date: new Date(),
        },
      ],
    });

    req.flash?.("success", "Book created successfully.");
    return res.redirect("/admin/library");
  } catch (error) {
    console.error("libraryController.createBook error:", error);
    req.flash?.("error", "Failed to create book.");
    return res.redirect("/admin/library");
  }
};

exports.updateBook = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const { id } = req.params;
    const payload = bookPayload(req.body);

    if (!payload.title || !payload.author || !payload.isbn) {
      req.flash?.("error", "Title, author, and ISBN are required.");
      return res.redirect("/admin/library");
    }

    const book = await LibraryBook.findById(id);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library");
    }

    const duplicate = await LibraryBook.findOne({
      _id: { $ne: id },
      isbn: payload.isbn,
    }).lean();

    if (duplicate) {
      req.flash?.("error", "Another book already uses that ISBN.");
      return res.redirect("/admin/library");
    }

    book.title = payload.title;
    book.author = payload.author;
    book.isbn = payload.isbn;
    book.category = payload.category;
    book.publisher = payload.publisher;
    book.year = payload.year;
    book.copies = payload.copies;
    book.available = Math.max(0, Math.min(payload.available, payload.copies));
    book.status = payload.status;
    book.shelf = payload.shelf;
    book.notes = payload.notes;
    book.updatedBy = actorUserId(req);

    book.movements.unshift({
      type: "Updated",
      actorName: actorName(req),
      note: "Book updated",
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Book updated successfully.");
    return res.redirect("/admin/library");
  } catch (error) {
    console.error("libraryController.updateBook error:", error);
    req.flash?.("error", "Failed to update book.");
    return res.redirect("/admin/library");
  }
};

exports.addCopy = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const { id } = req.params;

    const book = await LibraryBook.findById(id);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library");
    }

    book.copies += 1;
    book.available += 1;

    if (book.available > 0 && (book.status === "Borrowed" || book.status === "Reserved")) {
      book.status = "Available";
    }

    book.updatedBy = actorUserId(req);

    book.movements.unshift({
      type: "Copy Added",
      actorName: actorName(req),
      note: "Added one copy",
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Copy added successfully.");
    return res.redirect("/admin/library");
  } catch (error) {
    console.error("libraryController.addCopy error:", error);
    req.flash?.("error", "Failed to add copy.");
    return res.redirect("/admin/library");
  }
};

exports.markDamaged = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const { id } = req.params;

    const book = await LibraryBook.findById(id);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library");
    }

    book.status = "Damaged";
    book.updatedBy = actorUserId(req);

    book.movements.unshift({
      type: "Status Changed",
      actorName: actorName(req),
      note: "Marked damaged",
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Book marked as damaged.");
    return res.redirect("/admin/library");
  } catch (error) {
    console.error("libraryController.markDamaged error:", error);
    req.flash?.("error", "Failed to mark book as damaged.");
    return res.redirect("/admin/library");
  }
};

exports.borrowBook = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);

    const studentName = safe(req.body.studentName);
    const regNo = safe(req.body.regNo);
    const bookId = safe(req.body.bookId);
    const copyId = safe(req.body.copyId);
    const note = safe(req.body.note);
    const dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;

    if (!studentName || !bookId) {
      req.flash?.("error", "Student and book are required.");
      return res.redirect("/admin/library?view=borrow");
    }

    const book = await LibraryBook.findById(bookId);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library?view=borrow");
    }

    if (book.available <= 0) {
      req.flash?.("error", "No available copy for this book.");
      return res.redirect("/admin/library?view=borrow");
    }

    book.available -= 1;
    book.status = book.available > 0 ? "Available" : "Borrowed";
    book.updatedBy = actorUserId(req);

    book.borrows.unshift({
      loanId: generateCode("LN"),
      studentName,
      regNo,
      bookTitle: book.title,
      copyId,
      borrowedAt: new Date(),
      dueDate,
      status: "Borrowed",
      note,
    });

    book.movements.unshift({
      type: "Borrowed",
      actorName: actorName(req),
      note: `Borrowed by ${studentName}`,
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Borrow recorded successfully.");
    return res.redirect("/admin/library?view=borrow");
  } catch (error) {
    console.error("libraryController.borrowBook error:", error);
    req.flash?.("error", "Failed to record borrow.");
    return res.redirect("/admin/library?view=borrow");
  }
};

exports.returnBook = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const { bookId, borrowId } = req.params;

    const book = await LibraryBook.findById(bookId);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library?view=borrow");
    }

    const borrow = book.borrows.id(borrowId);
    if (!borrow) {
      req.flash?.("error", "Borrow record not found.");
      return res.redirect("/admin/library?view=borrow");
    }

    if (borrow.status === "Returned") {
      req.flash?.("error", "This borrow record is already returned.");
      return res.redirect("/admin/library?view=borrow");
    }

    borrow.status = "Returned";
    borrow.returnedAt = new Date();

    book.available += 1;
    if (book.status === "Borrowed" && book.available > 0) {
      book.status = "Available";
    }

    book.updatedBy = actorUserId(req);
    book.movements.unshift({
      type: "Returned",
      actorName: actorName(req),
      note: `Returned by ${borrow.studentName}`,
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Return recorded successfully.");
    return res.redirect("/admin/library?view=borrow");
  } catch (error) {
    console.error("libraryController.returnBook error:", error);
    req.flash?.("error", "Failed to record return.");
    return res.redirect("/admin/library?view=borrow");
  }
};

exports.createReservation = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const { id } = req.params;

    const studentName = safe(req.body.studentName);
    const regNo = safe(req.body.regNo);
    const priority = safe(req.body.priority) || "Normal";
    const note = safe(req.body.note);

    if (!studentName) {
      req.flash?.("error", "Student name is required.");
      return res.redirect("/admin/library?view=reservations");
    }

    const book = await LibraryBook.findById(id);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library?view=reservations");
    }

    book.reservations.unshift({
      reservationId: generateCode("RS"),
      studentName,
      regNo,
      requestedAt: new Date(),
      priority,
      status: "Pending",
      note,
    });

    if (book.status === "Available") {
      book.status = "Reserved";
    }

    book.updatedBy = actorUserId(req);
    book.movements.unshift({
      type: "Reserved",
      actorName: actorName(req),
      note: `Reserved by ${studentName}`,
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Reservation created successfully.");
    return res.redirect("/admin/library?view=reservations");
  } catch (error) {
    console.error("libraryController.createReservation error:", error);
    req.flash?.("error", "Failed to create reservation.");
    return res.redirect("/admin/library?view=reservations");
  }
};

exports.changeReservationStatus = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const { bookId, reservationId } = req.params;
    const status = safe(req.body.status);

    const allowed = ["Pending", "Approved", "Denied", "Fulfilled"];
    if (!allowed.includes(status)) {
      req.flash?.("error", "Invalid reservation status.");
      return res.redirect("/admin/library?view=reservations");
    }

    const book = await LibraryBook.findById(bookId);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library?view=reservations");
    }

    const reservation = book.reservations.id(reservationId);
    if (!reservation) {
      req.flash?.("error", "Reservation not found.");
      return res.redirect("/admin/library?view=reservations");
    }

    reservation.status = status;
    reservation.note = safe(req.body.note) || reservation.note;
    book.updatedBy = actorUserId(req);

    book.movements.unshift({
      type: "Status Changed",
      actorName: actorName(req),
      note: `Reservation changed to ${status}`,
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Reservation updated successfully.");
    return res.redirect("/admin/library?view=reservations");
  } catch (error) {
    console.error("libraryController.changeReservationStatus error:", error);
    req.flash?.("error", "Failed to update reservation.");
    return res.redirect("/admin/library?view=reservations");
  }
};

exports.createFine = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const { id } = req.params;

    const studentName = safe(req.body.studentName);
    const regNo = safe(req.body.regNo);
    const reason = safe(req.body.reason);
    const amount = Math.max(0, num(req.body.amount, 0));
    const status = safe(req.body.status) || "Pending";
    const note = safe(req.body.note);

    if (!studentName || !reason) {
      req.flash?.("error", "Student and reason are required.");
      return res.redirect("/admin/library?view=fines");
    }

    const book = await LibraryBook.findById(id);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library?view=fines");
    }

    book.fines.unshift({
      fineId: generateCode("FN"),
      studentName,
      regNo,
      reason,
      amount,
      status,
      createdAt: new Date(),
      paidAt: status === "Paid" ? new Date() : null,
      note,
    });

    book.updatedBy = actorUserId(req);
    book.movements.unshift({
      type: "Fine Added",
      actorName: actorName(req),
      note: `${reason} - ${amount}`,
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Fine created successfully.");
    return res.redirect("/admin/library?view=fines");
  } catch (error) {
    console.error("libraryController.createFine error:", error);
    req.flash?.("error", "Failed to create fine.");
    return res.redirect("/admin/library?view=fines");
  }
};

exports.changeFineStatus = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const { bookId, fineId } = req.params;
    const status = safe(req.body.status);

    const allowed = ["Pending", "Paid", "Waived"];
    if (!allowed.includes(status)) {
      req.flash?.("error", "Invalid fine status.");
      return res.redirect("/admin/library?view=fines");
    }

    const book = await LibraryBook.findById(bookId);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library?view=fines");
    }

    const fine = book.fines.id(fineId);
    if (!fine) {
      req.flash?.("error", "Fine not found.");
      return res.redirect("/admin/library?view=fines");
    }

    fine.status = status;
    fine.paidAt = status === "Paid" ? new Date() : fine.paidAt;
    fine.note = safe(req.body.note) || fine.note;
    book.updatedBy = actorUserId(req);

    book.movements.unshift({
      type: "Status Changed",
      actorName: actorName(req),
      note: `Fine changed to ${status}`,
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Fine updated successfully.");
    return res.redirect("/admin/library?view=fines");
  } catch (error) {
    console.error("libraryController.changeFineStatus error:", error);
    req.flash?.("error", "Failed to update fine.");
    return res.redirect("/admin/library?view=fines");
  }
};

exports.createHold = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const { id } = req.params;

    const studentName = safe(req.body.studentName);
    const regNo = safe(req.body.regNo);
    const type = safe(req.body.type) || "Library Hold";
    const reason = safe(req.body.reason);
    const status = safe(req.body.status) || "Active Hold";
    const note = safe(req.body.note);

    if (!studentName || !reason) {
      req.flash?.("error", "Student and reason are required.");
      return res.redirect("/admin/library?view=holds");
    }

    const book = await LibraryBook.findById(id);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library?view=holds");
    }

    book.holds.unshift({
      holdId: generateCode("HD"),
      studentName,
      regNo,
      type,
      reason,
      since: new Date(),
      status,
      note,
    });

    book.updatedBy = actorUserId(req);
    book.movements.unshift({
      type: "Hold Added",
      actorName: actorName(req),
      note: `${type}: ${reason}`,
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Hold created successfully.");
    return res.redirect("/admin/library?view=holds");
  } catch (error) {
    console.error("libraryController.createHold error:", error);
    req.flash?.("error", "Failed to create hold.");
    return res.redirect("/admin/library?view=holds");
  }
};

exports.changeHoldStatus = async (req, res) => {
  try {
    const LibraryBook = getLibraryBook(req);
    const { bookId, holdId } = req.params;
    const status = safe(req.body.status);

    const allowed = ["Active Hold", "Released"];
    if (!allowed.includes(status)) {
      req.flash?.("error", "Invalid hold status.");
      return res.redirect("/admin/library?view=holds");
    }

    const book = await LibraryBook.findById(bookId);
    if (!book) {
      req.flash?.("error", "Book not found.");
      return res.redirect("/admin/library?view=holds");
    }

    const hold = book.holds.id(holdId);
    if (!hold) {
      req.flash?.("error", "Hold not found.");
      return res.redirect("/admin/library?view=holds");
    }

    hold.status = status;
    hold.note = safe(req.body.note) || hold.note;
    book.updatedBy = actorUserId(req);

    book.movements.unshift({
      type: "Status Changed",
      actorName: actorName(req),
      note: `Hold changed to ${status}`,
      date: new Date(),
    });

    await book.save();

    req.flash?.("success", "Hold updated successfully.");
    return res.redirect("/admin/library?view=holds");
  } catch (error) {
    console.error("libraryController.changeHoldStatus error:", error);
    req.flash?.("error", "Failed to update hold.");
    return res.redirect("/admin/library?view=holds");
  }
};
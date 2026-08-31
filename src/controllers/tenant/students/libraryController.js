const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  num,
} = require("./_helpers");
const {
  escapeRegex,
  str,
  readPolicy,
  createReservation,
  renewLoan,
  notifyStudent,
  actorUserId,
} = require("../../../services/tenant/libraryService");

async function context(req, res) {
  if (!req.models) throw new Error("Tenant models not loaded");
  const got = await getStudent(req);
  const user = got?.user || null;
  const student = got?.student || null;
  if (!user) { res.redirect("/login"); return null; }
  const blocked = mustHaveStudent(res, {
    tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "Library",
  }, "students/library");
  if (blocked) return null;
  return { user, student };
}

async function markOverdue(LibraryLoan) {
  if (!LibraryLoan) return;
  await LibraryLoan.updateMany(
    { status: "issued", dueAt: { $lt: new Date() }, isDeleted: { $ne: true } },
    { $set: { status: "overdue" } }
  ).catch(() => null);
}

exports.library = async (req, res) => {
  try {
    const ctx = await context(req, res);
    if (!ctx) return;
    const { user, student } = ctx;
    const { LibraryLoan, LibraryBook, LibraryReservation, LibraryFine, LibraryHold } = req.models;
    await markOverdue(LibraryLoan);

    const q = str(req.query.q, 180);
    const type = str(req.query.type, 40) || "all";
    const location = str(req.query.location, 160) || "all";
    const filter = { isDeleted: { $ne: true }, status: { $ne: "Damaged" } };
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ title: rx }, { author: rx }, { isbn: rx }, { category: rx }, { publisher: rx }, { shelf: rx }, { bookId: rx }];
    }
    const typeMap = { book: "Book", ebook: "E-book", journal: "Journal" };
    if (typeMap[type]) filter.format = typeMap[type];
    if (location !== "all") filter.location = new RegExp(`^${escapeRegex(location)}$`, "i");

    const [catalogueRows, loans, reservations, fines, holds, policy, locations] = await Promise.all([
      LibraryBook ? LibraryBook.find(filter).sort({ title: 1 }).limit(100).lean().catch(() => []) : [],
      LibraryLoan ? LibraryLoan.find({ borrowerType: "student", borrowerId: student._id, isDeleted: { $ne: true } }).sort({ issuedAt: -1 }).lean().catch(() => []) : [],
      LibraryReservation ? LibraryReservation.find({ student: student._id, isDeleted: { $ne: true } }).sort({ requestedAt: -1 }).lean().catch(() => []) : [],
      LibraryFine ? LibraryFine.find({ student: student._id, isDeleted: { $ne: true } }).sort({ createdAtRecord: -1 }).lean().catch(() => []) : [],
      LibraryHold ? LibraryHold.find({ student: student._id, status: "Active Hold", isDeleted: { $ne: true } }).sort({ since: -1 }).lean().catch(() => []) : [],
      readPolicy(req.models.Setting),
      LibraryBook ? LibraryBook.distinct("location", { isDeleted: { $ne: true }, status: { $ne: "Damaged" } }).catch(() => []) : [],
    ]);

    const activeReservedBookIds = new Set(reservations.filter((r) => ["Pending", "Approved"].includes(r.status)).map((r) => String(r.book)));
    const activeLoanBookIds = new Set(loans.filter((l) => ["issued", "overdue"].includes(l.status)).map((l) => String(l.book)));
    const catalogue = catalogueRows.map((b) => ({
      id: String(b._id), title: b.title || "Untitled", author: b.author || "Unknown", type: b.format || "Book",
      location: b.location || "Main library", callNo: b.bookId || b.isbn || "-", copies: num(b.copies || 0), available: num(b.available || 0),
      canReserve: !activeReservedBookIds.has(String(b._id)) && !activeLoanBookIds.has(String(b._id)),
    }));

    return renderView(req, res, "students/library", {
      pageTitle: "Library", csrfToken: req.csrfToken ? req.csrfToken() : "", user, student, studentName: getStudentDisplayName(student, user), meta: academicMeta(student),
      query: { q, type, location }, locations: [...new Set((locations || []).filter(Boolean))].sort(), catalogue,
      loans: loans.map((l) => ({ id: String(l._id), title: l.bookTitle || "Loan item", dueDate: l.dueAt || null, status: l.status === "overdue" ? "Overdue" : l.status === "returned" ? "Returned" : "On loan", renewalCount: num(l.renewalCount || 0), canRenew: ["issued", "overdue"].includes(l.status) && num(l.renewalCount || 0) < policy.maxRenewals })),
      reservations: reservations.map((r) => ({ id: String(r._id), title: r.bookTitle || "Reserved item", status: r.status || "Pending", createdAt: r.requestedAt || r.createdAt || null })),
      fines: { count: fines.filter((f) => f.status === "Pending").length, total: fines.filter((f) => f.status === "Pending").reduce((s, f) => s + num(f.amount), 0) },
      holds, policy,
    });
  } catch (err) {
    console.error("Student library error:", err);
    return res.status(500).send("Failed to load library.");
  }
};

exports.reserve = async (req, res) => {
  try {
    const ctx = await context(req, res);
    if (!ctx) return;
    const result = await createReservation(req.models, { student: ctx.student, bookId: req.params.bookId, priority: "Normal", note: "Student portal reservation", actorUserId: actorUserId(req) });
    await notifyStudent(req.models, ctx.student, { title: "Library reservation submitted", message: `${result.book.title} reservation submitted for review.`, entityType: "LibraryReservation", entityId: result.reservation._id, createdBy: actorUserId(req) });
    req.flash?.("success", "Reservation submitted.");
  } catch (err) { req.flash?.("error", err.message || "Could not reserve this item."); }
  return res.redirect("/student/library");
};

exports.renew = async (req, res) => {
  try {
    const ctx = await context(req, res);
    if (!ctx) return;
    const loan = await renewLoan(req.models, { student: ctx.student, loanId: req.params.loanId, actorUserId: actorUserId(req) });
    await notifyStudent(req.models, ctx.student, { title: "Library loan renewed", message: `${loan.bookTitle || "Your item"} is now due ${new Date(loan.dueAt).toDateString()}.`, entityType: "LibraryLoan", entityId: loan._id, createdBy: actorUserId(req) });
    req.flash?.("success", "Loan renewed successfully.");
  } catch (err) { req.flash?.("error", err.message || "Could not renew this loan."); }
  return res.redirect("/student/library");
};

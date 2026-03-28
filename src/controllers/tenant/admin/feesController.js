const mongoose = require("mongoose");
const crypto = require("crypto");
const { body, validationResult } = require("express-validator");

const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || "").trim());

function str(v, max = 1000) {
  return String(v || "").trim().slice(0, max);
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(String(v ?? ""), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

function hashSnapshot(snapshot) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshot || {}))
    .digest("hex");
}

function studentName(s) {
  return (
    s?.fullName ||
    s?.name ||
    [s?.firstName, s?.middleName, s?.lastName].filter(Boolean).join(" ") ||
    "Learner"
  );
}

function studentReg(s) {
  return s?.regNo || s?.studentNo || s?.indexNumber || "";
}

function getModels(req) {
  const models = req.models || {};

  return {
    Fee: models.Fees || models.Fee || models.FeePlan || models.SchoolFee || null,
    Student: models.Student || null,
    ClassModel: models.Class || models.ClassGroup || models.SchoolClass || null,
  };
}

function ensureModels(req, res, needed = {}) {
  const missing = Object.entries(needed)
    .filter(([, model]) => !model)
    .map(([name]) => name);

  if (missing.length) {
    console.error("Missing required models:", missing);
    console.error("Available req.models keys:", Object.keys(req.models || {}));
    res.status(500).send("Server model configuration error.");
    return false;
  }

  return true;
}

async function nextIssueNumber(req) {
  const { Fee } = getModels(req);
  if (!Fee) throw new Error("Fee model is not registered in req.models.");

  const last = await Fee.findOne({ issueNumber: { $ne: "" } })
    .sort({ createdAt: -1 })
    .select("issueNumber")
    .lean();

  const prev = String(last?.issueNumber || "");
  const m = prev.match(/(\d+)\s*$/);
  const lastNum = m ? parseInt(m[1], 10) : 0;

  return `CA-FEE-${String(lastNum + 1).padStart(6, "0")}`;
}

function parseItemsFromBody(body = {}) {
  const titles = Array.isArray(body.itemTitle) ? body.itemTitle : [body.itemTitle];
  const categories = Array.isArray(body.itemCategory) ? body.itemCategory : [body.itemCategory];
  const amounts = Array.isArray(body.itemAmount) ? body.itemAmount : [body.itemAmount];
  const requireds = Array.isArray(body.itemRequired) ? body.itemRequired : [body.itemRequired];
  const notes = Array.isArray(body.itemNote) ? body.itemNote : [body.itemNote];

  const maxLen = Math.max(
    titles.length,
    categories.length,
    amounts.length,
    requireds.length,
    notes.length
  );

  const items = [];

  for (let i = 0; i < maxLen; i += 1) {
    const title = str(titles[i], 120);
    const category = str(categories[i] || "Other", 50);
    const amount = money(amounts[i]);
    const required = ["1", "true", "yes", "on"].includes(
      String(requireds[i] || "").toLowerCase()
    );
    const note = str(notes[i], 200);

    if (!title) continue;

    items.push({
      title,
      category,
      amount,
      required,
      note,
    });
  }

  return items;
}

function feeRules() {
  return [
    body("student").custom((v) => isObjId(v)).withMessage("Learner is required."),
    body("academicYear")
      .trim()
      .isLength({ min: 1, max: 20 })
      .withMessage("Academic year is required."),
    body("term").isInt({ min: 1, max: 3 }).withMessage("Term must be 1-3."),
    body("title").optional({ checkFalsy: true }).trim().isLength({ max: 160 }),
    body("discount").optional({ checkFalsy: false }).isFloat({ min: 0 }).toFloat(),
    body("amountPaid").optional({ checkFalsy: false }).isFloat({ min: 0 }).toFloat(),
    body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  ];
}

async function buildLive(req, payload) {
  const { Student } = getModels(req);
  if (!Student) throw new Error("Student model is not registered in req.models.");

  const student = await Student.findById(payload.student)
    .populate("classGroup", "name code")
    .lean();

  if (!student) return null;

  const items = parseItemsFromBody(payload);
  if (!items.length) return null;

  const subtotal = items.reduce((sum, item) => sum + money(item.amount), 0);
  const discount = money(payload.discount || 0);
  const totalAmount = Math.max(0, subtotal - discount);
  const amountPaid = money(payload.amountPaid || 0);
  const balance = Math.max(0, totalAmount - amountPaid);

  let status = "draft";
  if (payload.status === "void") status = "void";
  else if (balance <= 0 && totalAmount > 0) status = "paid";
  else if (amountPaid > 0 && balance > 0) status = "partial";
  else if (payload.status === "issued") status = "issued";

  return {
    student: {
      _id: student._id,
      name: studentName(student),
      reg: studentReg(student),
      classGroup: student.classGroup?.name || student.classGroup?.code || "—",
    },
    feeMeta: {
      title: str(payload.title || "School Fees", 160),
      academicYear: str(payload.academicYear, 20),
      term: clampInt(payload.term, 1, 3, 1),
      issueNumber: payload.issueNumber || "",
      issuedAt: payload.issuedAt || null,
      dueDate: payload.dueDate || null,
    },
    items,
    totals: {
      subtotal,
      discount,
      totalAmount,
      amountPaid,
      balance,
      itemsCount: items.length,
    },
    status,
    notes: str(payload.notes, 1000),
  };
}

async function createOrUpdateFee(req, data, existingId = null) {
  const { Fee, Student } = getModels(req);

  if (!Fee) throw new Error("Fee model is not registered in req.models.");
  if (!Student) throw new Error("Student model is not registered in req.models.");

  const student = await Student.findById(data.student).select("_id classGroup").lean();
  if (!student) return { ok: false, reason: "Learner not found." };

  const live = await buildLive(req, data);
  if (!live || !live.items.length) {
    return { ok: false, reason: "Add at least one fee item." };
  }

  const docBase = {
    student: data.student,
    classGroup: student.classGroup || null,
    academicYear: str(data.academicYear, 20),
    term: clampInt(data.term, 1, 3, 1),
    title: str(data.title || "School Fees", 160),
    autoGenerated: false,
    items: live.items,
    subtotal: live.totals.subtotal,
    discount: live.totals.discount,
    totalAmount: live.totals.totalAmount,
    amountPaid: live.totals.amountPaid,
    balance: live.totals.balance,
    dueDate: data.dueDate || null,
    notes: str(data.notes, 1000),
    updatedBy: req.user?._id || null,
  };

  let doc;

  if (existingId) {
    await Fee.updateOne(
      { _id: existingId },
      {
        $set: {
          ...docBase,
          status: live.status === "void" ? "void" : "draft",
        },
      }
    );
    doc = await Fee.findById(existingId).lean();
  } else {
    doc = await Fee.create({
      ...docBase,
      status: "draft",
      createdBy: req.user?._id || null,
    });
    doc = doc.toObject();
  }

  const snapshot = {
    feeMeta: {
      _id: doc._id,
      title: doc.title,
      academicYear: doc.academicYear,
      term: doc.term,
      status: doc.status,
      issueNumber: doc.issueNumber || "",
      issuedAt: doc.issuedAt || null,
      dueDate: doc.dueDate || null,
    },
    ...live,
  };

  await Fee.updateOne(
    { _id: doc._id },
    {
      $set: {
        snapshot,
        snapshotHash: hashSnapshot(snapshot),
      },
    }
  );

  return { ok: true, id: String(doc._id), snapshot };
}

function normalizeFee(doc) {
  const snap = doc.snapshot || {};
  const student = snap.student || {};
  const feeMeta = snap.feeMeta || {};
  const totals = snap.totals || {};

  return {
    id: String(doc._id || ""),
    studentId: doc.student?._id ? String(doc.student._id) : String(doc.student || ""),
    studentName: student.name || "Learner",
    reg: student.reg || "",
    className: student.classGroup || doc.classGroup?.name || doc.classGroup?.code || "—",
    title: feeMeta.title || doc.title || "School Fees",
    academicYear: feeMeta.academicYear || doc.academicYear || "",
    term: Number(feeMeta.term || doc.term || 1),
    subtotal: Number(totals.subtotal || doc.subtotal || 0),
    discount: Number(totals.discount || doc.discount || 0),
    totalAmount: Number(totals.totalAmount || doc.totalAmount || 0),
    amountPaid: Number(totals.amountPaid || doc.amountPaid || 0),
    balance: Number(totals.balance || doc.balance || 0),
    itemsCount: Number(totals.itemsCount || (doc.items || []).length || 0),
    status: doc.status || "draft",
    issueNumber: doc.issueNumber || "",
    issuedAt: doc.issuedAt ? new Date(doc.issuedAt).toLocaleString() : "",
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toLocaleString() : "",
    notes: doc.notes || "",
    items: Array.isArray(snap.items) ? snap.items : doc.items || [],
  };
}

module.exports = {
  feeRules: feeRules(),

  list: async (req, res) => {
    try {
      const { Fee, Student, ClassModel } = getModels(req);

      if (!ensureModels(req, res, { Fee, Student, ClassModel })) return;

      const q = str(req.query.q, 120);
      const status = str(req.query.status, 20);
      const classGroup = str(req.query.classGroup, 80);
      const academicYear = str(req.query.academicYear, 20);
      const term = str(req.query.term, 10);
      const fid = str(req.query.fid, 80);

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};

      if (status && ["draft", "issued", "partial", "paid", "void"].includes(status)) {
        filter.status = status;
      }
      if (classGroup && isObjId(classGroup)) filter.classGroup = classGroup;
      if (academicYear) filter.academicYear = academicYear;
      if (term && Number.isFinite(Number(term))) filter.term = Number(term);

      if (q) {
        const students = await Student.find({
          $or: [
            { fullName: { $regex: q, $options: "i" } },
            { name: { $regex: q, $options: "i" } },
            { regNo: { $regex: q, $options: "i" } },
            { studentNo: { $regex: q, $options: "i" } },
            { indexNumber: { $regex: q, $options: "i" } },
          ],
        })
          .select("_id")
          .limit(1000)
          .lean();

        filter.student = students.length ? { $in: students.map((s) => s._id) } : { $in: [] };
      }

      const total = await Fee.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const fees = await Fee.find(filter)
        .populate("student", "fullName name regNo studentNo indexNumber")
        .populate("classGroup", "name code")
        .sort({ updatedAt: -1, _id: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const classes = await ClassModel.find({})
        .select("name code")
        .sort({ name: 1 })
        .lean();

      const studentsList = await Student.find({})
        .select("fullName name regNo studentNo indexNumber classGroup")
        .sort({ fullName: 1, name: 1 })
        .limit(4000)
        .lean();

      const feeData = fees.map(normalizeFee);

      const kpis = {
        total,
        draft: await Fee.countDocuments({ ...filter, status: "draft" }),
        issued: await Fee.countDocuments({ ...filter, status: "issued" }),
        paid: await Fee.countDocuments({ ...filter, status: "paid" }),
        totalValue: feeData.reduce((sum, f) => sum + Number(f.totalAmount || 0), 0),
      };

return res.render("tenant/fees/index", {
  tenant: req.tenant || null,
  fees,          // raw db docs
  feeData,       // normalized array used by JS
  classes,
  studentsList,
  csrfToken: res.locals.csrfToken || null,
  kpis,
  query: {
    q,
    status,
    classGroup,
    academicYear,
    term,
    page: safePage,
    total,
    totalPages,
    perPage,
  },
  messages: {
    success: req.flash ? req.flash("success") : [],
    error: req.flash ? req.flash("error") : [],
  },
});
    } catch (err) {
      console.error("FEES LIST ERROR:", err);
      return res.status(500).send("Failed to load fees.");
    }
  },

  create: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/fees");
    }

    try {
      const out = await createOrUpdateFee(req, req.body);
      if (!out.ok) {
        req.flash?.("error", out.reason || "Failed to create fee.");
        return res.redirect("/admin/fees");
      }

      req.flash?.("success", "Fee created.");
      return res.redirect(`/admin/fees?fid=${encodeURIComponent(out.id)}`);
    } catch (err) {
      console.error("CREATE FEE ERROR:", err);
      req.flash?.("error", "Failed to create fee.");
      return res.redirect("/admin/fees");
    }
  },

  update: async (req, res) => {
    const { Fee } = getModels(req);
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/fees");
    }

    try {
      if (!Fee) {
        console.error("Missing Fee model. Available req.models keys:", Object.keys(req.models || {}));
        req.flash?.("error", "Server model configuration error.");
        return res.redirect("/admin/fees");
      }

      const id = str(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid fee id.");
        return res.redirect("/admin/fees");
      }

      const existing = await Fee.findById(id).lean();
      if (!existing) {
        req.flash?.("error", "Fee not found.");
        return res.redirect("/admin/fees");
      }

      if (
        existing.status === "issued" ||
        existing.status === "paid" ||
        existing.status === "partial"
      ) {
        req.flash?.("error", "Issued or paid fees should not be edited directly.");
        return res.redirect(`/admin/fees?fid=${encodeURIComponent(id)}`);
      }

      const out = await createOrUpdateFee(req, req.body, id);
      if (!out.ok) {
        req.flash?.("error", out.reason || "Failed to update fee.");
        return res.redirect("/admin/fees");
      }

      req.flash?.("success", "Fee updated.");
      return res.redirect(`/admin/fees?fid=${encodeURIComponent(id)}`);
    } catch (err) {
      console.error("UPDATE FEE ERROR:", err);
      req.flash?.("error", "Failed to update fee.");
      return res.redirect("/admin/fees");
    }
  },

  bulkGenerate: async (req, res) => {
    try {
      const { Student } = getModels(req);

      if (!Student) {
        console.error("Missing Student model. Available req.models keys:", Object.keys(req.models || {}));
        req.flash?.("error", "Server model configuration error.");
        return res.redirect("/admin/fees");
      }

      const classGroup = str(req.body.classGroup, 80);
      const academicYear = str(req.body.academicYear, 20);
      const term = clampInt(req.body.term, 1, 3, 1);

      if (!isObjId(classGroup) || !academicYear) {
        req.flash?.("error", "Class, academic year and term are required.");
        return res.redirect("/admin/fees");
      }

      const students = await Student.find({ classGroup }).select("_id").lean();

      if (!students.length) {
        req.flash?.("error", "No learners found in selected class.");
        return res.redirect("/admin/fees");
      }

      const itemTitles = Array.isArray(req.body.itemTitle) ? req.body.itemTitle : [req.body.itemTitle];
      if (!itemTitles.some((x) => str(x))) {
        req.flash?.("error", "Add at least one fee item for bulk generation.");
        return res.redirect("/admin/fees");
      }

      let created = 0;
      let failed = 0;

      for (const s of students) {
        const out = await createOrUpdateFee(req, {
          ...req.body,
          student: String(s._id),
          academicYear,
          term,
        });

        if (out.ok) created += 1;
        else failed += 1;
      }

      req.flash?.("success", `Bulk fee generation complete. Created ${created}, failed ${failed}.`);
      return res.redirect("/admin/fees");
    } catch (err) {
      console.error("BULK GENERATE FEES ERROR:", err);
      req.flash?.("error", "Bulk generation failed.");
      return res.redirect("/admin/fees");
    }
  },

  issue: async (req, res) => {
    try {
      const { Fee } = getModels(req);

      if (!Fee) {
        console.error("Missing Fee model. Available req.models keys:", Object.keys(req.models || {}));
        req.flash?.("error", "Server model configuration error.");
        return res.redirect("/admin/fees");
      }

      const id = str(req.params.id, 80);

      if (!isObjId(id)) {
        req.flash?.("error", "Invalid fee id.");
        return res.redirect("/admin/fees");
      }

      const fee = await Fee.findById(id).lean();
      if (!fee) {
        req.flash?.("error", "Fee not found.");
        return res.redirect("/admin/fees");
      }

      if (fee.status === "void") {
        req.flash?.("error", "Voided fees cannot be issued.");
        return res.redirect("/admin/fees");
      }

      const issueNumber = await nextIssueNumber(req);

      await Fee.updateOne(
        { _id: id },
        {
          $set: {
            status:
              fee.balance <= 0 && fee.totalAmount > 0
                ? "paid"
                : fee.amountPaid > 0
                  ? "partial"
                  : "issued",
            issueNumber,
            issuedAt: new Date(),
            snapshotHash: hashSnapshot(fee.snapshot),
            updatedBy: req.user?._id || null,
          },
        }
      );

      req.flash?.("success", `Fee issued (${issueNumber}).`);
      return res.redirect(`/admin/fees?fid=${encodeURIComponent(id)}`);
    } catch (err) {
      console.error("ISSUE FEE ERROR:", err);
      req.flash?.("error", "Failed to issue fee.");
      return res.redirect("/admin/fees");
    }
  },

  voidFee: async (req, res) => {
    try {
      const { Fee } = getModels(req);

      if (!Fee) {
        console.error("Missing Fee model. Available req.models keys:", Object.keys(req.models || {}));
        req.flash?.("error", "Server model configuration error.");
        return res.redirect("/admin/fees");
      }

      const id = str(req.params.id, 80);

      if (!isObjId(id)) {
        req.flash?.("error", "Invalid fee id.");
        return res.redirect("/admin/fees");
      }

      await Fee.updateOne(
        { _id: id },
        { $set: { status: "void", updatedBy: req.user?._id || null } }
      );

      req.flash?.("success", "Fee voided.");
      return res.redirect(`/admin/fees?fid=${encodeURIComponent(id)}`);
    } catch (err) {
      console.error("VOID FEE ERROR:", err);
      req.flash?.("error", "Failed to void fee.");
      return res.redirect("/admin/fees");
    }
  },

  remove: async (req, res) => {
    try {
      const { Fee } = getModels(req);

      if (!Fee) {
        console.error("Missing Fee model. Available req.models keys:", Object.keys(req.models || {}));
        req.flash?.("error", "Server model configuration error.");
        return res.redirect("/admin/fees");
      }

      const id = str(req.params.id, 80);

      if (!isObjId(id)) {
        req.flash?.("error", "Invalid fee id.");
        return res.redirect("/admin/fees");
      }

      await Fee.deleteOne({ _id: id });
      req.flash?.("success", "Fee deleted.");
      return res.redirect("/admin/fees");
    } catch (err) {
      console.error("DELETE FEE ERROR:", err);
      req.flash?.("error", "Failed to delete fee.");
      return res.redirect("/admin/fees");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Fee } = getModels(req);

      if (!Fee) {
        console.error("Missing Fee model. Available req.models keys:", Object.keys(req.models || {}));
        req.flash?.("error", "Server model configuration error.");
        return res.redirect("/admin/fees");
      }

      const action = str(req.body.action, 20);

      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isObjId(x));

      if (!ids.length) {
        req.flash?.("error", "No fees selected.");
        return res.redirect("/admin/fees");
      }

      if (action === "delete") {
        await Fee.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected fees deleted.");
      } else if (action === "void") {
        await Fee.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "void", updatedBy: req.user?._id || null } }
        );
        req.flash?.("success", "Selected fees voided.");
      } else if (action === "issue") {
        let issued = 0;

        for (const id of ids) {
          const fee = await Fee.findById(id).lean();
          if (!fee || fee.status === "void") continue;

          const issueNumber = await nextIssueNumber(req);

          await Fee.updateOne(
            { _id: id },
            {
              $set: {
                status:
                  fee.balance <= 0 && fee.totalAmount > 0
                    ? "paid"
                    : fee.amountPaid > 0
                      ? "partial"
                      : "issued",
                issueNumber,
                issuedAt: new Date(),
                updatedBy: req.user?._id || null,
              },
            }
          );

          issued += 1;
        }

        req.flash?.("success", `Issued ${issued} fee(s).`);
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/fees");
    } catch (err) {
      console.error("FEE BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/fees");
    }
  },
};
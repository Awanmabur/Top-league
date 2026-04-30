const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

const asNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function getStudentName(st) {
  if (!st) return "—";
  return (
    st.fullName ||
    [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") ||
    st.name ||
    st.regNo ||
    st.admissionNumber ||
    "—"
  );
}

function getProgramName(p) {
  if (!p) return "—";
  return p.title || p.shortTitle || p.name || p.programName || p.code || "â€”";
}

function scholarshipValueLabel(doc) {
  if (doc.type === "Percentage") return `${Number(doc.value || 0)}%`;
  if (doc.type === "Full") return "100%";
  return Number(doc.amount || 0);
}

function serializeScholarship(doc) {
  const student = doc.studentId || null;
  const program = doc.programId || null;

  return {
    id: String(doc._id),
    name: doc.name || "",
    code: doc.code || "",
    studentId: student?._id ? String(student._id) : String(doc.studentId?._id || doc.studentId || ""),
    studentName: getStudentName(student),
    programId: program?._id ? String(program._id) : String(doc.programId?._id || doc.programId || ""),
    programName: getProgramName(program),
    type: doc.type || "Fixed Amount",
    value: Number(doc.value || 0),
    amount: Number(doc.amount || 0),
    valueLabel: scholarshipValueLabel(doc),
    sponsor: doc.sponsor || "",
    startDate: doc.startDate ? new Date(doc.startDate).toISOString().slice(0, 10) : "",
    endDate: doc.endDate ? new Date(doc.endDate).toISOString().slice(0, 10) : "",
    status: doc.status || "Active",
    notes: doc.notes || "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
  };
}

function computeKpis(list = []) {
  const active = list.filter((x) => x.status === "Active").length;
  const inactive = list.filter((x) => x.status === "Inactive").length;
  const expired = list.filter((x) => x.status === "Expired").length;
  const revoked = list.filter((x) => x.status === "Revoked").length;

  const percentageCount = list.filter((x) => x.type === "Percentage").length;
  const fixedCount = list.filter((x) => x.type === "Fixed Amount").length;
  const fullCount = list.filter((x) => x.type === "Full").length;

  const amountTotal = list
    .filter((x) => x.type === "Fixed Amount")
    .reduce((sum, x) => sum + Number(x.amount || 0), 0);

  return {
    total: list.length,
    active,
    inactive,
    expired,
    revoked,
    percentageCount,
    fixedCount,
    fullCount,
    amountTotal,
  };
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const type = str(query.type || "all");
  const student = str(query.student || "all");
  const program = str(query.program || "all");
  const view = str(query.view || "list") || "list";

  const mongo = { isDeleted: { $ne: true } };

  if (status !== "all") mongo.status = status;
  if (type !== "all") mongo.type = type;
  if (student !== "all" && isValidId(student)) mongo.studentId = student;
  if (program !== "all" && isValidId(program)) mongo.programId = program;

  if (q) {
    mongo.$or = [
      { name: new RegExp(q, "i") },
      { code: new RegExp(q, "i") },
      { sponsor: new RegExp(q, "i") },
      { type: new RegExp(q, "i") },
      { status: new RegExp(q, "i") },
      { notes: new RegExp(q, "i") },
    ];
  }

  return {
    mongo,
    clean: { q, status, type, student, program, view },
  };
}

module.exports = {
  /**
   * GET /admin/scholarships
   */
  index: async (req, res) => {
    const { Scholarship, Student, Subject, Program } = req.models;
    const AcademicSubject = Subject || Program || null;

    const { mongo, clean } = buildFilters(req.query);

    const [scholarshipDocs, studentDocs, programDocs] = await Promise.all([
      Scholarship.find(mongo)
        .populate("studentId", "firstName middleName lastName fullName admissionNumber")
        .populate("programId", "title shortTitle name code")
        .sort({ createdAt: -1 })
        .lean(),
      Student
        ? Student.find({})
            .select("firstName middleName lastName fullName admissionNumber")
            .sort({ createdAt: -1 })
            .lean()
        : [],
      AcademicSubject
        ? AcademicSubject.find({})
            .select("title shortTitle name code")
            .sort({ title: 1, shortTitle: 1, name: 1, code: 1 })
            .lean()
        : [],
    ]);

    const scholarships = scholarshipDocs.map(serializeScholarship);
    const kpis = computeKpis(scholarships);

    return res.render("tenant/finance/scholarships", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      scholarships,
      kpis,
      students: (studentDocs || []).map((s) => ({
        id: String(s._id),
        name: getStudentName(s),
      })),
      programs: (programDocs || []).map((p) => ({
        id: String(p._id),
        name: getProgramName(p),
      })),
      query: clean,
    });
  },

  /**
   * POST /admin/scholarships
   */
  create: async (req, res) => {
    const { Scholarship } = req.models;

    const name = str(req.body.name);
    const code = str(req.body.code);
    const studentId = str(req.body.studentId);
    const programId = str(req.body.programId);
    const type = str(req.body.type || "Fixed Amount");
    const value = Math.max(0, asNum(req.body.value, 0));
    const amount = Math.max(0, asNum(req.body.amount, 0));
    const sponsor = str(req.body.sponsor);
    const startDate = asDate(req.body.startDate);
    const endDate = asDate(req.body.endDate);
    const status = str(req.body.status || "Active");
    const notes = str(req.body.notes);

    if (!name) {
      req.flash?.("error", "Scholarship name is required.");
      return res.redirect("/admin/scholarships");
    }

    if (!isValidId(studentId) && !isValidId(programId)) {
      req.flash?.("error", "Select at least a student or a program.");
      return res.redirect("/admin/scholarships");
    }

    if (type === "Percentage" && !(value > 0)) {
      req.flash?.("error", "Percentage value must be greater than zero.");
      return res.redirect("/admin/scholarships");
    }

    if (type === "Fixed Amount" && !(amount > 0)) {
      req.flash?.("error", "Amount must be greater than zero.");
      return res.redirect("/admin/scholarships");
    }

    await Scholarship.create({
      name,
      code,
      studentId: isValidId(studentId) ? studentId : null,
      programId: isValidId(programId) ? programId : null,
      type: ["Percentage", "Fixed Amount", "Full"].includes(type) ? type : "Fixed Amount",
      value: type === "Percentage" ? value : type === "Full" ? 100 : 0,
      amount: type === "Fixed Amount" ? amount : 0,
      sponsor,
      startDate,
      endDate,
      status: ["Active", "Inactive", "Expired", "Revoked"].includes(status) ? status : "Active",
      notes,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Scholarship created successfully.");
    return res.redirect("/admin/scholarships");
  },

  /**
   * POST /admin/scholarships/:id/update
   */
  update: async (req, res) => {
    const { Scholarship } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid scholarship ID.");
      return res.redirect("/admin/scholarships");
    }

    const existing = await Scholarship.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!existing) {
      req.flash?.("error", "Scholarship not found.");
      return res.redirect("/admin/scholarships");
    }

    const name = str(req.body.name);
    const code = str(req.body.code);
    const studentId = str(req.body.studentId);
    const programId = str(req.body.programId);
    const type = str(req.body.type || existing.type || "Fixed Amount");
    const value = Math.max(0, asNum(req.body.value, 0));
    const amount = Math.max(0, asNum(req.body.amount, 0));
    const sponsor = str(req.body.sponsor);
    const startDate = asDate(req.body.startDate);
    const endDate = asDate(req.body.endDate);
    const status = str(req.body.status || existing.status || "Active");
    const notes = str(req.body.notes);

    if (!name) {
      req.flash?.("error", "Scholarship name is required.");
      return res.redirect("/admin/scholarships");
    }

    if (!isValidId(studentId) && !isValidId(programId)) {
      req.flash?.("error", "Select at least a student or a program.");
      return res.redirect("/admin/scholarships");
    }

    if (type === "Percentage" && !(value > 0)) {
      req.flash?.("error", "Percentage value must be greater than zero.");
      return res.redirect("/admin/scholarships");
    }

    if (type === "Fixed Amount" && !(amount > 0)) {
      req.flash?.("error", "Amount must be greater than zero.");
      return res.redirect("/admin/scholarships");
    }

    existing.name = name;
    existing.code = code;
    existing.studentId = isValidId(studentId) ? studentId : null;
    existing.programId = isValidId(programId) ? programId : null;
    existing.type = ["Percentage", "Fixed Amount", "Full"].includes(type) ? type : existing.type;
    existing.value = type === "Percentage" ? value : type === "Full" ? 100 : 0;
    existing.amount = type === "Fixed Amount" ? amount : 0;
    existing.sponsor = sponsor;
    existing.startDate = startDate;
    existing.endDate = endDate;
    existing.status = ["Active", "Inactive", "Expired", "Revoked"].includes(status) ? status : existing.status;
    existing.notes = notes;
    existing.updatedBy = actorUserId(req);

    await existing.save();

    req.flash?.("success", "Scholarship updated successfully.");
    return res.redirect("/admin/scholarships");
  },

  /**
   * POST /admin/scholarships/:id/activate
   */
  activate: async (req, res) => {
    const { Scholarship } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid scholarship ID.");
      return res.redirect("/admin/scholarships");
    }

    await Scholarship.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Active", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Scholarship activated.");
    return res.redirect("/admin/scholarships");
  },

  /**
   * POST /admin/scholarships/:id/revoke
   */
  revoke: async (req, res) => {
    const { Scholarship } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid scholarship ID.");
      return res.redirect("/admin/scholarships");
    }

    await Scholarship.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Revoked", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Scholarship revoked.");
    return res.redirect("/admin/scholarships");
  },

  /**
   * POST /admin/scholarships/:id/expire
   */
  expire: async (req, res) => {
    const { Scholarship } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid scholarship ID.");
      return res.redirect("/admin/scholarships");
    }

    await Scholarship.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Expired", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Scholarship expired.");
    return res.redirect("/admin/scholarships");
  },

  /**
   * POST /admin/scholarships/:id/delete
   */
  delete: async (req, res) => {
    const { Scholarship } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid scholarship ID.");
      return res.redirect("/admin/scholarships");
    }

    await Scholarship.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Scholarship deleted.");
    return res.redirect("/admin/scholarships");
  },

  /**
   * POST /admin/scholarships/bulk
   */
  bulkAction: async (req, res) => {
    const { Scholarship } = req.models;

    const ids = str(req.body.ids)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    if (!ids.length) {
      req.flash?.("error", "No scholarships selected.");
      return res.redirect("/admin/scholarships");
    }

    const action = str(req.body.action);
    const patch = { updatedBy: actorUserId(req) };

    if (action === "activate") patch.status = "Active";
    if (action === "inactive") patch.status = "Inactive";
    if (action === "revoke") patch.status = "Revoked";
    if (action === "expire") patch.status = "Expired";
    if (action === "delete") {
      patch.isDeleted = true;
      patch.deletedAt = new Date();
    }

    await Scholarship.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/scholarships");
  },
};
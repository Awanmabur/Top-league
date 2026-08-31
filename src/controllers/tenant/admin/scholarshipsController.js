const mongoose = require("mongoose");
const scholarshipService = require("../../../services/tenant/scholarshipService");
const { assertActiveProgram, assertProgramAssignment } = require("../../../services/tenant/organizationCatalogService");

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
    recordKind: doc.recordKind || (student ? "Award" : "Program"),
    sourceApplicationId: doc.sourceApplicationId ? String(doc.sourceApplicationId) : "",
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
      { name: new RegExp(scholarshipService.escapeRegex(q), "i") },
      { code: new RegExp(scholarshipService.escapeRegex(q), "i") },
      { sponsor: new RegExp(scholarshipService.escapeRegex(q), "i") },
      { type: new RegExp(scholarshipService.escapeRegex(q), "i") },
      { status: new RegExp(scholarshipService.escapeRegex(q), "i") },
      { notes: new RegExp(scholarshipService.escapeRegex(q), "i") },
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
    const AcademicProgram = Program || Subject || null;

    const { mongo, clean } = buildFilters(req.query);

    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 50;

    const [totalCount, scholarshipDocs, kpiDocs, studentDocs, programDocs] = await Promise.all([
      Scholarship.countDocuments(mongo),
      Scholarship.find(mongo)
        .populate("studentId", "firstName middleName lastName fullName admissionNumber")
        .populate("programId", "title shortTitle name code")
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .lean(),
      // Unpopulated projection over the full filtered set, so KPIs cover
      // every matching scholarship rather than only the current page.
      Scholarship.find(mongo).select("status type amount").lean(),
      Student
        ? Student.find({})
            .select("firstName middleName lastName fullName admissionNumber")
            .sort({ createdAt: -1 })
            .limit(4000)
            .lean()
        : [],
      AcademicProgram
        ? AcademicProgram.find({})
            .select("title shortTitle name code")
            .sort({ title: 1, shortTitle: 1, name: 1, code: 1 })
            .lean()
        : [],
    ]);

    const totalPages = Math.max(Math.ceil(totalCount / perPage), 1);
    const safePage = Math.min(page, totalPages);

    const scholarships = scholarshipDocs.map(serializeScholarship);
    const kpis = computeKpis(
      kpiDocs.map((doc) => ({
        status: doc.status || "Active",
        type: doc.type || "Fixed Amount",
        amount: Number(doc.amount || 0),
      })),
    );

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
      query: { ...clean, page: safePage, perPage, total: totalCount, totalPages },
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

    if (startDate && endDate && endDate < startDate) {
      req.flash?.("error", "End date cannot be before start date.");
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

    let activeProgramId = null;
    try {
      activeProgramId = isValidId(programId) ? await assertActiveProgram(req.models.Program, programId) : null;
    } catch (err) {
      req.flash?.("error", err.message || "Selected academic program is unavailable.");
      return res.redirect("/admin/scholarships");
    }

    await Scholarship.create({
      name,
      code,
      studentId: isValidId(studentId) ? studentId : null,
      programId: activeProgramId,
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

    if (startDate && endDate && endDate < startDate) {
      req.flash?.("error", "End date cannot be before start date.");
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

    let activeProgramId = null;
    try {
      activeProgramId = isValidId(programId) ? await assertProgramAssignment(req.models.Program, programId, existing.programId) : null;
    } catch (err) {
      req.flash?.("error", err.message || "Selected academic program is unavailable.");
      return res.redirect("/admin/scholarships");
    }

    existing.name = name;
    existing.code = code;
    existing.studentId = isValidId(studentId) ? studentId : null;
    existing.programId = activeProgramId;
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

    const scholarship = await Scholarship.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!scholarship) { req.flash?.("error", "Scholarship not found."); return res.redirect("/admin/scholarships"); }
    if (scholarship.status === "Revoked") { req.flash?.("error", "Revoked scholarships are terminal and cannot be reactivated."); return res.redirect("/admin/scholarships"); }
    if (scholarship.endDate && new Date(scholarship.endDate) < new Date()) { req.flash?.("error", "Extend the end date before activating an expired scholarship."); return res.redirect("/admin/scholarships"); }
    scholarship.status = "Active"; scholarship.updatedBy = actorUserId(req); await scholarship.save();

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

    if (!["activate", "inactive", "revoke", "expire", "delete"].includes(action)) {
      req.flash?.("error", "Invalid scholarship bulk action.");
      return res.redirect("/admin/scholarships");
    }
    if (action === "activate") patch.status = "Active";
    if (action === "inactive") patch.status = "Inactive";
    if (action === "revoke") patch.status = "Revoked";
    if (action === "expire") patch.status = "Expired";
    if (action === "delete") {
      patch.isDeleted = true;
      patch.deletedAt = new Date();
    }

    const filter = { _id: { $in: ids }, isDeleted: { $ne: true } };
    if (["activate", "inactive", "expire"].includes(action)) filter.status = { $ne: "Revoked" };
    await Scholarship.updateMany(filter, { $set: patch });

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/scholarships");
  },

  exportCsv: async (req, res) => {
    const { Scholarship } = req.models;
    const { mongo } = buildFilters(req.query);
    const docs = await Scholarship.find(mongo)
      .populate("studentId", "firstName middleName lastName fullName admissionNumber regNo")
      .populate("programId", "title shortTitle name code")
      .sort({ createdAt: -1 })
      .lean();
    const rows = docs.map(serializeScholarship);
    const header = ["Name","Code","Kind","Student","Program","Type","Value","Sponsor","Start Date","End Date","Status","Notes"];
    const lines = [header.map(scholarshipService.csvCell).join(",")];
    for (const row of rows) {
      lines.push([
        row.name,row.code,row.recordKind,row.studentName,row.programName,row.type,row.valueLabel,row.sponsor,row.startDate,row.endDate,row.status,row.notes,
      ].map(scholarshipService.csvCell).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="scholarships.csv"');
    return res.send(`\uFEFF${lines.join("\\r\\n")}`);
  },

  applications: async (req, res) => {
    const { Scholarship, ScholarshipApplication } = req.models;
    if (!isValidId(req.params.id)) return res.status(404).send("Scholarship not found");
    const scholarship = await Scholarship.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!scholarship) return res.status(404).send("Scholarship not found");
    const status = str(req.query.status);
    const q = str(req.query.q);
    const filter = { scholarship: scholarship._id, isDeleted: { $ne: true } };
    if (scholarshipService.APPLICATION_STATUSES.includes(status)) filter.status = status;
    if (q) {
      const rx = new RegExp(scholarshipService.escapeRegex(q), "i");
      filter.$or = [{ applicationId: rx }, { fullName: rx }, { email: rx }, { phone: rx }, { regNo: rx }];
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 50;
    const total = await ScholarshipApplication.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(page, pages);
    const applications = await ScholarshipApplication.find(filter)
      .populate("program", "code name title shortTitle")
      .sort({ createdAt: -1 }).skip((safePage - 1) * perPage).limit(perPage).lean();
    return res.render("tenant/scholarships/applications", {
      tenant: req.tenant, csrfToken: req.csrfToken?.(),
      scholarship: { ...scholarship, title: scholarship.name }, applications,
      filters: { q, status }, pagination: { page: safePage, pages, total },
    });
  },

  applicationView: async (req, res) => {
    const { ScholarshipApplication } = req.models;
    if (!isValidId(req.params.appId)) return res.status(404).send("Application not found");
    const app = await ScholarshipApplication.findOne({ _id: req.params.appId, isDeleted: { $ne: true } })
      .populate("scholarship", "name code status type value amount sponsor")
      .populate("program", "code name title shortTitle")
      .lean();
    if (!app) return res.status(404).send("Application not found");
    if (app.scholarship) app.scholarship.title = app.scholarship.name;
    for (const key of ["transcript","idDocument","recommendationLetter"]) {
      if (app[key]?.url) app[key].url = scholarshipService.safeDocUrl(app[key].url);
    }
    if (Array.isArray(app.otherDocs)) app.otherDocs = app.otherDocs.map((d) => ({ ...d, url: scholarshipService.safeDocUrl(d.url) }));
    return res.render("tenant/scholarships/application-view", { tenant: req.tenant, csrfToken: req.csrfToken?.(), application: app });
  },

  applicationStatus: async (req, res) => {
    const { Scholarship, ScholarshipApplication } = req.models;
    if (!isValidId(req.params.appId)) return res.status(404).send("Application not found");
    const app = await ScholarshipApplication.findOne({ _id: req.params.appId, isDeleted: { $ne: true } });
    if (!app) return res.status(404).send("Application not found");
    const scholarship = await Scholarship.findOne({ _id: app.scholarship, isDeleted: { $ne: true } });
    if (!scholarship) return res.status(404).send("Scholarship not found");
    try {
      const status = str(req.body.status);
      scholarshipService.applyApplicationStatus(app, status, actorUserId(req));
      app.adminNotes = str(req.body.adminNotes).slice(0, 2000);
      if (status === "awarded" && app.student && !app.awardScholarshipId) {
        const award = await Scholarship.findOneAndUpdate(
          { sourceApplicationId: app._id },
          { $setOnInsert: {
            name: `${scholarship.name} — Award`, code: scholarship.code, recordKind: "Award",
            sourceScholarshipId: scholarship._id, sourceApplicationId: app._id,
            studentId: app.student, programId: app.program || scholarship.programId || null,
            type: scholarship.type, value: scholarship.value, amount: scholarship.amount,
            sponsor: scholarship.sponsor, currency: scholarship.currency || "UGX",
            startDate: scholarship.startDate, endDate: scholarship.endDate, status: "Active",
            notes: `Awarded from application ${app.applicationId}.`, createdBy: actorUserId(req), updatedBy: actorUserId(req),
          } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        app.awardScholarshipId = award._id;
      }
      await app.save();
      req.flash?.("success", "Scholarship application updated.");
    } catch (err) {
      req.flash?.("error", err?.message || "Could not update scholarship application.");
    }
    return res.redirect(`/admin/scholarships/applications/${app._id}`);
  },

  applicationBulk: async (req, res) => {
    const { Scholarship, ScholarshipApplication } = req.models;
    const ids = str(req.body.ids).split(",").map((x) => x.trim()).filter(isValidId);
    const actionMap = { review: "under_review", shortlist: "shortlisted", award: "awarded", reject: "rejected" };
    const status = actionMap[str(req.body.action)];
    if (!ids.length || !status) {
      req.flash?.("error", "Select applications and a valid bulk action.");
      return res.redirect("/admin/scholarships");
    }
    const apps = await ScholarshipApplication.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
    let changed = 0;
    for (const app of apps) {
      try {
        scholarshipService.applyApplicationStatus(app, status, actorUserId(req));
        if (status === "awarded" && app.student && !app.awardScholarshipId) {
          const scholarship = await Scholarship.findOne({ _id: app.scholarship, isDeleted: { $ne: true } });
          if (scholarship) {
            const award = await Scholarship.findOneAndUpdate(
              { sourceApplicationId: app._id },
              { $setOnInsert: { name: `${scholarship.name} — Award`, code: scholarship.code, recordKind: "Award", sourceScholarshipId: scholarship._id, sourceApplicationId: app._id, studentId: app.student, programId: app.program || scholarship.programId || null, type: scholarship.type, value: scholarship.value, amount: scholarship.amount, sponsor: scholarship.sponsor, currency: scholarship.currency || "UGX", startDate: scholarship.startDate, endDate: scholarship.endDate, status: "Active", notes: `Awarded from application ${app.applicationId}.`, createdBy: actorUserId(req), updatedBy: actorUserId(req) } },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            app.awardScholarshipId = award._id;
          }
        }
        await app.save();
        changed += 1;
      } catch (_) { /* invalid/terminal transitions are skipped */ }
    }
    req.flash?.("success", `${changed} scholarship application${changed === 1 ? "" : "s"} updated.`);
    const first = apps[0];
    return res.redirect(first ? `/admin/scholarships/${first.scholarship}/applications` : "/admin/scholarships");
  },


  scholarshipView: async (req, res) => {
    const { Scholarship, ScholarshipApplication } = req.models;
    if (!isValidId(req.params.id)) return res.status(404).send("Scholarship not found");
    const scholarship = await Scholarship.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate("programId", "title shortTitle name code").lean();
    if (!scholarship) return res.status(404).send("Scholarship not found");
    const counts = await ScholarshipApplication.aggregate([
      { $match: { scholarship: scholarship._id, isDeleted: { $ne: true } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const stats = {}; counts.forEach((x) => { stats[x._id] = x.count; });
    const compat = scholarshipService.toPublicScholarship(scholarship);
    return res.render("tenant/scholarships/view", { tenant: req.tenant, csrfToken: req.csrfToken?.(), scholarship: compat, stats });
  },

};
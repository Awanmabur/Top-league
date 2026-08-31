const mongoose = require("mongoose");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");
const {
  newCaseNumber,
  buildCaseValues,
  assertTransition,
  assertDeleteAllowed,
  safeEvidenceFile,
  retireDisciplineNotifications,
  syncDisciplineNotifications,
  escapeRegExp,
  csvCell,
} = require("../../../services/tenant/disciplineService");
const { safeStoredUrl } = require("../../../services/tenant/studentDocumentService");

const safeStr = (v, max = 1500) => String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max);
const isOid = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const toInt = (v, d) => Number.isFinite(parseInt(String(v || ""), 10)) ? parseInt(String(v || ""), 10) : d;
const actorId = (req) => req.user?._id || req.user?.userId || null;

async function loadStudent(Student, id) {
  if (!isOid(id)) throw new Error("Invalid student.");
  const student = await Student.findOne({
    _id: id,
    isDeleted: { $ne: true },
    status: { $nin: ["archived", "graduated"] },
  })
    .select("_id regNo fullName firstName lastName classId className academicYear term status userId guardianUserId")
    .lean();
  if (!student) throw new Error("Student not found or is no longer current.");
  return student;
}

async function createCaseWithRetry(DisciplineCase, values) {
  let last;
  for (let i = 0; i < 6; i += 1) {
    try {
      return await DisciplineCase.create({ ...values, caseNo: newCaseNumber() });
    } catch (err) {
      last = err;
      if (err?.code !== 11000) throw err;
    }
  }
  throw last || new Error("Could not allocate a unique case number.");
}

async function currentCase(DisciplineCase, id) {
  if (!isOid(id)) throw new Error("Invalid discipline case.");
  const row = await DisciplineCase.findOne({ _id: id, isDeleted: { $ne: true }, migrationQuarantinedAt: null });
  if (!row) throw new Error("Discipline case not found.");
  return row;
}

async function guardedSet(DisciplineCase, row, expectedRevision, values) {
  const expected = Number(expectedRevision);
  if (!Number.isFinite(expected) || expected !== Number(row.revision || 0)) {
    throw new Error("This discipline case changed in another session. Refresh and try again.");
  }
  const result = await DisciplineCase.updateOne(
    { _id: row._id, isDeleted: { $ne: true }, migrationQuarantinedAt: null, revision: expected },
    { $set: values },
    { runValidators: true }
  );
  if (Number(result.modifiedCount || 0) !== 1) {
    throw new Error("This discipline case changed in another session. Refresh and try again.");
  }
  return DisciplineCase.findOne({ _id: row._id, isDeleted: { $ne: true }, migrationQuarantinedAt: null });
}

async function ensurePublication(req, row) {
  const { DisciplineCase } = req.models;
  const actor = actorId(req);
  if (row?.studentVisible || row?.parentVisible) {
    if (!row.publishedAt) {
      await DisciplineCase.updateOne(
        {
          _id: row._id,
          publishedAt: null,
          isDeleted: { $ne: true },
          migrationQuarantinedAt: null,
          $or: [{ studentVisible: true }, { parentVisible: true }],
        },
        { $set: { publishedAt: new Date(), publishedBy: actor } }
      );
      row = await DisciplineCase.findById(row._id);
    }
    return row;
  }
  return row;
}

async function notify(req, row, student) {
  const actor = actorId(req);
  const publishedRow = await ensurePublication(req, row);
  if (publishedRow?.studentVisible || publishedRow?.parentVisible) {
    await syncDisciplineNotifications(req.models, publishedRow, student, actor);
  } else {
    await retireDisciplineNotifications(req.models, publishedRow?._id || row?._id, actor);
  }
  return publishedRow;
}

module.exports = {
  async index(req, res) {
    try {
      const { DisciplineCase, Student } = req.models;
      const q = safeStr(req.query.q, 120);
      const status = safeStr(req.query.status, 30);
      const page = Math.max(1, toInt(req.query.page, 1));
      const limit = Math.min(50, Math.max(10, toInt(req.query.limit, 20)));
      const skip = (page - 1) * limit;
      const filter = { isDeleted: { $ne: true }, migrationQuarantinedAt: null };
      if (status) filter.status = status;
      if (q) {
        const rx = new RegExp(escapeRegExp(q), "i");
        const sIds = await Student.find({ isDeleted: { $ne: true }, $or: [{ regNo: rx }, { fullName: rx }, { email: rx }] })
          .select("_id").limit(500).lean();
        filter.$or = [{ caseNo: rx }, { category: rx }, { description: rx }, { student: { $in: sIds.map((x) => x._id) } }];
      }
      const [total, rows, students, counts] = await Promise.all([
        DisciplineCase.countDocuments(filter),
        DisciplineCase.find(filter).populate({ path: "student", model: Student, select: "regNo fullName email" })
          .sort({ incidentDate: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
        Student.find({ isDeleted: { $ne: true }, status: { $nin: ["archived", "graduated"] } })
          .select("_id regNo fullName email").sort({ regNo: 1, fullName: 1 }).limit(2000).lean(),
        Promise.all(["open", "investigating", "hearing", "resolved", "dismissed"].map((s) =>
          DisciplineCase.countDocuments({ isDeleted: { $ne: true }, migrationQuarantinedAt: null, status: s })
        )),
      ]);
      const meta = {
        csrf: res.locals.csrfToken || (typeof req.csrfToken === "function" ? req.csrfToken() : ""),
        routes: {
          create: "/admin/discipline",
          update: "/admin/discipline/{id}",
          addAction: "/admin/discipline/{id}/action",
          reopen: "/admin/discipline/{id}/reopen",
          statement: "/admin/discipline/{id}/statement",
          attachments: "/admin/discipline/{id}/attachments",
          delete: "/admin/discipline/{id}/delete",
          file: "/admin/discipline/{id}/file/{kind}/{index}",
        },
        students: students.map((s) => ({ _id: String(s._id), name: s.fullName || "", regNo: s.regNo || "", email: s.email || "" })),
        cases: rows.map((c) => ({
          _id: String(c._id), caseNo: c.caseNo || "", student: c.student?._id ? String(c.student._id) : "",
          incidentDate: c.incidentDate ? new Date(c.incidentDate).toISOString().slice(0, 10) : "",
          category: c.category || "", description: c.description || "", status: c.status || "open", note: c.note || "",
          resolutionSummary: c.resolutionSummary || "", studentVisible: !!c.studentVisible, parentVisible: !!c.parentVisible,
          revision: Number(c.revision || 0),
          actions: (c.actions || []).map((a) => ({ action: a.action || "", details: a.details || "", date: a.date || "", visibleToStudent: a.visibleToStudent === true, visibleToParent: a.visibleToParent === true })),
          studentStatement: c.studentStatement ? { url: `/admin/discipline/${c._id}/file/statement/0`, originalName: c.studentStatement.originalName || "" } : null,
          attachments: (c.attachments || []).map((a, i) => ({ url: `/admin/discipline/${c._id}/file/attachment/${i}`, originalName: a.originalName || "" })),
        })),
      };
      const totalPages = Math.max(1, Math.ceil(total / limit));
      return res.render("tenant/discipline/index", {
        tenant: req.tenant || null, cases: rows, students, csrfToken: meta.csrf, cspNonce: res.locals.cspNonce || "", meta,
        kpis: { total: counts.reduce((a, b) => a + b, 0), open: counts[0], investigating: counts[1], hearing: counts[2], resolved: counts[3], dismissed: counts[4] },
        query: { q, status, page, limit, total, totalPages },
        messages: { success: req.flash?.("success") || [], error: req.flash?.("error") || [] },
      });
    } catch (err) {
      console.error("DISCIPLINE INDEX ERROR:", err);
      return res.status(500).send("Failed to load discipline cases.");
    }
  },

  async create(req, res) {
    try {
      const { DisciplineCase, Student } = req.models;
      const student = await loadStudent(Student, safeStr(req.body.student, 80));
      const values = buildCaseValues({ student, input: { ...req.body, status: "open" }, actorId: actorId(req) });
      if (values.studentVisible || values.parentVisible) {
        values.publishedAt = new Date();
        values.publishedBy = actorId(req);
      }
      const row = await createCaseWithRetry(DisciplineCase, values);
      await notify(req, row, student);
      req.flash?.("success", `Discipline case ${row.caseNo} opened.`);
    } catch (err) {
      req.flash?.("error", err.message || "Failed to open discipline case.");
    }
    return res.redirect("/admin/discipline");
  },

  async update(req, res) {
    try {
      const { DisciplineCase, Student } = req.models;
      const row = await currentCase(DisciplineCase, req.params.id);
      const student = await loadStudent(Student, safeStr(req.body.student, 80));
      const values = buildCaseValues({ student, input: req.body, current: row, actorId: actorId(req) });
      if (["resolved", "dismissed"].includes(values.status) && !safeStr(req.body.resolutionSummary || req.body.note, 1200)) {
        throw new Error("Resolution summary is required when closing a discipline case.");
      }
      if ((values.studentVisible || values.parentVisible) && !row.publishedAt) {
        values.publishedAt = new Date();
        values.publishedBy = actorId(req);
      }
      const updated = await guardedSet(DisciplineCase, row, req.body.revision, values);
      await notify(req, updated, student);
      req.flash?.("success", "Discipline case updated.");
    } catch (err) {
      req.flash?.("error", err.message || "Failed to update case.");
    }
    return res.redirect("/admin/discipline");
  },

  async reopen(req, res) {
    try {
      const { DisciplineCase, Student } = req.models;
      const row = await currentCase(DisciplineCase, req.params.id);
      assertTransition(row, "investigating", { reopen: true });
      const student = await loadStudent(Student, row.student);
      const expected = Number(req.body.revision ?? row.revision ?? 0);
      const now = new Date();
      const updated = await guardedSet(DisciplineCase, row, expected, {
        status: "investigating", reopenedAt: now, reopenedBy: actorId(req), resolvedAt: null, resolvedBy: null,
        updatedBy: actorId(req), revision: expected + 1,
      });
      await notify(req, updated, student);
      req.flash?.("success", "Discipline case reopened for investigation.");
    } catch (err) {
      req.flash?.("error", err.message || "Failed to reopen case.");
    }
    return res.redirect("/admin/discipline");
  },

  async addAction(req, res) {
    try {
      const { DisciplineCase, Student } = req.models;
      const row = await currentCase(DisciplineCase, req.params.id);
      if (["resolved", "dismissed"].includes(row.status)) throw new Error("Reopen the case before adding actions.");
      const action = safeStr(req.body.action, 120);
      if (!action) throw new Error("Action is required.");
      const expected = Number(req.body.revision ?? row.revision ?? 0);
      if (expected !== Number(row.revision || 0)) throw new Error("This discipline case changed in another session. Refresh and try again.");
      const update = await DisciplineCase.updateOne(
        { _id: row._id, revision: expected, isDeleted: { $ne: true }, migrationQuarantinedAt: null, status: { $nin: ["resolved", "dismissed"] } },
        {
          $push: { actions: { action, details: safeStr(req.body.details, 800), date: new Date(), by: actorId(req), visibleToStudent: [true, "true", "1", 1].includes(req.body.visibleToStudent), visibleToParent: [true, "true", "1", 1].includes(req.body.visibleToParent) } },
          $set: { updatedBy: actorId(req) }, $inc: { revision: 1 },
        },
        { runValidators: true }
      );
      if (Number(update.modifiedCount || 0) !== 1) throw new Error("This discipline case changed in another session. Refresh and try again.");
      const updated = await DisciplineCase.findById(row._id);
      const student = await loadStudent(Student, updated.student);
      await notify(req, updated, student);
      req.flash?.("success", "Case action recorded.");
    } catch (err) {
      req.flash?.("error", err.message || "Failed to add action.");
    }
    return res.redirect("/admin/discipline");
  },

  async uploadStatement(req, res) {
    let uploaded = null;
    try {
      const { DisciplineCase } = req.models;
      const row = await currentCase(DisciplineCase, req.params.id);
      if (["resolved", "dismissed"].includes(row.status)) throw new Error("Reopen the case before changing evidence.");
      safeEvidenceFile(req.file);
      uploaded = await uploadBuffer(req.file, `classic-academy/${req.tenant?.slug || "tenant"}/discipline/statements`, { resource_type: "auto" });
      const expected = Number(req.body.revision ?? row.revision ?? 0);
      const nextDoc = { url: uploaded.secure_url, publicId: uploaded.public_id, resourceType: uploaded.resource_type || "auto", originalName: req.file.originalname || "", bytes: req.file.size || 0, mimeType: req.file.mimetype || "", uploadedAt: new Date(), uploadedBy: actorId(req) };
      const result = await DisciplineCase.updateOne(
        { _id: row._id, revision: expected, isDeleted: { $ne: true }, migrationQuarantinedAt: null, status: { $nin: ["resolved", "dismissed"] } },
        { $set: { studentStatement: nextDoc, updatedBy: actorId(req) }, $inc: { revision: 1 } },
        { runValidators: true }
      );
      if (Number(result.modifiedCount || 0) !== 1) throw new Error("This discipline case changed in another session. Refresh and try again.");
      if (row.studentStatement?.publicId) await safeDestroy(row.studentStatement.publicId, row.studentStatement.resourceType || "auto");
      req.flash?.("success", "Student statement uploaded.");
    } catch (err) {
      if (uploaded?.public_id) await safeDestroy(uploaded.public_id, uploaded.resource_type || "auto");
      req.flash?.("error", err.message || "Failed to upload statement.");
    }
    return res.redirect("/admin/discipline");
  },

  async uploadAttachments(req, res) {
    const uploaded = [];
    try {
      const { DisciplineCase } = req.models;
      const row = await currentCase(DisciplineCase, req.params.id);
      if (["resolved", "dismissed"].includes(row.status)) throw new Error("Reopen the case before changing evidence.");
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) throw new Error("Choose attachment files.");
      for (const file of files) safeEvidenceFile(file);
      if ((row.attachments || []).length + files.length > 10) throw new Error("A discipline case can contain at most 10 attachments.");
      for (const file of files) {
        const up = await uploadBuffer(file, `classic-academy/${req.tenant?.slug || "tenant"}/discipline/attachments`, { resource_type: "auto" });
        uploaded.push({ url: up.secure_url, publicId: up.public_id, resourceType: up.resource_type || "auto", originalName: file.originalname || "", bytes: file.size || 0, mimeType: file.mimetype || "", uploadedAt: new Date(), uploadedBy: actorId(req) });
      }
      const expected = Number(req.body.revision ?? row.revision ?? 0);
      const result = await DisciplineCase.updateOne(
        { _id: row._id, revision: expected, isDeleted: { $ne: true }, migrationQuarantinedAt: null, status: { $nin: ["resolved", "dismissed"] } },
        { $push: { attachments: { $each: uploaded } }, $set: { updatedBy: actorId(req) }, $inc: { revision: 1 } },
        { runValidators: true }
      );
      if (Number(result.modifiedCount || 0) !== 1) throw new Error("This discipline case changed in another session. Refresh and try again.");
      req.flash?.("success", `Uploaded ${uploaded.length} attachment(s).`);
    } catch (err) {
      for (const doc of uploaded) if (doc.publicId) await safeDestroy(doc.publicId, doc.resourceType || "auto");
      req.flash?.("error", err.message || "Failed to upload attachments.");
    }
    return res.redirect("/admin/discipline");
  },

  async file(req, res) {
    try {
      const { DisciplineCase } = req.models;
      const row = await currentCase(DisciplineCase, req.params.id);
      let doc = null;
      if (req.params.kind === "statement") doc = row.studentStatement;
      else if (req.params.kind === "attachment") doc = (row.attachments || [])[Number(req.params.index || 0)];
      const url = safeStoredUrl(doc?.url);
      if (!url) return res.status(404).send("File not found.");
      return res.redirect(url);
    } catch {
      return res.status(404).send("File not found.");
    }
  },

  async softDelete(req, res) {
    try {
      const { DisciplineCase } = req.models;
      const row = await currentCase(DisciplineCase, req.params.id);
      assertDeleteAllowed(row);
      const expected = Number(req.body.revision ?? row.revision ?? 0);
      const result = await DisciplineCase.updateOne(
        { _id: row._id, revision: expected, isDeleted: { $ne: true }, migrationQuarantinedAt: null },
        { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorId(req), updatedBy: actorId(req) }, $inc: { revision: 1 } }
      );
      if (Number(result.modifiedCount || 0) !== 1) throw new Error("This discipline case changed in another session. Refresh and try again.");
      await retireDisciplineNotifications(req.models, row._id, actorId(req));
      if (row.studentStatement?.publicId) await safeDestroy(row.studentStatement.publicId, row.studentStatement.resourceType || "auto");
      for (const doc of row.attachments || []) if (doc.publicId) await safeDestroy(doc.publicId, doc.resourceType || "auto");
      req.flash?.("success", "Unpublished empty case removed.");
    } catch (err) {
      req.flash?.("error", err.message || "Failed to remove case.");
    }
    return res.redirect("/admin/discipline");
  },

  async exportCsv(req, res) {
    try {
      const { DisciplineCase } = req.models;
      const filter = { isDeleted: { $ne: true }, migrationQuarantinedAt: null };
      if (req.query.status) filter.status = safeStr(req.query.status, 30);
      const rows = await DisciplineCase.find(filter).sort({ incidentDate: -1 }).limit(50000).lean();
      const lines = [["Case No", "Student", "Registration No", "Incident Date", "Category", "Status", "Student Visible", "Parent Visible", "Resolution"].map(csvCell).join(",")];
      for (const row of rows) lines.push([
        row.caseNo, row.studentName, row.studentRegNo, row.incidentDate ? new Date(row.incidentDate).toISOString().slice(0, 10) : "",
        row.category, row.status, row.studentVisible ? "Yes" : "No", row.parentVisible ? "Yes" : "No", row.resolutionSummary,
      ].map(csvCell).join(","));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="discipline-cases.csv"');
      return res.send(lines.join("\r\n"));
    } catch {
      return res.status(500).send("Failed to export discipline cases.");
    }
  },
};

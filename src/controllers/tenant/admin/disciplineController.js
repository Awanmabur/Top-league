const mongoose = require("mongoose");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");

function safeStr(v) {
  return String(v == null ? "" : v).trim();
}

function toInt(v, def) {
  const n = parseInt(String(v || ""), 10);
  return Number.isFinite(n) ? n : def;
}

function isOid(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

async function softDeleteDoc(doc, userId) {
  if (typeof doc.softDelete === "function") return doc.softDelete();
  doc.isDeleted = true;
  doc.deletedAt = new Date();
  doc.deletedBy = userId || null;
  return doc.save();
}

async function nextCaseNo(DisciplineCase) {
  const last = await DisciplineCase.find({ isDeleted: { $ne: true } })
    .sort({ caseNo: -1 })
    .select("caseNo")
    .limit(1)
    .lean();

  const prev = last[0]?.caseNo ? String(last[0].caseNo) : "DC-000000";
  const num = parseInt(prev.replace(/\D/g, ""), 10) || 0;
  return "DC-" + String(num + 1).padStart(6, "0");
}

module.exports = {
  async index(req, res) {
    try {
      const { DisciplineCase, Student } = req.models;

      const q = safeStr(req.query.q);
      const status = safeStr(req.query.status);

      const page = Math.max(1, toInt(req.query.page, 1));
      const limit = Math.min(50, Math.max(10, toInt(req.query.limit, 20)));
      const skip = (page - 1) * limit;

      const filter = { isDeleted: { $ne: true } };
      if (status) filter.status = status;

      if (q) {
        const sIds = await Student.find({
          isDeleted: { $ne: true },
          $or: [
            { regNo: new RegExp(q, "i") },
            { fullName: new RegExp(q, "i") },
            { email: new RegExp(q, "i") },
          ],
        })
          .select("_id")
          .limit(500)
          .lean();

        filter.$or = [
          { caseNo: new RegExp(q, "i") },
          { category: new RegExp(q, "i") },
          { description: new RegExp(q, "i") },
          { student: { $in: sIds.map((x) => x._id) } },
        ];
      }

      const [total, rows, students, counts] = await Promise.all([
        DisciplineCase.countDocuments(filter),
        DisciplineCase.find(filter)
          .populate("student", "regNo fullName email")
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Student.find({ isDeleted: { $ne: true } })
          .select("_id regNo fullName email")
          .sort({ regNo: 1, fullName: 1 })
          .limit(1500)
          .lean(),
        Promise.all([
          DisciplineCase.countDocuments({ isDeleted: { $ne: true } }),
          DisciplineCase.countDocuments({ isDeleted: { $ne: true }, status: "open" }),
          DisciplineCase.countDocuments({ isDeleted: { $ne: true }, status: "investigating" }),
          DisciplineCase.countDocuments({ isDeleted: { $ne: true }, status: "hearing" }),
          DisciplineCase.countDocuments({ isDeleted: { $ne: true }, status: "resolved" }),
          DisciplineCase.countDocuments({ isDeleted: { $ne: true }, status: "dismissed" }),
        ]),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / limit));

      const meta = {
        csrf: res.locals.csrfToken || (typeof req.csrfToken === "function" ? req.csrfToken() : ""),
        routes: {
          create: "/admin/discipline",
          update: "/admin/discipline/{id}",
          addAction: "/admin/discipline/{id}/action",
          statement: "/admin/discipline/{id}/statement",
          attachments: "/admin/discipline/{id}/attachments",
          delete: "/admin/discipline/{id}/delete",
        },
        students: students.map((s) => ({
          _id: String(s._id),
          name: s.fullName || "",
          regNo: s.regNo || "",
          email: s.email || "",
        })),
        cases: rows.map((c) => ({
          _id: String(c._id),
          caseNo: c.caseNo || "",
          student: c.student?._id ? String(c.student._id) : "",
          incidentDate: c.incidentDate ? new Date(c.incidentDate).toISOString().slice(0, 10) : "",
          category: c.category || "",
          description: c.description || "",
          status: c.status || "open",
          note: c.note || "",
          actions: Array.isArray(c.actions)
            ? c.actions.map((a) => ({
                action: a.action || "",
                details: a.details || "",
                date: a.date || "",
              }))
            : [],
          studentStatement:
            c.studentStatement && c.studentStatement.url
              ? {
                  url: c.studentStatement.url,
                  originalName: c.studentStatement.originalName || "",
                }
              : null,
          attachments: Array.isArray(c.attachments)
            ? c.attachments.map((a) => ({
                url: a.url || "",
                originalName: a.originalName || "",
              }))
            : [],
        })),
      };

      return res.render("tenant/admin/discipline/index", {
        tenant: req.tenant || null,
        cases: rows,
        students,
        csrfToken: meta.csrf,
        cspNonce: res.locals.cspNonce || "",
        meta,
        kpis: {
          total: counts[0],
          open: counts[1],
          investigating: counts[2],
          hearing: counts[3],
          resolved: counts[4],
          dismissed: counts[5],
        },
        query: {
          q,
          status,
          page,
          limit,
          total,
          totalPages,
        },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("DISCIPLINE INDEX ERROR:", err);
      req.flash?.("error", "Failed to load discipline cases.");
      return res.redirect("/admin");
    }
  },

  async create(req, res) {
    try {
      const { DisciplineCase, Student } = req.models;

      const student = safeStr(req.body.student);
      const incidentDate = safeStr(req.body.incidentDate);
      const category = safeStr(req.body.category);
      const description = safeStr(req.body.description);
      const status = safeStr(req.body.status) || "open";
      const note = safeStr(req.body.note);

      if (!isOid(student) || !incidentDate || !category || !description) {
        req.flash?.("error", "Student, Incident Date, Category, and Description are required.");
        return res.redirect("/admin/discipline");
      }

      const stu = await Student.findOne({ _id: student, isDeleted: { $ne: true } })
        .select("_id")
        .lean();

      if (!stu) {
        req.flash?.("error", "Student not found.");
        return res.redirect("/admin/discipline");
      }

      const caseNo = await nextCaseNo(DisciplineCase);

      await DisciplineCase.create({
        caseNo,
        student,
        incidentDate: new Date(incidentDate),
        category,
        description,
        status,
        note,
        createdBy: req.user ? req.user._id : null,
      });

      req.flash?.("success", "Discipline case opened.");
      return res.redirect("/admin/discipline");
    } catch (err) {
      console.error("DISCIPLINE CREATE ERROR:", err);
      req.flash?.("error", "Failed to open discipline case.");
      return res.redirect("/admin/discipline");
    }
  },

  async update(req, res) {
    try {
      const { DisciplineCase, Student } = req.models;
      const id = req.params.id;

      if (!isOid(id)) {
        req.flash?.("error", "Invalid case.");
        return res.redirect("/admin/discipline");
      }

      const row = await DisciplineCase.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!row) {
        req.flash?.("error", "Case not found.");
        return res.redirect("/admin/discipline");
      }

      const student = safeStr(req.body.student);
      const incidentDate = safeStr(req.body.incidentDate);
      const category = safeStr(req.body.category);
      const description = safeStr(req.body.description);
      const status = safeStr(req.body.status);
      const note = safeStr(req.body.note);

      if (!student || !incidentDate || !category || !description) {
        req.flash?.("error", "Student, Incident Date, Category, and Description are required.");
        return res.redirect("/admin/discipline");
      }

      if (!isOid(student)) {
        req.flash?.("error", "Invalid student.");
        return res.redirect("/admin/discipline");
      }

      const stu = await Student.findOne({ _id: student, isDeleted: { $ne: true } })
        .select("_id")
        .lean();

      if (!stu) {
        req.flash?.("error", "Student not found.");
        return res.redirect("/admin/discipline");
      }

      row.student = student;
      row.incidentDate = new Date(incidentDate);
      row.category = category;
      row.description = description;
      row.status = status || row.status || "open";
      row.note = note;
      row.updatedBy = req.user ? req.user._id : null;

      await row.save();

      req.flash?.("success", "Case updated.");
      return res.redirect("/admin/discipline");
    } catch (err) {
      console.error("DISCIPLINE UPDATE ERROR:", err);
      req.flash?.("error", "Failed to update case.");
      return res.redirect("/admin/discipline");
    }
  },

  async addAction(req, res) {
    try {
      const { DisciplineCase } = req.models;
      const id = req.params.id;

      if (!isOid(id)) {
        req.flash?.("error", "Invalid case.");
        return res.redirect("/admin/discipline");
      }

      const row = await DisciplineCase.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!row) {
        req.flash?.("error", "Case not found.");
        return res.redirect("/admin/discipline");
      }

      const action = safeStr(req.body.action);
      const details = safeStr(req.body.details);

      if (!action) {
        req.flash?.("error", "Action is required.");
        return res.redirect("/admin/discipline");
      }

      row.actions.push({
        action,
        details,
        date: new Date(),
        by: req.user ? req.user._id : null,
      });

      row.updatedBy = req.user ? req.user._id : null;
      await row.save();

      req.flash?.("success", "Action added.");
      return res.redirect("/admin/discipline");
    } catch (err) {
      console.error("DISCIPLINE ADD ACTION ERROR:", err);
      req.flash?.("error", "Failed to add action.");
      return res.redirect("/admin/discipline");
    }
  },

  async uploadStatement(req, res) {
    try {
      const { DisciplineCase } = req.models;
      const id = req.params.id;

      if (!isOid(id)) {
        req.flash?.("error", "Invalid case.");
        return res.redirect("/admin/discipline");
      }

      const row = await DisciplineCase.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!row) {
        req.flash?.("error", "Case not found.");
        return res.redirect("/admin/discipline");
      }

      if (!req.file?.buffer) {
        req.flash?.("error", "Choose a statement file.");
        return res.redirect("/admin/discipline");
      }

      const folder = `classic-campus/${req.tenant?.slug || "tenant"}/discipline/statements`;
      const up = await uploadBuffer(req.file, folder);

      if (row.studentStatement?.publicId) {
        await safeDestroy(row.studentStatement.publicId, row.studentStatement.resourceType || "auto");
      }

      row.studentStatement = {
        url: up.secure_url,
        publicId: up.public_id,
        resourceType: up.resource_type || "auto",
        originalName: req.file.originalname || "",
        bytes: req.file.size || 0,
        mimeType: req.file.mimetype || "",
        uploadedAt: new Date(),
      };

      row.updatedBy = req.user ? req.user._id : null;
      await row.save();

      req.flash?.("success", "Student statement uploaded.");
      return res.redirect("/admin/discipline");
    } catch (err) {
      console.error("DISCIPLINE STATEMENT UPLOAD ERROR:", err);
      req.flash?.("error", "Failed to upload statement.");
      return res.redirect("/admin/discipline");
    }
  },

  async uploadAttachments(req, res) {
    try {
      const { DisciplineCase } = req.models;
      const id = req.params.id;

      if (!isOid(id)) {
        req.flash?.("error", "Invalid case.");
        return res.redirect("/admin/discipline");
      }

      const row = await DisciplineCase.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!row) {
        req.flash?.("error", "Case not found.");
        return res.redirect("/admin/discipline");
      }

      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) {
        req.flash?.("error", "Choose attachment file(s).");
        return res.redirect("/admin/discipline");
      }

      const folder = `classic-campus/${req.tenant?.slug || "tenant"}/discipline/attachments`;

      for (const f of files) {
        if (!f?.buffer) continue;
        const up = await uploadBuffer(f, folder);
        row.attachments.push({
          url: up.secure_url,
          publicId: up.public_id,
          resourceType: up.resource_type || "auto",
          originalName: f.originalname || "",
          bytes: f.size || 0,
          mimeType: f.mimetype || "",
          uploadedAt: new Date(),
        });
      }

      row.updatedBy = req.user ? req.user._id : null;
      await row.save();

      req.flash?.("success", "Attachment(s) uploaded.");
      return res.redirect("/admin/discipline");
    } catch (err) {
      console.error("DISCIPLINE ATTACHMENTS UPLOAD ERROR:", err);
      req.flash?.("error", "Failed to upload attachments.");
      return res.redirect("/admin/discipline");
    }
  },

  async softDelete(req, res) {
    try {
      const { DisciplineCase } = req.models;
      const id = req.params.id;

      if (!isOid(id)) {
        req.flash?.("error", "Invalid case.");
        return res.redirect("/admin/discipline");
      }

      const row = await DisciplineCase.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!row) {
        req.flash?.("error", "Case not found.");
        return res.redirect("/admin/discipline");
      }

      if (row.studentStatement?.publicId) {
        await safeDestroy(row.studentStatement.publicId, row.studentStatement.resourceType || "auto");
      }

      if (Array.isArray(row.attachments)) {
        for (const d of row.attachments) {
          if (d?.publicId) {
            await safeDestroy(d.publicId, d.resourceType || "auto");
          }
        }
      }

      await softDeleteDoc(row, req.user ? req.user._id : null);

      req.flash?.("success", "Case deleted.");
      return res.redirect("/admin/discipline");
    } catch (err) {
      console.error("DISCIPLINE DELETE ERROR:", err);
      req.flash?.("error", "Failed to delete case.");
      return res.redirect("/admin/discipline");
    }
  },
};
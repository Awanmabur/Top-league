const mongoose = require("mongoose");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");
const {
  REQUIRED_STUDENT_DOC_TYPES,
  normalizeStudentDocType,
  titleForStudentDocType,
  ensureStudentDocsFromApplicants,
  buildStudentDocSummaries,
} = require("../../../utils/studentDocs");

function safeStr(v) {
  return String(v == null ? "" : v).trim();
}

function isOid(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeType(type) {
  return normalizeStudentDocType(type);
}

async function softDeleteDoc(doc, userId) {
  if (typeof doc.softDelete === "function") return doc.softDelete();
  doc.isDeleted = true;
  doc.deletedAt = new Date();
  doc.deletedBy = userId || null;
  return doc.save();
}

module.exports = {
  async index(req, res) {
    try {
      const { StudentDoc, Student, Applicant } = req.models;

      const q = safeStr(req.query.q);
      const type = normalizeType(req.query.type || "");
      const student = safeStr(req.query.student);

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = { isDeleted: { $ne: true } };

      if (req.query.type) {
        filter.type = type;
      }

      if (student && isOid(student)) {
        filter.student = student;
      }

      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");

        const matchedStudents = await Student.find({
          isDeleted: { $ne: true },
          $or: [
            { regNo: rx },
            { fullName: rx },
            { email: rx },
            { phone: rx },
          ],
        })
          .select("_id")
          .limit(1000)
          .lean();

        const studentIds = matchedStudents.map((x) => x._id);

        filter.$or = [
          { title: rx },
          ...(studentIds.length ? [{ student: { $in: studentIds } }] : []),
        ];
      }

      const students = await Student.find({ isDeleted: { $ne: true } })
        .select("_id regNo fullName email")
        .sort({ regNo: 1, fullName: 1 })
        .limit(2000)
        .lean();

      const studentIds = students.map((st) => st._id);
      if (studentIds.length) {
        await ensureStudentDocsFromApplicants({
          StudentDoc,
          Applicant,
          studentIds,
          uploadedBy: req.user?._id || null,
        }).catch((err) => {
          console.error("STUDENT DOC BACKFILL ERROR:", err);
        });
      }

      const total = await StudentDoc.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const docs = await StudentDoc.find(filter)
        .populate({
          path: "student",
          select: "regNo fullName email",
          model: Student,
        })
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const allStudentDocs = studentIds.length
        ? await StudentDoc.find({ isDeleted: { $ne: true }, student: { $in: studentIds } })
            .select("_id student type title doc createdAt updatedAt")
            .sort({ createdAt: -1 })
            .lean()
        : [];
      const studentDocSummaries = buildStudentDocSummaries(students, allStudentDocs);

      const missingRequired = studentDocSummaries.reduce((sum, row) => sum + Number(row.missingCount || 0), 0);
      const completeStudents = studentDocSummaries.filter((row) => row.complete).length;
      const baseKpiFilter = { isDeleted: { $ne: true } };

      const kpis = {
        students: await Student.countDocuments({ isDeleted: { $ne: true } }),
        uploaded: await StudentDoc.countDocuments(baseKpiFilter),
        missingRequired,
        completeStudents,
        incompleteStudents: Math.max(studentDocSummaries.length - completeStudents, 0),
        total,
        passport: await StudentDoc.countDocuments({ ...baseKpiFilter, type: "passport" }),
        transcript: await StudentDoc.countDocuments({ ...baseKpiFilter, type: "transcript" }),
        certificate: await StudentDoc.countDocuments({ ...baseKpiFilter, type: "certificate" }),
      };

      return res.render("tenant/admin/student-docs/index", {
        tenant: req.tenant || null,
        docs: docs.map((row) => ({
          ...row,
          type: normalizeStudentDocType(row.type, row.title),
          title: safeStr(row.title) || titleForStudentDocType(row.type),
        })),
        students,
        studentDocSummaries,
        requiredTypes: REQUIRED_STUDENT_DOC_TYPES,
        types: ["passport", "id", "transcript", "certificate", "other"],
        csrfToken: typeof req.csrfToken === "function" ? req.csrfToken() : "",
        kpis,
        query: {
          q,
          type: req.query.type ? type : "",
          student,
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
      console.error("STUDENT DOCS INDEX ERROR:", err);
      return res.status(500).send("Failed to load student documents.");
    }
  },

  async create(req, res) {
    try {
      const { StudentDoc, Student } = req.models;

      const student = safeStr(req.body.student);
      const type = normalizeType(req.body.type);
      const title = (safeStr(req.body.title) || titleForStudentDocType(type)).slice(0, 180);

      if (!isOid(student)) {
        req.flash?.("error", "Student is required.");
        return res.redirect("/admin/student-docs");
      }

      const stu = await Student.findOne({ _id: student, isDeleted: { $ne: true } })
        .select("_id")
        .lean();

      if (!stu) {
        req.flash?.("error", "Student not found.");
        return res.redirect("/admin/student-docs");
      }

      if (!req.file?.buffer) {
        req.flash?.("error", "Choose a file to upload.");
        return res.redirect("/admin/student-docs");
      }

      const folder = `classic-academy/${req.tenant?.slug || "tenant"}/student-docs`;
      const up = await uploadBuffer(req.file, folder);

      await StudentDoc.create({
        student,
        type,
        title,
        doc: {
          url: up.secure_url,
          publicId: up.public_id,
          resourceType: up.resource_type || "auto",
          originalName: req.file.originalname || "",
          bytes: req.file.size || 0,
          mimeType: req.file.mimetype || "",
          source: "admin_upload",
          sharedAsset: false,
          uploadedAt: new Date(),
        },
        uploadedBy: req.user?._id || null,
      });

      req.flash?.("success", "Document uploaded.");
      return res.redirect("/admin/student-docs?student=" + encodeURIComponent(student));
    } catch (err) {
      console.error("CREATE STUDENT DOC ERROR:", err);
      req.flash?.("error", "Failed to upload document.");
      return res.redirect("/admin/student-docs");
    }
  },

  async update(req, res) {
    try {
      const { StudentDoc, Student } = req.models;

      const id = safeStr(req.params.id);
      if (!isOid(id)) {
        req.flash?.("error", "Invalid document.");
        return res.redirect("/admin/student-docs");
      }

      const row = await StudentDoc.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!row) {
        req.flash?.("error", "Document not found.");
        return res.redirect("/admin/student-docs");
      }

      const student = safeStr(req.body.student);
      const type = normalizeType(req.body.type || row.type);
      const title = (safeStr(req.body.title) || titleForStudentDocType(type)).slice(0, 180);

      if (!student || !isOid(student)) {
        req.flash?.("error", "Valid student is required.");
        return res.redirect("/admin/student-docs");
      }

      const stu = await Student.findOne({ _id: student, isDeleted: { $ne: true } })
        .select("_id")
        .lean();

      if (!stu) {
        req.flash?.("error", "Student not found.");
        return res.redirect("/admin/student-docs");
      }

      row.student = student;
      row.type = type;
      row.title = title;

      if (req.file?.buffer) {
        const folder = `classic-academy/${req.tenant?.slug || "tenant"}/student-docs`;
        const up = await uploadBuffer(req.file, folder);

        if (row.doc?.publicId && !row.doc?.sharedAsset) {
          await safeDestroy(row.doc.publicId, row.doc.resourceType || "auto");
        }

        row.doc = {
          url: up.secure_url,
          publicId: up.public_id,
          resourceType: up.resource_type || "auto",
          originalName: req.file.originalname || "",
          bytes: req.file.size || 0,
          mimeType: req.file.mimetype || "",
          source: "admin_upload",
          sharedAsset: false,
          uploadedAt: new Date(),
        };
      }

      row.updatedBy = req.user?._id || null;
      await row.save();

      req.flash?.("success", "Document updated.");
      return res.redirect("/admin/student-docs?student=" + encodeURIComponent(String(row.student)));
    } catch (err) {
      console.error("UPDATE STUDENT DOC ERROR:", err);
      req.flash?.("error", "Failed to update document.");
      return res.redirect("/admin/student-docs");
    }
  },

  async softDelete(req, res) {
    try {
      const { StudentDoc } = req.models;

      const id = safeStr(req.params.id);
      if (!isOid(id)) {
        req.flash?.("error", "Invalid document.");
        return res.redirect("/admin/student-docs");
      }

      const row = await StudentDoc.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!row) {
        req.flash?.("error", "Document not found.");
        return res.redirect("/admin/student-docs");
      }

      if (row.doc?.publicId && !row.doc?.sharedAsset) {
        await safeDestroy(row.doc.publicId, row.doc.resourceType || "auto");
      }

      await softDeleteDoc(row, req.user?._id || null);

      req.flash?.("success", "Document removed.");
      return res.redirect("/admin/student-docs");
    } catch (err) {
      console.error("DELETE STUDENT DOC ERROR:", err);
      req.flash?.("error", "Failed to remove document.");
      return res.redirect("/admin/student-docs");
    }
  },
};

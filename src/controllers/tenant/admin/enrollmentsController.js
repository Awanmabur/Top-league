const mongoose = require("mongoose");

function safeStr(v, max = 500) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

function toInt(v, def) {
  const n = parseInt(String(v || ""), 10);
  return Number.isFinite(n) ? n : def;
}

function isOid(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function normalizeStatus(v) {
  const s = safeStr(v, 30).toLowerCase();
  return ["enrolled", "deferred", "withdrawn", "completed"].includes(s) ? s : null;
}

function cleanCsvCell(v) {
  return String(v == null ? "" : v).replace(/\r/g, " ").replace(/\n/g, " ").trim();
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map((x) => String(x || "").trim());
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((x) => x.trim());

  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
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
      const { Enrollment, Student, Subject, Class } = req.models;

      const q = safeStr(req.query.q, 120);
      const academicYear = safeStr(req.query.academicYear, 40);
      const semester = toInt(req.query.semester, 0);
      const status = safeStr(req.query.status, 30);
      const program = safeStr(req.query.program, 60);
      const classGroup = safeStr(req.query.classGroup, 60);

      const page = Math.max(1, toInt(req.query.page, 1));
      const perPage = 10;
      const skip = (page - 1) * perPage;

      const filter = { isDeleted: { $ne: true } };

      if (academicYear) filter.academicYear = academicYear;
      if (semester > 0) filter.semester = semester;
      if (normalizeStatus(status)) filter.status = status;
      if (program && isOid(program)) filter.program = program;
      if (classGroup && isOid(classGroup)) filter.classGroup = classGroup;

      if (q) {
        const studentIds = await Student.find({
          isDeleted: { $ne: true },
          $or: [
            { regNo: { $regex: q, $options: "i" } },
            { fullName: { $regex: q, $options: "i" } },
            { email: { $regex: q, $options: "i" } },
            { phone: { $regex: q, $options: "i" } },
          ],
        })
          .select("_id")
          .limit(1000)
          .lean();

        filter.student = { $in: studentIds.map((x) => x._id) };
      }

      const total = await Enrollment.countDocuments(filter);
      const totalPages = Math.max(1, Math.ceil(total / perPage));
      const safePage = Math.min(page, totalPages);

      const rows = await Enrollment.find(filter)
        .populate({ path: "student", select: "fullName regNo email phone" })
        .populate({ path: "program", select: "name title code" })
        .populate({ path: "classGroup", select: "name title code" })
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const [programs, classes, students] = await Promise.all([
        Subject.find({ status: { $ne: "archived" } })
          .select("title shortTitle name code")
          .sort({ code: 1, title: 1 })
          .limit(1000)
          .lean(),

        Class.find({ isDeleted: { $ne: true } })
          .select("name title code")
          .sort({ code: 1, name: 1 })
          .limit(1000)
          .lean(),

        Student.find({ isDeleted: { $ne: true } })
          .select("_id regNo fullName email")
          .sort({ regNo: 1, fullName: 1 })
          .limit(2000)
          .lean(),
      ]);

      const [enrolledCount, deferredCount, withdrawnCount, completedCount] = await Promise.all([
        Enrollment.countDocuments({ ...filter, status: "enrolled" }),
        Enrollment.countDocuments({ ...filter, status: "deferred" }),
        Enrollment.countDocuments({ ...filter, status: "withdrawn" }),
        Enrollment.countDocuments({ ...filter, status: "completed" }),
      ]);

      return res.render("tenant/admin/enrollments/index", {
        tenant: req.tenant || null,
        enrollments: rows,
        programs,
        classes,
        students,
        csrfToken: res.locals.csrfToken || (typeof req.csrfToken === "function" ? req.csrfToken() : ""),
        cspNonce: res.locals.cspNonce || "",
        kpis: {
          total,
          enrolled: enrolledCount,
          deferred: deferredCount,
          withdrawn: withdrawnCount,
          completed: completedCount,
        },
        query: {
          q,
          academicYear,
          semester: semester || "",
          status,
          program,
          classGroup,
          page: safePage,
          perPage,
          totalPages,
          total,
        },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("ENROLLMENTS INDEX ERROR:", err);
      return res.status(500).send("Failed to load enrollments.");
    }
  },

  async create(req, res) {
    try {
      const { Enrollment, Student } = req.models;

      const student = safeStr(req.body.student, 80);
      const academicYear = safeStr(req.body.academicYear, 40);
      const semester = Math.max(1, Math.min(toInt(req.body.semester, 1), 3));
      const program = safeStr(req.body.program, 80);
      const classGroup = safeStr(req.body.classGroup, 80);
      const intake = safeStr(req.body.intake, 80);
      const status = normalizeStatus(req.body.status) || "enrolled";
      const note = safeStr(req.body.note, 1200);

      if (!isOid(student) || !academicYear || !isOid(program) || !isOid(classGroup)) {
        req.flash?.("error", "Student, Academic Year, Subject and Class are required.");
        return res.redirect("/admin/enrollments");
      }

      const stu = await Student.findOne({ _id: student, isDeleted: { $ne: true } }).select("_id").lean();
      if (!stu) {
        req.flash?.("error", "Student not found.");
        return res.redirect("/admin/enrollments");
      }

      const exists = await Enrollment.findOne({
        isDeleted: { $ne: true },
        student,
        academicYear,
        semester,
      }).lean();

      if (exists) {
        req.flash?.("error", "This student is already enrolled for that academic year and semester.");
        return res.redirect("/admin/enrollments");
      }

      await Enrollment.create({
        student,
        academicYear,
        semester,
        program,
        classGroup,
        intake,
        status,
        note,
        createdBy: req.user ? req.user._id : null,
      });

      await Student.updateOne(
        { _id: student, isDeleted: { $ne: true } },
        {
          $set: {
            academicYear,
            semester,
            program,
            classGroup,
            updatedBy: req.user ? req.user._id : null,
          },
        }
      );

      req.flash?.("success", "Enrollment created.");
      return res.redirect("/admin/enrollments");
    } catch (err) {
      console.error("ENROLLMENT CREATE ERROR:", err);
      req.flash?.("error", "Failed to create enrollment.");
      return res.redirect("/admin/enrollments");
    }
  },

  async update(req, res) {
    try {
      const { Enrollment, Student } = req.models;
      const id = safeStr(req.params.id, 80);

      if (!isOid(id)) {
        req.flash?.("error", "Invalid enrollment.");
        return res.redirect("/admin/enrollments");
      }

      const row = await Enrollment.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!row) {
        req.flash?.("error", "Enrollment not found.");
        return res.redirect("/admin/enrollments");
      }

      const student = safeStr(req.body.student, 80);
      const academicYear = safeStr(req.body.academicYear, 40);
      const semester = Math.max(1, Math.min(toInt(req.body.semester, row.semester || 1), 3));
      const program = safeStr(req.body.program, 80);
      const classGroup = safeStr(req.body.classGroup, 80);
      const intake = safeStr(req.body.intake, 80);
      const status = normalizeStatus(req.body.status) || row.status || "enrolled";
      const note = safeStr(req.body.note, 1200);

      if (!isOid(student) || !academicYear || !isOid(program) || !isOid(classGroup)) {
        req.flash?.("error", "Student, Academic Year, Subject and Class are required.");
        return res.redirect("/admin/enrollments");
      }

      const stu = await Student.findOne({ _id: student, isDeleted: { $ne: true } }).select("_id").lean();
      if (!stu) {
        req.flash?.("error", "Student not found.");
        return res.redirect("/admin/enrollments");
      }

      const collision = await Enrollment.findOne({
        _id: { $ne: id },
        isDeleted: { $ne: true },
        student,
        academicYear,
        semester,
      }).lean();

      if (collision) {
        req.flash?.("error", "Another enrollment already exists for that student, year and semester.");
        return res.redirect("/admin/enrollments");
      }

      row.student = student;
      row.academicYear = academicYear;
      row.semester = semester;
      row.program = program;
      row.classGroup = classGroup;
      row.intake = intake;
      row.status = status;
      row.note = note;
      row.updatedBy = req.user ? req.user._id : null;

      await row.save();

      await Student.updateOne(
        { _id: row.student, isDeleted: { $ne: true } },
        {
          $set: {
            academicYear: row.academicYear,
            semester: row.semester,
            program: row.program,
            classGroup: row.classGroup,
            updatedBy: req.user ? req.user._id : null,
          },
        }
      );

      req.flash?.("success", "Enrollment updated.");
      return res.redirect("/admin/enrollments");
    } catch (err) {
      console.error("ENROLLMENT UPDATE ERROR:", err);
      req.flash?.("error", "Failed to update enrollment.");
      return res.redirect("/admin/enrollments");
    }
  },

  async softDelete(req, res) {
    try {
      const { Enrollment } = req.models;
      const id = safeStr(req.params.id, 80);

      if (!isOid(id)) {
        req.flash?.("error", "Invalid enrollment.");
        return res.redirect("/admin/enrollments");
      }

      const row = await Enrollment.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!row) {
        req.flash?.("error", "Enrollment not found.");
        return res.redirect("/admin/enrollments");
      }

      await softDeleteDoc(row, req.user ? req.user._id : null);
      req.flash?.("success", "Enrollment deleted.");
      return res.redirect("/admin/enrollments");
    } catch (err) {
      console.error("ENROLLMENT DELETE ERROR:", err);
      req.flash?.("error", "Failed to delete enrollment.");
      return res.redirect("/admin/enrollments");
    }
  },

  async bulk(req, res) {
    try {
      const { Enrollment } = req.models;

      const action = safeStr(req.body.action, 40);
      const ids = safeStr(req.body.ids, 20000)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter(isOid);

      if (!ids.length) {
        req.flash?.("error", "Select at least one enrollment.");
        return res.redirect("/admin/enrollments");
      }

      if (action === "set_status") {
        const status = normalizeStatus(req.body.status);
        if (!status) {
          req.flash?.("error", "Choose a valid status.");
          return res.redirect("/admin/enrollments");
        }

        await Enrollment.updateMany(
          { _id: { $in: ids }, isDeleted: { $ne: true } },
          { $set: { status, updatedBy: req.user ? req.user._id : null } }
        );

        req.flash?.("success", "Bulk status updated.");
        return res.redirect("/admin/enrollments");
      }

      req.flash?.("error", "Invalid bulk action.");
      return res.redirect("/admin/enrollments");
    } catch (err) {
      console.error("ENROLLMENT BULK ERROR:", err);
      req.flash?.("error", "Bulk update failed.");
      return res.redirect("/admin/enrollments");
    }
  },

  async exportCsv(req, res) {
    try {
      const { Enrollment } = req.models;

      const rows = await Enrollment.find({ isDeleted: { $ne: true } })
        .populate({ path: "student", select: "fullName regNo email" })
        .populate({ path: "program", select: "name title code" })
        .populate({ path: "classGroup", select: "name title code" })
        .sort({ createdAt: -1 })
        .lean();

      const csvRows = [
        [
          "Student",
          "RegNo",
          "Email",
          "AcademicYear",
          "Semester",
          "Subject",
          "Class",
          "Intake",
          "Status",
          "Note",
          "CreatedAt",
        ],
        ...rows.map((e) => [
          cleanCsvCell(e.student?.fullName || ""),
          cleanCsvCell(e.student?.regNo || ""),
          cleanCsvCell(e.student?.email || ""),
          cleanCsvCell(e.academicYear || ""),
          cleanCsvCell(e.semester || ""),
          cleanCsvCell(e.program?.code || e.program?.name || e.program?.title || ""),
          cleanCsvCell(e.classGroup?.code || e.classGroup?.name || e.classGroup?.title || ""),
          cleanCsvCell(e.intake || ""),
          cleanCsvCell(e.status || ""),
          cleanCsvCell(e.note || ""),
          cleanCsvCell(e.createdAt || ""),
        ]),
      ];

      const esc = (value) => {
        const s = String(value ?? "");
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const csv = csvRows.map((row) => row.map(esc).join(",")).join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="enrollments-export.csv"');
      return res.send(csv);
    } catch (err) {
      console.error("ENROLLMENT EXPORT ERROR:", err);
      req.flash?.("error", "Failed to export enrollments.");
      return res.redirect("/admin/enrollments");
    }
  },
};

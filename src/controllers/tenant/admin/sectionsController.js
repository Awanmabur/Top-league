const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const { getSchoolUnits } = require("../../../utils/academicStructure");

const STATUSES = ["active", "inactive", "archived"];

function slugCode(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function buildStructure(req) {
  return (getSchoolUnits(req) || []).map((schoolUnit) => ({
    id: String(schoolUnit.id || schoolUnit._id || ""),
    name: schoolUnit.name || "",
    code: schoolUnit.code || "",
    campuses: (schoolUnit.campuses || []).map((campus) => ({
      id: String(campus.id || campus._id || ""),
      name: campus.name || "",
      code: campus.code || "",
      levels: (campus.levels || []).map((level) => ({
        id: String(level.id || level._id || ""),
        name: level.name || "",
        type: level.type || "",
        code: level.code || "",
      })),
    })),
  }));
}

function sameId(a, b) {
  return String(a || "") === String(b || "");
}

function buildSmartCode(body, klass, stream) {
  const campusCode = slugCode(klass?.campusCode || klass?.campusName || "CAMPUS");
  const classLevel = slugCode(klass?.classLevel || "CLASS");
  const classStream = slugCode(stream?.name || klass?.streamName || klass?.stream || "A");
  const section = slugCode(body.name || "SECTION");
  return slugCode(`${campusCode}-${classLevel}-${classStream}-${section}`);
}

const sectionRules = [
  body("name").trim().isLength({ min: 1, max: 100 }).withMessage("Section/stream name is required."),
  body("code").optional({ checkFalsy: true }).trim().isLength({ min: 1, max: 40 }).withMessage("Code must be 1-40 chars."),
  body("classId").trim().custom((v) => mongoose.Types.ObjectId.isValid(v)).withMessage("Valid class is required."),
  body("streamId").optional({ checkFalsy: true }).custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Invalid stream."),
  body("classTeacher").optional({ checkFalsy: true }).custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Invalid teacher."),
  body("status").optional({ checkFalsy: true }).isIn(STATUSES).withMessage("Invalid status."),
  body("capacity").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("enrolledCount").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("room").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
];

module.exports = {
  sectionRules,

  list: async (req, res) => {
    try {
      const { Section, Staff, Class, Stream } = req.models;

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();
      const levelType = String(req.query.levelType || "").trim();
      const classId = String(req.query.classId || "").trim();
      const streamId = String(req.query.streamId || "").trim();
      const schoolUnitId = String(req.query.schoolUnitId || "").trim();
      const campusId = String(req.query.campusId || "").trim();

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};
      if (q) {
        const rx = require("../../../services/tenant/academicCatalogService").escapeRegExp(q);
        filter.$or = [
          { name: { $regex: rx, $options: "i" } },
          { code: { $regex: rx, $options: "i" } },
          { className: { $regex: rx, $options: "i" } },
          { classLevel: { $regex: rx, $options: "i" } },
          { classStream: { $regex: rx, $options: "i" } },
          { streamName: { $regex: rx, $options: "i" } },
          { streamCode: { $regex: rx, $options: "i" } },
          { room: { $regex: rx, $options: "i" } },
          { notes: { $regex: rx, $options: "i" } },
        ];
      }

      if (status) filter.status = status;
      if (levelType) filter.levelType = levelType;
      if (classId) filter.classId = classId;
      if (streamId) filter.streamId = streamId;
      if (schoolUnitId) filter.schoolUnitId = schoolUnitId;
      if (campusId) filter.campusId = campusId;

      const kpiFilter = { ...filter };
      delete kpiFilter.status;
      const [total, statusRows, classes, streams, staffList] = await Promise.all([
        Section.countDocuments(filter),
        Section.aggregate([
          { $match: kpiFilter },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Class
          ? Class.find({}).select("name code schoolUnitId schoolUnitName campusId campusName levelType classLevel stream streamName academicYear term").sort({ createdAt: -1 }).lean()
          : [],
        Stream
          ? Stream.find({}).select("name code schoolUnitId schoolUnitName campusId campusName levelType classId className classLevel classStream sectionId sectionName sectionCode status").sort({ name: 1, createdAt: -1 }).lean()
          : [],
        Staff
          ? Staff.find({}).select("fullName name role email").sort({ fullName: 1, name: 1 }).lean()
          : [],
      ]);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const sections = await Section.find(filter)
        .populate("classTeacher", "fullName name email role")
        .populate("classId", "name code classLevel stream academicYear term campusName levelType")
        .populate("streamId", "name code classId className sectionId sectionName")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const statusCounts = Object.fromEntries(statusRows.map((row) => [String(row._id || ""), Number(row.count || 0)]));
      const kpis = { total, active: statusCounts.active || 0, inactive: statusCounts.inactive || 0, archived: statusCounts.archived || 0 };

      return res.render("tenant/sections/index", {
        tenant: req.tenant || null,
        sections,
        classes,
        streams,
        staffList,
        structure: buildStructure(req),
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: { q, status, levelType, classId, streamId, schoolUnitId, campusId, page: safePage, total, totalPages, perPage },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("SECTIONS LIST ERROR:", err);
      return res.status(500).send("Failed to load sections.");
    }
  },

  create: async (req, res) => {
    const { Section, Class, Stream } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/sections");
    }

    try {
      const klass = await Class.findById(req.body.classId).lean();
      if (!klass) {
        req.flash?.("error", "Selected class was not found.");
        return res.redirect("/admin/sections");
      }

      let stream = null;
      if (req.body.streamId) {
        stream = Stream ? await Stream.findById(req.body.streamId).lean() : null;
        if (!stream) {
          req.flash?.("error", "Selected stream was not found.");
          return res.redirect("/admin/sections");
        }
        if (stream.classId && !sameId(stream.classId, klass._id)) {
          req.flash?.("error", "Selected stream does not belong to the selected class.");
          return res.redirect("/admin/sections");
        }
      }

      const name = String(req.body.name || "").trim();
      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, klass, stream);
      code = slugCode(code);

      const exists = await Section.findOne({ code }).lean();
      if (exists) {
        req.flash?.("error", "Section code already exists.");
        return res.redirect("/admin/sections");
      }

      const doc = {
        name,
        code,
        schoolUnitId: klass.schoolUnitId || "",
        schoolUnitName: klass.schoolUnitName || "",
        schoolUnitCode: slugCode(klass.schoolUnitCode || klass.schoolUnitName || "UNIT"),
        campusId: klass.campusId || "",
        campusName: klass.campusName || "",
        campusCode: slugCode(klass.campusCode || klass.campusName || "CAMPUS"),
        levelType: klass.levelType || "primary",
        classId: klass._id,
        className: klass.name || "",
        classCode: klass.code || "",
        classLevel: klass.classLevel || "",
        classStream: stream?.name || klass.streamName || klass.stream || "",
        streamId: stream?._id || null,
        streamName: stream ? String(stream.name || "").trim() : "",
        streamCode: stream ? String(stream.code || "").trim() : "",
        classTeacher: req.body.classTeacher && mongoose.Types.ObjectId.isValid(req.body.classTeacher) ? req.body.classTeacher : null,
        room: String(req.body.room || "").trim().slice(0, 80),
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        notes: String(req.body.notes || "").trim().slice(0, 1200),
        createdBy: req.user?._id || null,
      };

      await Section.create(doc);
      req.flash?.("success", "Section created.");
      return res.redirect("/admin/sections");
    } catch (err) {
      console.error("CREATE SECTION ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Section already exists for that class.");
      else req.flash?.("error", "Failed to create section.");
      return res.redirect("/admin/sections");
    }
  },

  update: async (req, res) => {
    const { Section, Class, Stream } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/sections");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid section id.");
        return res.redirect("/admin/sections");
      }

      const klass = await Class.findById(req.body.classId).lean();
      if (!klass) {
        req.flash?.("error", "Selected class was not found.");
        return res.redirect("/admin/sections");
      }

      let stream = null;
      if (req.body.streamId) {
        stream = Stream ? await Stream.findById(req.body.streamId).lean() : null;
        if (!stream) {
          req.flash?.("error", "Selected stream was not found.");
          return res.redirect("/admin/sections");
        }
        if (stream.classId && !sameId(stream.classId, klass._id)) {
          req.flash?.("error", "Selected stream does not belong to the selected class.");
          return res.redirect("/admin/sections");
        }
      }

      const name = String(req.body.name || "").trim();
      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, klass, stream);
      code = slugCode(code);

      const collision = await Section.findOne({ code, _id: { $ne: id } }).lean();
      if (collision) {
        req.flash?.("error", "Section code already exists.");
        return res.redirect("/admin/sections");
      }

      const update = {
        name,
        code,
        schoolUnitId: klass.schoolUnitId || "",
        schoolUnitName: klass.schoolUnitName || "",
        schoolUnitCode: slugCode(klass.schoolUnitCode || klass.schoolUnitName || "UNIT"),
        campusId: klass.campusId || "",
        campusName: klass.campusName || "",
        campusCode: slugCode(klass.campusCode || klass.campusName || "CAMPUS"),
        levelType: klass.levelType || "primary",
        classId: klass._id,
        className: klass.name || "",
        classCode: klass.code || "",
        classLevel: klass.classLevel || "",
        classStream: stream?.name || klass.streamName || klass.stream || "",
        streamId: stream?._id || null,
        streamName: stream ? String(stream.name || "").trim() : "",
        streamCode: stream ? String(stream.code || "").trim() : "",
        classTeacher: req.body.classTeacher && mongoose.Types.ObjectId.isValid(req.body.classTeacher) ? req.body.classTeacher : null,
        room: String(req.body.room || "").trim().slice(0, 80),
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        notes: String(req.body.notes || "").trim().slice(0, 1200),
      };

      await Section.updateOne({ _id: id }, { $set: update }, { runValidators: true });
      req.flash?.("success", "Section updated.");
      return res.redirect("/admin/sections");
    } catch (err) {
      console.error("UPDATE SECTION ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Section already exists for that class.");
      else req.flash?.("error", "Failed to update section.");
      return res.redirect("/admin/sections");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Section } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid section id.");
        return res.redirect("/admin/sections");
      }
      const next = STATUSES.includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/admin/sections");
      }
      await Section.updateOne({ _id: id }, { $set: { status: next } });
      req.flash?.("success", "Section status updated.");
      return res.redirect("/admin/sections");
    } catch (err) {
      console.error("SET SECTION STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect("/admin/sections");
    }
  },

  remove: async (req, res) => {
    try {
      const { Section } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid section id.");
        return res.redirect("/admin/sections");
      }
      await Section.deleteOne({ _id: id });
      req.flash?.("success", "Section deleted.");
      return res.redirect("/admin/sections");
    } catch (err) {
      console.error("DELETE SECTION ERROR:", err);
      req.flash?.("error", "Failed to delete section.");
      return res.redirect("/admin/sections");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Section } = req.models;
      const action = String(req.body.action || "").trim();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No sections selected.");
        return res.redirect("/admin/sections");
      }

      if (action === "activate") {
        await Section.updateMany({ _id: { $in: ids } }, { $set: { status: "active" } });
        req.flash?.("success", "Selected sections activated.");
      } else if (action === "deactivate") {
        await Section.updateMany({ _id: { $in: ids } }, { $set: { status: "inactive" } });
        req.flash?.("success", "Selected sections inactivated.");
      } else if (action === "archive") {
        await Section.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", "Selected sections archived.");
      } else if (action === "delete") {
        await Section.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected sections deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/sections");
    } catch (err) {
      console.error("SECTION BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/sections");
    }
  },
};

{
  const catalog = require('../../../services/tenant/academicCatalogService');
  const originalList = module.exports.list;
  const originalCreate = module.exports.create;
  const originalUpdate = module.exports.update;

  module.exports.list = async function guardedSectionList(req, res) {
    await catalog.syncEnrollmentCounts(req.models).catch((err) => console.error('SECTION ENROLLMENT SYNC ERROR:', err));
    return originalList(req, res);
  };

  module.exports.create = async function guardedSectionCreate(req, res) {
    req.body.enrolledCount = '0';
    const klass = mongoose.Types.ObjectId.isValid(req.body.classId) ? await req.models.Class?.findById(req.body.classId).lean() : null;
    if (String(req.body.status || 'active') === 'active' && klass && klass.status !== 'active') {
      req.flash?.('error', 'Activate the parent class before creating an active section.');
      return res.redirect('/admin/sections');
    }
    return originalCreate(req, res);
  };

  module.exports.update = async function guardedSectionUpdate(req, res) {
    const id = String(req.params.id || '').trim();
    if (mongoose.Types.ObjectId.isValid(id)) {
      const current = await req.models.Section.findById(id).lean();
      if (current) {
        try {
          await catalog.assertStructuralMoveAllowed(req.models, 'section', id, current, { classId: req.body.classId, streamId: req.body.streamId || null });
          await catalog.assertCapacityNotBelowEnrollment(req.models, 'section', id, req.body.capacity);
          req.body.enrolledCount = String(current.enrolledCount || 0);
          const klass = mongoose.Types.ObjectId.isValid(req.body.classId) ? await req.models.Class?.findById(req.body.classId).lean() : null;
          if (String(req.body.status || current.status || 'active') === 'active' && klass && klass.status !== 'active') throw new Error('Activate the parent class before activating this section.');
        } catch (err) { req.flash?.('error', err.message || 'Section scope cannot be changed.'); return res.redirect('/admin/sections'); }
      }
    }
    const result = await originalUpdate(req, res);
    if (mongoose.Types.ObjectId.isValid(id)) {
      const updated = await req.models.Section.findById(id).lean().catch(() => null);
      if (updated) await catalog.propagateSectionMetadata(req.models, id, updated).catch((err) => console.error('SECTION METADATA PROPAGATION ERROR:', err));
    }
    return result;
  };

  module.exports.setStatus = async function guardedSectionStatus(req, res) {
    const id = String(req.params.id || '').trim(); const next = String(req.body.status || '').trim();
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Invalid section id.');
      const doc = await req.models.Section.findById(id).lean(); if (!doc) throw new Error('Section was not found.');
      if (next === 'active') { const parent = await req.models.Class?.findById(doc.classId).lean(); if (parent && parent.status !== 'active') throw new Error('Activate the parent class first.'); }
      await catalog.assertStatusAllowed(req.models, 'section', id, next);
      await req.models.Section.updateOne({ _id: id }, { $set: { status: next } }, { runValidators: true });
      req.flash?.('success', 'Section status updated.');
    } catch (err) { req.flash?.('error', err.message || 'Failed to update section status.'); }
    return res.redirect('/admin/sections');
  };

  module.exports.remove = async function guardedSectionDelete(req, res) {
    const id = String(req.params.id || '').trim();
    try { if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Invalid section id.'); await catalog.assertDeleteAllowed(req.models, 'section', id); await req.models.Section.deleteOne({ _id: id }); req.flash?.('success','Section deleted.'); }
    catch (err) { req.flash?.('error', err.message || 'Failed to delete section.'); }
    return res.redirect('/admin/sections');
  };

  module.exports.bulk = async function guardedSectionBulk(req, res) {
    const action = String(req.body.action || '').trim(); const ids = [...new Set(String(req.body.ids || '').split(',').map((v) => v.trim()).filter((v) => mongoose.Types.ObjectId.isValid(v)))];
    const statusMap = { activate: 'active', deactivate: 'inactive', archive: 'archived' };
    if (!ids.length || (!statusMap[action] && action !== 'delete')) { req.flash?.('error', !ids.length ? 'No sections selected.' : 'Invalid bulk action.'); return res.redirect('/admin/sections'); }
    let changed = 0; let skipped = 0;
    for (const id of ids) { try { if (action === 'delete') { await catalog.assertDeleteAllowed(req.models,'section',id); await req.models.Section.deleteOne({ _id:id }); } else { const next=statusMap[action]; if(next==='active'){const doc=await req.models.Section.findById(id).lean(); const parent=doc?await req.models.Class?.findById(doc.classId).lean():null; if(parent&&parent.status!=='active') throw new Error('Parent class inactive.');} await catalog.assertStatusAllowed(req.models,'section',id,next); await req.models.Section.updateOne({_id:id},{$set:{status:next}},{runValidators:true}); } changed+=1; } catch { skipped+=1; } }
    req.flash?.(changed?'success':'error', `${changed} section${changed===1?'':'s'} updated${skipped?`; ${skipped} skipped because of active/dependent records.`:'.'}`); return res.redirect('/admin/sections');
  };

  module.exports.exportCsv = async function exportSectionsCsv(req,res){
    await catalog.syncEnrollmentCounts(req.models).catch(()=>null); const q=String(req.query.q||'').trim(); const filter={};
    if(q){const rx=catalog.escapeRegExp(q); filter.$or=['name','code','className','classLevel','streamName','room','notes'].map((key)=>({[key]:{$regex:rx,$options:'i'}}));}
    for(const key of ['status','levelType','schoolUnitId','campusId']) if(req.query[key]) filter[key]=String(req.query[key]).trim();
    if(req.query.classId&&mongoose.Types.ObjectId.isValid(req.query.classId)) filter.classId=req.query.classId; if(req.query.streamId&&mongoose.Types.ObjectId.isValid(req.query.streamId)) filter.streamId=req.query.streamId;
    const rows=await req.models.Section.find(filter).populate('classTeacher','fullName name').sort({createdAt:-1}).lean(); const lines=[['Name','Code','Class','Class Level','Stream','Campus','Room','Capacity','Enrolled','Status','Teacher','Notes'].map(catalog.csvCell).join(',')];
    for(const r of rows) lines.push([r.name,r.code,r.className,r.classLevel,r.streamName,r.campusName,r.room,r.capacity,r.enrolledCount,r.status,r.classTeacher?.fullName||r.classTeacher?.name||'',r.notes].map(catalog.csvCell).join(','));
    res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition','attachment; filename="sections.csv"'); return res.send(`\uFEFF${lines.join('\n')}`);
  };
}

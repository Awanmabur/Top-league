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

function buildSmartCode(body, klass, section) {
  const campusCode = slugCode(klass?.campusCode || klass?.campusName || "CAMPUS");
  const classLevel = slugCode(klass?.classLevel || "CLASS");
  const classStream = slugCode(section?.name || klass?.sectionName || klass?.stream || "A");
  const stream = slugCode(body.name || "STREAM");
  return slugCode(`${campusCode}-${classLevel}-${classStream}-${stream}`);
}

const streamRules = [
  body("name").trim().isLength({ min: 1, max: 100 }).withMessage("Stream name is required."),
  body("code").optional({ checkFalsy: true }).trim().isLength({ min: 1, max: 40 }).withMessage("Code must be 1-40 chars."),
  body("classId").trim().custom((v) => mongoose.Types.ObjectId.isValid(v)).withMessage("Valid class is required."),
  body("sectionId").optional({ checkFalsy: true }).custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Invalid section."),
  body("classTeacher").optional({ checkFalsy: true }).custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Invalid teacher."),
  body("status").optional({ checkFalsy: true }).isIn(STATUSES).withMessage("Invalid status."),
  body("capacity").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("enrolledCount").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("room").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
];

module.exports = {
  streamRules,

  list: async (req, res) => {
    try {
      const { Stream, Staff, Class, Section } = req.models;

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();
      const levelType = String(req.query.levelType || "").trim();
      const classId = String(req.query.classId || "").trim();
      const sectionId = String(req.query.sectionId || "").trim();
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
          { sectionName: { $regex: rx, $options: "i" } },
          { sectionCode: { $regex: rx, $options: "i" } },
          { room: { $regex: rx, $options: "i" } },
          { notes: { $regex: rx, $options: "i" } },
        ];
      }

      if (status) filter.status = status;
      if (levelType) filter.levelType = levelType;
      if (classId) filter.classId = classId;
      if (sectionId) filter.sectionId = sectionId;
      if (schoolUnitId) filter.schoolUnitId = schoolUnitId;
      if (campusId) filter.campusId = campusId;

      const total = await Stream.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const streams = await Stream.find(filter)
        .populate("classTeacher", "fullName name email role")
        .populate("classId", "name code classLevel stream academicYear term campusName levelType")
        .populate("sectionId", "name code classId className")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const classes = Class
        ? await Class.find({})
            .select("name code schoolUnitId schoolUnitName campusId campusName levelType classLevel stream sectionName academicYear term")
            .sort({ createdAt: -1 })
            .lean()
        : [];

      const sections = Section
        ? await Section.find({})
            .select("name code schoolUnitId schoolUnitName campusId campusName levelType classId className classLevel classStream streamId streamName streamCode status")
            .sort({ name: 1, createdAt: -1 })
            .lean()
        : [];

      const staffList = Staff
        ? await Staff.find({})
            .select("fullName name role email")
            .sort({ fullName: 1, name: 1 })
            .lean()
        : [];

      const kpis = {
        total,
        active: await Stream.countDocuments({ ...filter, status: "active" }),
        inactive: await Stream.countDocuments({ ...filter, status: "inactive" }),
        archived: await Stream.countDocuments({ ...filter, status: "archived" }),
      };

      return res.render("tenant/streams/index", {
        tenant: req.tenant || null,
        streams,
        classes,
        sections,
        staffList,
        structure: buildStructure(req),
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: { q, status, levelType, classId, sectionId, schoolUnitId, campusId, page: safePage, total, totalPages, perPage },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("STREAMS LIST ERROR:", err);
      return res.status(500).send("Failed to load streams.");
    }
  },

  create: async (req, res) => {
    const { Stream, Class, Section } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/streams");
    }

    try {
      const klass = await Class.findById(req.body.classId).lean();
      if (!klass) {
        req.flash?.("error", "Selected class was not found.");
        return res.redirect("/admin/streams");
      }

      let section = null;
      if (req.body.sectionId) {
        section = Section ? await Section.findById(req.body.sectionId).lean() : null;
        if (!section) {
          req.flash?.("error", "Selected section was not found.");
          return res.redirect("/admin/streams");
        }
        if (section.classId && !sameId(section.classId, klass._id)) {
          req.flash?.("error", "Selected section does not belong to the selected class.");
          return res.redirect("/admin/streams");
        }
      }

      const name = String(req.body.name || "").trim();
      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, klass, section);
      code = slugCode(code);

      const exists = await Stream.findOne({ code }).lean();
      if (exists) {
        req.flash?.("error", "Stream code already exists.");
        return res.redirect("/admin/streams");
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
        classStream: name || klass.streamName || klass.stream || "",
        sectionId: section?._id || null,
        sectionName: section ? String(section.name || "").trim() : "",
        sectionCode: section ? String(section.code || "").trim() : "",
        classTeacher: req.body.classTeacher && mongoose.Types.ObjectId.isValid(req.body.classTeacher) ? req.body.classTeacher : null,
        room: String(req.body.room || "").trim().slice(0, 80),
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        notes: String(req.body.notes || "").trim().slice(0, 1200),
        createdBy: req.user?._id || null,
      };

      await Stream.create(doc);
      req.flash?.("success", "Stream created.");
      return res.redirect("/admin/streams");
    } catch (err) {
      console.error("CREATE STREAM ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Stream already exists for that class.");
      else req.flash?.("error", "Failed to create stream.");
      return res.redirect("/admin/streams");
    }
  },

  update: async (req, res) => {
    const { Stream, Class, Section } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/streams");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid stream id.");
        return res.redirect("/admin/streams");
      }

      const klass = await Class.findById(req.body.classId).lean();
      if (!klass) {
        req.flash?.("error", "Selected class was not found.");
        return res.redirect("/admin/streams");
      }

      let section = null;
      if (req.body.sectionId) {
        section = Section ? await Section.findById(req.body.sectionId).lean() : null;
        if (!section) {
          req.flash?.("error", "Selected section was not found.");
          return res.redirect("/admin/streams");
        }
        if (section.classId && !sameId(section.classId, klass._id)) {
          req.flash?.("error", "Selected section does not belong to the selected class.");
          return res.redirect("/admin/streams");
        }
      }

      const name = String(req.body.name || "").trim();
      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, klass, section);
      code = slugCode(code);

      const collision = await Stream.findOne({ code, _id: { $ne: id } }).lean();
      if (collision) {
        req.flash?.("error", "Stream code already exists.");
        return res.redirect("/admin/streams");
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
        classStream: name || klass.streamName || klass.stream || "",
        sectionId: section?._id || null,
        sectionName: section ? String(section.name || "").trim() : "",
        sectionCode: section ? String(section.code || "").trim() : "",
        classTeacher: req.body.classTeacher && mongoose.Types.ObjectId.isValid(req.body.classTeacher) ? req.body.classTeacher : null,
        room: String(req.body.room || "").trim().slice(0, 80),
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        notes: String(req.body.notes || "").trim().slice(0, 1200),
      };

      await Stream.updateOne({ _id: id }, { $set: update }, { runValidators: true });
      req.flash?.("success", "Stream updated.");
      return res.redirect("/admin/streams");
    } catch (err) {
      console.error("UPDATE STREAM ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Stream already exists for that class.");
      else req.flash?.("error", "Failed to update stream.");
      return res.redirect("/admin/streams");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Stream } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid stream id.");
        return res.redirect("/admin/streams");
      }
      const next = STATUSES.includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/admin/streams");
      }
      await Stream.updateOne({ _id: id }, { $set: { status: next } });
      req.flash?.("success", "Stream status updated.");
      return res.redirect("/admin/streams");
    } catch (err) {
      console.error("SET STREAM STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect("/admin/streams");
    }
  },

  remove: async (req, res) => {
    try {
      const { Stream } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid stream id.");
        return res.redirect("/admin/streams");
      }
      await Stream.deleteOne({ _id: id });
      req.flash?.("success", "Stream deleted.");
      return res.redirect("/admin/streams");
    } catch (err) {
      console.error("DELETE STREAM ERROR:", err);
      req.flash?.("error", "Failed to delete stream.");
      return res.redirect("/admin/streams");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Stream } = req.models;
      const action = String(req.body.action || "").trim();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No streams selected.");
        return res.redirect("/admin/streams");
      }

      if (action === "activate") {
        await Stream.updateMany({ _id: { $in: ids } }, { $set: { status: "active" } });
        req.flash?.("success", "Selected streams activated.");
      } else if (action === "deactivate") {
        await Stream.updateMany({ _id: { $in: ids } }, { $set: { status: "inactive" } });
        req.flash?.("success", "Selected streams inactivated.");
      } else if (action === "archive") {
        await Stream.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", "Selected streams archived.");
      } else if (action === "delete") {
        await Stream.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected streams deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/streams");
    } catch (err) {
      console.error("STREAM BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/streams");
    }
  },
};

{
  const catalog = require('../../../services/tenant/academicCatalogService');
  const originalList = module.exports.list;
  const originalCreate = module.exports.create;
  const originalUpdate = module.exports.update;

  module.exports.list = async function guardedStreamList(req,res){ await catalog.syncEnrollmentCounts(req.models).catch((err)=>console.error('STREAM ENROLLMENT SYNC ERROR:',err)); return originalList(req,res); };
  module.exports.create = async function guardedStreamCreate(req,res){ req.body.enrolledCount='0'; const klass=mongoose.Types.ObjectId.isValid(req.body.classId)?await req.models.Class?.findById(req.body.classId).lean():null; const section=req.body.sectionId&&mongoose.Types.ObjectId.isValid(req.body.sectionId)?await req.models.Section?.findById(req.body.sectionId).lean():null; if(String(req.body.status||'active')==='active'&&((klass&&klass.status!=='active')||(section&&section.status!=='active'))){req.flash?.('error','Activate the parent class/section before creating an active stream.');return res.redirect('/admin/streams');} return originalCreate(req,res); };
  module.exports.update = async function guardedStreamUpdate(req,res){ const id=String(req.params.id||'').trim(); if(mongoose.Types.ObjectId.isValid(id)){const current=await req.models.Stream.findById(id).lean(); if(current){try{await catalog.assertStructuralMoveAllowed(req.models,'stream',id,current,{classId:req.body.classId,sectionId:req.body.sectionId||null}); await catalog.assertCapacityNotBelowEnrollment(req.models,'stream',id,req.body.capacity); req.body.enrolledCount=String(current.enrolledCount||0);}catch(err){req.flash?.('error',err.message||'Stream scope cannot be changed.');return res.redirect('/admin/streams');}}} const result=await originalUpdate(req,res); if(mongoose.Types.ObjectId.isValid(id)){const updated=await req.models.Stream.findById(id).lean().catch(()=>null); if(updated) await catalog.propagateStreamMetadata(req.models,id,updated).catch((err)=>console.error('STREAM METADATA PROPAGATION ERROR:',err));} return result; };
  module.exports.setStatus = async function guardedStreamStatus(req,res){const id=String(req.params.id||'').trim(),next=String(req.body.status||'').trim(); try{if(!mongoose.Types.ObjectId.isValid(id)) throw new Error('Invalid stream id.'); const doc=await req.models.Stream.findById(id).lean(); if(!doc) throw new Error('Stream was not found.'); if(next==='active'){const parent=await req.models.Class?.findById(doc.classId).lean(); const section=doc.sectionId?await req.models.Section?.findById(doc.sectionId).lean():null; if((parent&&parent.status!=='active')||(section&&section.status!=='active')) throw new Error('Activate the parent class/section first.');} await catalog.assertStatusAllowed(req.models,'stream',id,next); await req.models.Stream.updateOne({_id:id},{$set:{status:next}},{runValidators:true}); req.flash?.('success','Stream status updated.');}catch(err){req.flash?.('error',err.message||'Failed to update stream status.');} return res.redirect('/admin/streams');};
  module.exports.remove = async function guardedStreamDelete(req,res){const id=String(req.params.id||'').trim(); try{if(!mongoose.Types.ObjectId.isValid(id)) throw new Error('Invalid stream id.'); await catalog.assertDeleteAllowed(req.models,'stream',id); await req.models.Stream.deleteOne({_id:id}); req.flash?.('success','Stream deleted.');}catch(err){req.flash?.('error',err.message||'Failed to delete stream.');} return res.redirect('/admin/streams');};
  module.exports.bulk = async function guardedStreamBulk(req,res){const action=String(req.body.action||'').trim(); const ids=[...new Set(String(req.body.ids||'').split(',').map(v=>v.trim()).filter(v=>mongoose.Types.ObjectId.isValid(v)))]; const statusMap={activate:'active',deactivate:'inactive',archive:'archived'}; if(!ids.length||(!statusMap[action]&&action!=='delete')){req.flash?.('error',!ids.length?'No streams selected.':'Invalid bulk action.');return res.redirect('/admin/streams');} let changed=0,skipped=0; for(const id of ids){try{if(action==='delete'){await catalog.assertDeleteAllowed(req.models,'stream',id);await req.models.Stream.deleteOne({_id:id});}else{await catalog.assertStatusAllowed(req.models,'stream',id,statusMap[action]);await req.models.Stream.updateOne({_id:id},{$set:{status:statusMap[action]}},{runValidators:true});}changed+=1;}catch{skipped+=1;}} req.flash?.(changed?'success':'error',`${changed} stream${changed===1?'':'s'} updated${skipped?`; ${skipped} skipped because of active/dependent records.`:'.'}`);return res.redirect('/admin/streams');};
  module.exports.exportCsv = async function exportStreamsCsv(req,res){await catalog.syncEnrollmentCounts(req.models).catch(()=>null); const q=String(req.query.q||'').trim(); const filter={}; if(q){const rx=catalog.escapeRegExp(q);filter.$or=['name','code','className','classLevel','sectionName','room','notes'].map(key=>({[key]:{$regex:rx,$options:'i'}}));} for(const key of ['status','levelType','schoolUnitId','campusId']) if(req.query[key]) filter[key]=String(req.query[key]).trim(); if(req.query.classId&&mongoose.Types.ObjectId.isValid(req.query.classId))filter.classId=req.query.classId;if(req.query.sectionId&&mongoose.Types.ObjectId.isValid(req.query.sectionId))filter.sectionId=req.query.sectionId; const rows=await req.models.Stream.find(filter).populate('classTeacher','fullName name').sort({createdAt:-1}).lean();const lines=[['Name','Code','Class','Class Level','Section','Campus','Room','Capacity','Enrolled','Status','Teacher','Notes'].map(catalog.csvCell).join(',')]; for(const r of rows)lines.push([r.name,r.code,r.className,r.classLevel,r.sectionName,r.campusName,r.room,r.capacity,r.enrolledCount,r.status,r.classTeacher?.fullName||r.classTeacher?.name||'',r.notes].map(catalog.csvCell).join(','));res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="streams.csv"');return res.send(`\uFEFF${lines.join('\n')}`);};
}

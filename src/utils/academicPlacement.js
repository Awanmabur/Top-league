const mongoose = require('mongoose');

const cleanStr = (v, max = 200) => String(v || '').trim().slice(0, max);
const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

async function loadAcademicPlacement(req) {
  const { Class, Section, Stream, Subject } = req.models || {};

  const [classes, sections, streams, subjects] = await Promise.all([
    Class
      ? Class.find({ status: { $ne: 'archived' } })
          .select('_id name code schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode levelType classLevel stream academicYear term')
          .sort({ levelType: 1, classLevel: 1, stream: 1, name: 1 })
          .lean()
      : [],
    Section
      ? Section.find({ status: { $ne: 'archived' } })
          .select('_id name code schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode levelType classId className classCode classLevel classStream')
          .sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 })
          .lean()
      : [],
    Stream
      ? Stream.find({ status: { $ne: 'archived' } })
          .select('_id name code schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode levelType classId className classCode classLevel classStream')
          .sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 })
          .lean()
      : [],
    Subject
      ? Subject.find({ status: { $ne: 'archived' } })
          .select('_id title code schoolUnitId campusId levelType classId sectionId streamId academicYear term')
          .sort({ title: 1, code: 1 })
          .lean()
      : [],
  ]);

  return {
    classes: classes.map((klass) => ({
      _id: String(klass._id),
      name: cleanStr(klass.name, 180),
      code: cleanStr(klass.code, 40),
      schoolUnitId: cleanStr(klass.schoolUnitId, 80),
      schoolUnitName: cleanStr(klass.schoolUnitName, 180),
      schoolUnitCode: cleanStr(klass.schoolUnitCode, 40),
      campusId: cleanStr(klass.campusId, 80),
      campusName: cleanStr(klass.campusName, 180),
      campusCode: cleanStr(klass.campusCode, 40),
      levelType: cleanStr(klass.levelType, 40).toLowerCase(),
      classLevel: cleanStr(klass.classLevel, 40).toUpperCase(),
      stream: cleanStr(klass.stream, 80).toUpperCase(),
      academicYear: cleanStr(klass.academicYear, 20),
      term: Number(klass.term || 1),
    })),
    sections: sections.map((section) => ({
      _id: String(section._id),
      name: cleanStr(section.name, 120),
      code: cleanStr(section.code, 40),
      schoolUnitId: cleanStr(section.schoolUnitId, 80),
      schoolUnitName: cleanStr(section.schoolUnitName, 180),
      schoolUnitCode: cleanStr(section.schoolUnitCode, 40),
      campusId: cleanStr(section.campusId, 80),
      campusName: cleanStr(section.campusName, 180),
      campusCode: cleanStr(section.campusCode, 40),
      levelType: cleanStr(section.levelType, 40).toLowerCase(),
      classId: cleanStr(section.classId, 80),
      className: cleanStr(section.className, 180),
      classCode: cleanStr(section.classCode, 40),
      classLevel: cleanStr(section.classLevel, 40).toUpperCase(),
      classStream: cleanStr(section.classStream, 80).toUpperCase(),
    })),
    streams: streams.map((stream) => ({
      _id: String(stream._id),
      name: cleanStr(stream.name, 120),
      code: cleanStr(stream.code, 40),
      schoolUnitId: cleanStr(stream.schoolUnitId, 80),
      schoolUnitName: cleanStr(stream.schoolUnitName, 180),
      schoolUnitCode: cleanStr(stream.schoolUnitCode, 40),
      campusId: cleanStr(stream.campusId, 80),
      campusName: cleanStr(stream.campusName, 180),
      campusCode: cleanStr(stream.campusCode, 40),
      levelType: cleanStr(stream.levelType, 40).toLowerCase(),
      classId: cleanStr(stream.classId, 80),
      className: cleanStr(stream.className, 180),
      classCode: cleanStr(stream.classCode, 40),
      classLevel: cleanStr(stream.classLevel, 40).toUpperCase(),
      classStream: cleanStr(stream.classStream, 80).toUpperCase(),
    })),
    subjects: subjects.map((subject) => ({
      _id: String(subject._id),
      title: cleanStr(subject.title, 180),
      code: cleanStr(subject.code, 40),
      schoolUnitId: cleanStr(subject.schoolUnitId, 80),
      campusId: cleanStr(subject.campusId, 80),
      levelType: cleanStr(subject.levelType, 40).toLowerCase(),
      classId: cleanStr(subject.classId, 80),
      sectionId: cleanStr(subject.sectionId, 80),
      streamId: cleanStr(subject.streamId, 80),
      academicYear: cleanStr(subject.academicYear, 20),
      term: Number(subject.term || 1),
    })),
  };
}

async function findPlacementDocs(req, { classId, sectionId, streamId, subjectId } = {}) {
  const { Class, Section, Stream, Subject } = req.models || {};

  const [klass, section, stream, subject] = await Promise.all([
    classId && Class && isObjId(classId) ? Class.findById(classId).lean() : null,
    sectionId && Section && isObjId(sectionId) ? Section.findById(sectionId).lean() : null,
    streamId && Stream && isObjId(streamId) ? Stream.findById(streamId).lean() : null,
    subjectId && Subject && isObjId(subjectId) ? Subject.findById(subjectId).lean() : null,
  ]);

  return { klass, section, stream, subject };
}

function buildPlacementFilter({ classId, sectionId, streamId, academicYear, term } = {}) {
  const filter = {};
  if (classId && isObjId(classId)) filter.classId = classId;
  if (sectionId && isObjId(sectionId)) filter.sectionId = sectionId;
  if (streamId && isObjId(streamId)) filter.streamId = streamId;
  if (academicYear) filter.academicYear = cleanStr(academicYear, 20);
  if (term && !Number.isNaN(Number(term))) filter.term = Number(term);
  return filter;
}

module.exports = { loadAcademicPlacement, findPlacementDocs, buildPlacementFilter, cleanStr, isObjId };

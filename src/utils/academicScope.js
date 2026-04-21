const mongoose = require('mongoose');

function isObjId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || '').trim());
}

function clean(v, max = 120) {
  return String(v || '').trim().slice(0, max);
}

async function getAcademicScope(models) {
  const Class = models.Class;
  const Section = models.Section;
  const Stream = models.Stream;
  const Subject = models.Subject;

  const [classes, sections, streams, subjects] = await Promise.all([
    Class ? Class.find({}).select('name code classLevel stream academicYear term levelType schoolUnitId schoolUnitName campusId campusName').sort({ name: 1, classLevel: 1 }).lean() : [],
    Section ? Section.find({}).select('name code classId className classCode streamId streamName streamCode levelType schoolUnitId schoolUnitName campusId campusName').sort({ name: 1 }).lean() : [],
    Stream ? Stream.find({}).select('name code classId className classCode sectionId sectionName sectionCode levelType schoolUnitId schoolUnitName campusId campusName').sort({ name: 1 }).lean() : [],
    Subject ? Subject.find({}).select('title code classId className sectionId sectionName streamId streamName').sort({ title: 1 }).lean() : [],
  ]);

  const safeClasses = classes.map((c) => ({
    ...c,
    displayName: c.name || c.code || 'Class',
  }));
  const safeSections = sections.map((s) => ({
    ...s,
    displayName: s.name || s.code || 'Section',
  }));
  const safeStreams = streams.map((s) => ({
    ...s,
    displayName: s.name || s.code || 'Stream',
  }));
  const safeSubjects = subjects.map((s) => ({
    ...s,
    displayName: `${s.code || ''}${s.code ? ' — ' : ''}${s.title || 'Subject'}`.trim(),
  }));

  return {
    classes: safeClasses,
    sections: safeSections,
    streams: safeStreams,
    subjects: safeSubjects,
    sectionsByClass: Object.fromEntries(safeClasses.map((c) => [String(c._id), safeSections.filter((s) => String(s.classId) === String(c._id))])),
    streamsByClass: Object.fromEntries(safeClasses.map((c) => [String(c._id), safeStreams.filter((s) => String(s.classId) === String(c._id))])),
    streamsBySection: Object.fromEntries(safeSections.map((s) => [String(s._id), safeStreams.filter((x) => String(x.sectionId || '') === String(s._id))])),
    sectionsByStream: Object.fromEntries(safeStreams.map((s) => [String(s._id), safeSections.filter((x) => String(x.streamId || '') === String(s._id))])),
    subjectsByClass: Object.fromEntries(safeClasses.map((c) => [String(c._id), safeSubjects.filter((s) => String(s.classId) === String(c._id))])),
  };
}

function pickScopeFromSubject(subject) {
  return {
    classId: subject?.classId ? String(subject.classId) : '',
    className: subject?.className || '',
    sectionId: subject?.sectionId ? String(subject.sectionId) : '',
    sectionName: subject?.sectionName || '',
    streamId: subject?.streamId ? String(subject.streamId) : '',
    streamName: subject?.streamName || '',
  };
}

function pickScopeFromStudent(student) {
  return {
    classId: clean(student?.classId, 80),
    className: student?.className || '',
    sectionId: clean(student?.sectionId, 80),
    sectionName: student?.section || '',
    streamId: clean(student?.streamId, 80),
    streamName: student?.stream || '',
  };
}

module.exports = { isObjId, clean, getAcademicScope, pickScopeFromSubject, pickScopeFromStudent };

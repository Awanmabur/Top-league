const mongoose = require('mongoose');

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ''));
}

function cleanString(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function buildId(value) {
  const str = cleanString(value, 80);
  return isValidObjectId(str) ? str : '';
}

async function loadAcademicScopeLists(req) {
  const { Class, Section, Stream, Subject, Student } = req.models || {};

  const [classes, sections, streams, subjects, students] = await Promise.all([
    Class
      ? Class.find({ status: { $ne: 'archived' } }).select('name code schoolUnitId schoolUnitName campusId campusName campusCode levelType classLevel academicYear term status').sort({ name: 1, classLevel: 1, academicYear: -1 }).lean()
      : [],
    Section
      ? Section.find({ status: { $ne: 'archived' } }).select('name code classId className classCode classLevel levelType schoolUnitId schoolUnitName campusId campusName streamId streamName streamCode status').sort({ className: 1, name: 1 }).lean()
      : [],
    Stream
      ? Stream.find({ status: { $ne: 'archived' } }).select('name code classId className classCode classLevel levelType schoolUnitId schoolUnitName campusId campusName sectionId sectionName sectionCode status').sort({ className: 1, name: 1 }).lean()
      : [],
    Subject
      ? Subject.find({ status: { $ne: 'archived' } }).select('title code shortTitle classId className sectionId sectionName streamId streamName academicYear term status').sort({ title: 1, code: 1 }).lean()
      : [],
    Student
      ? Student.find({ isDeleted: { $ne: true }, status: { $ne: 'archived' } }).select('fullName name regNo studentNo indexNumber email classId className sectionId section streamId stream academicYear term').sort({ fullName: 1, name: 1 }).limit(3000).lean()
      : [],
  ]);

  return {
    classes: classes.map((c) => ({
      ...c,
      id: String(c._id || ''),
      label: [c.name || c.code || 'Class', c.classLevel ? `(${c.classLevel})` : '', c.academicYear || ''].filter(Boolean).join(' '),
    })),
    sections: sections.map((s) => ({
      ...s,
      id: String(s._id || ''),
      classId: String(s.classId || ''),
      label: s.name || s.code || 'Section',
    })),
    streams: streams.map((s) => ({
      ...s,
      id: String(s._id || ''),
      classId: String(s.classId || ''),
      sectionId: String(s.sectionId || ''),
      label: s.name || s.code || 'Stream',
    })),
    subjects: subjects.map((s) => ({
      ...s,
      id: String(s._id || ''),
      classId: String(s.classId || ''),
      sectionId: String(s.sectionId || ''),
      streamId: String(s.streamId || ''),
      label: `${s.code ? `${s.code} - ` : ''}${s.title || s.shortTitle || 'Subject'}`,
    })),
    students: students.map((s) => ({
      ...s,
      id: String(s._id || ''),
      classId: String(s.classId || ''),
      sectionId: String(s.sectionId || ''),
      streamId: String(s.streamId || ''),
      label: `${s.regNo || s.studentNo || s.indexNumber ? `${s.regNo || s.studentNo || s.indexNumber} - ` : ''}${s.fullName || s.name || 'Student'}`,
    })),
  };
}

async function resolveAcademicScope(req, { classId, sectionId, streamId } = {}) {
  const { Class, Section, Stream } = req.models || {};

  const normalizedClassId = buildId(classId);
  const normalizedSectionId = buildId(sectionId);
  const normalizedStreamId = buildId(streamId);

  const [selectedClass, selectedSection, selectedStream] = await Promise.all([
    Class && normalizedClassId
      ? Class.findById(normalizedClassId)
          .select('name code classLevel levelType schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode academicYear term')
          .lean()
      : null,
    Section && normalizedSectionId
      ? Section.findById(normalizedSectionId)
          .select('name code classId className classCode classLevel levelType schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode streamId streamName streamCode')
          .lean()
      : null,
    Stream && normalizedStreamId
      ? Stream.findById(normalizedStreamId)
          .select('name code classId className classCode classLevel levelType schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode sectionId sectionName sectionCode')
          .lean()
      : null,
  ]);

  const errors = [];
  if (normalizedClassId && !selectedClass) errors.push('Selected class was not found.');
  if (normalizedSectionId && !selectedSection) errors.push('Selected section was not found.');
  if (normalizedStreamId && !selectedStream) errors.push('Selected stream was not found.');

  let classDoc = selectedClass;
  if (!classDoc && selectedSection?.classId && Class) {
    classDoc = await Class.findById(selectedSection.classId)
      .select('name code classLevel levelType schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode academicYear term')
      .lean()
      .catch(() => null);
  }
  if (!classDoc && selectedStream?.classId && Class) {
    classDoc = await Class.findById(selectedStream.classId)
      .select('name code classLevel levelType schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode academicYear term')
      .lean()
      .catch(() => null);
  }

  if (selectedSection && classDoc && String(selectedSection.classId || '') !== String(classDoc._id || '')) {
    errors.push('Selected section does not belong to the selected class.');
  }
  if (selectedStream && classDoc && String(selectedStream.classId || '') !== String(classDoc._id || '')) {
    errors.push('Selected stream does not belong to the selected class.');
  }
  if (selectedSection && selectedStream) {
    if (String(selectedSection.classId || '') !== String(selectedStream.classId || '')) {
      errors.push('Selected section and stream do not belong to the same class.');
    }
  }

  return {
    errors,
    classDoc,
    sectionDoc: selectedSection,
    streamDoc: selectedStream,
    payload: {
      classId: classDoc?._id || null,
      className: classDoc?.name || selectedSection?.className || selectedStream?.className || '',
      classCode: classDoc?.code || selectedSection?.classCode || selectedStream?.classCode || '',
      classLevel: classDoc?.classLevel || selectedSection?.classLevel || selectedStream?.classLevel || '',
      levelType: classDoc?.levelType || selectedSection?.levelType || selectedStream?.levelType || '',
      schoolUnitId: classDoc?.schoolUnitId || selectedSection?.schoolUnitId || selectedStream?.schoolUnitId || '',
      schoolUnitName: classDoc?.schoolUnitName || selectedSection?.schoolUnitName || selectedStream?.schoolUnitName || '',
      schoolUnitCode: classDoc?.schoolUnitCode || selectedSection?.schoolUnitCode || selectedStream?.schoolUnitCode || '',
      campusId: classDoc?.campusId || selectedSection?.campusId || selectedStream?.campusId || '',
      campusName: classDoc?.campusName || selectedSection?.campusName || selectedStream?.campusName || '',
      campusCode: classDoc?.campusCode || selectedSection?.campusCode || selectedStream?.campusCode || '',
      academicYear: classDoc?.academicYear || '',
      term: classDoc?.term || null,
      sectionId: selectedSection?._id || null,
      sectionName: selectedSection?.name || '',
      sectionCode: selectedSection?.code || '',
      streamId: selectedStream?._id || null,
      streamName: selectedStream?.name || '',
      streamCode: selectedStream?.code || '',
    },
  };
}

function buildAcademicScopeFilter({ classGroup, classId, sectionId, streamId } = {}, classField = 'classGroup') {
  const filter = {};
  const normalizedClassId = buildId(classGroup || classId);
  const normalizedSectionId = buildId(sectionId);
  const normalizedStreamId = buildId(streamId);

  if (normalizedClassId) filter[classField] = normalizedClassId;
  if (normalizedSectionId) filter.sectionId = normalizedSectionId;
  if (normalizedStreamId) filter.streamId = normalizedStreamId;
  return filter;
}

module.exports = {
  isValidObjectId,
  cleanString,
  loadAcademicScopeLists,
  resolveAcademicScope,
  buildAcademicScopeFilter,
};

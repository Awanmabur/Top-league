function getSchoolUnits(req) {
  return req.tenantDoc?.settings?.academics?.schoolUnits
    || req.tenant?.settings?.academics?.schoolUnits
    || [];
}

function normalizeText(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

function buildStructure(req) {
  return (getSchoolUnits(req) || []).map((schoolUnit) => ({
    id: String(schoolUnit.id || schoolUnit._id || ''),
    name: normalizeText(schoolUnit.name),
    code: normalizeText(schoolUnit.code, 40),
    campuses: (schoolUnit.campuses || []).map((campus) => ({
      id: String(campus.id || campus._id || ''),
      name: normalizeText(campus.name),
      code: normalizeText(campus.code, 40),
      levels: (campus.levels || []).map((level) => ({
        id: String(level.id || level._id || ''),
        name: normalizeText(level.name, 120),
        type: String(level.type || '').trim().toLowerCase(),
        code: normalizeText(level.code, 40),
      })),
    })),
  }));
}

function normalizeClassRecord(klass) {
  return {
    id: String(klass?._id || klass?.id || ''),
    name: normalizeText(klass?.name),
    code: normalizeText(klass?.code, 40),
    schoolUnitId: normalizeText(klass?.schoolUnitId, 80),
    schoolUnitName: normalizeText(klass?.schoolUnitName),
    campusId: normalizeText(klass?.campusId, 80),
    campusName: normalizeText(klass?.campusName),
    levelType: String(klass?.levelType || klass?.schoolLevel || '').trim().toLowerCase(),
    classLevel: normalizeText(klass?.classLevel, 20).toUpperCase(),
    sectionId: normalizeText(klass?.sectionId, 80),
    sectionName: normalizeText(klass?.sectionName, 100),
    stream: normalizeText(klass?.stream, 80),
    academicYear: normalizeText(klass?.academicYear, 20),
    term: Number(klass?.term || 1),
  };
}

function buildClassLabel(klass) {
  const record = normalizeClassRecord(klass);
  return [
    record.name || record.code || record.classLevel || 'Class',
    record.classLevel && record.name !== record.classLevel ? record.classLevel : '',
    record.sectionName ? `Section ${record.sectionName}` : '',
    record.stream ? `Stream ${record.stream}` : '',
    record.academicYear || '',
  ].filter(Boolean).join(' • ');
}

function normalizeSubjectRecord(subject) {
  return {
    id: String(subject?._id || subject?.id || ''),
    title: normalizeText(subject?.title),
    code: normalizeText(subject?.code, 40),
    shortTitle: normalizeText(subject?.shortTitle, 80),
    classId: String(subject?.classId?._id || subject?.classId || ''),
    className: normalizeText(subject?.className || subject?.classId?.name),
    schoolUnitId: normalizeText(subject?.schoolUnitId, 80),
    campusId: normalizeText(subject?.campusId, 80),
    levelType: String(subject?.levelType || '').trim().toLowerCase(),
    classLevel: normalizeText(subject?.classLevel, 20).toUpperCase(),
    sectionId: normalizeText(subject?.sectionId, 80),
    sectionName: normalizeText(subject?.sectionName, 100),
    stream: normalizeText(subject?.classStream || subject?.stream, 80),
    academicYear: normalizeText(subject?.academicYear, 20),
    term: Number(subject?.term || 1),
  };
}

function normalizeStudentRecord(student) {
  return {
    id: String(student?._id || student?.id || ''),
    fullName: normalizeText(student?.fullName || student?.name),
    regNo: normalizeText(student?.regNo || student?.studentNo || student?.indexNumber, 80),
    email: normalizeText(student?.email, 120),
    classId: normalizeText(student?.classId || student?.classGroup, 80),
    sectionId: normalizeText(student?.sectionId, 80),
    streamId: normalizeText(student?.streamId, 80),
    schoolUnitId: normalizeText(student?.schoolUnitId, 80),
    campusId: normalizeText(student?.campusId, 80),
    schoolLevel: String(student?.schoolLevel || '').trim().toLowerCase(),
    classLevel: normalizeText(student?.classLevel, 20).toUpperCase(),
    academicYear: normalizeText(student?.academicYear, 20),
    term: Number(student?.term || 1),
  };
}

module.exports = {
  getSchoolUnits,
  buildStructure,
  normalizeClassRecord,
  buildClassLabel,
  normalizeSubjectRecord,
  normalizeStudentRecord,
};

function normalizeText(value, max = 180) {
  return String(value || "").trim().slice(0, max);
}

function slugCode(input, max = 40) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, max);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function normalizeSection(section, index = 0) {
  const name = normalizeText(
    typeof section === "string" ? section : section?.name || section?.title || section?.code,
    100
  );
  const code = normalizeText(section?.code, 40) || slugCode(name || `section-${index + 1}`, 40);

  if (!name && !code) return null;

  return {
    ...(typeof section === "object" && section ? section : {}),
    id: String(section?.id || section?._id || code || `section-${index + 1}`),
    name: name || code.toUpperCase(),
    code,
    isActive: section?.isActive !== false,
  };
}

function normalizeLevel(level, index = 0) {
  const name = normalizeText(level?.name, 120) || normalizeText(level?.code, 80) || `Level ${index + 1}`;
  const code = normalizeText(level?.code, 40) || slugCode(name, 40) || `level-${index + 1}`;
  const sections = (Array.isArray(level?.sections) ? level.sections : [])
    .map((section, sectionIndex) => normalizeSection(section, sectionIndex))
    .filter(Boolean);

  return {
    ...(level || {}),
    id: String(level?.id || level?._id || code),
    name,
    code,
    type: String(level?.type || "").trim().toLowerCase(),
    sections,
  };
}

function normalizeCampus(campus, campusIndex, schoolUnit) {
  const fallbackName = normalizeText(schoolUnit?.name, 160) || `School Unit ${campusIndex + 1}`;
  const name =
    normalizeText(campus?.name, 160) ||
    (campus?.isVirtual ? fallbackName : `Campus ${campusIndex + 1}`);
  const code =
    normalizeText(campus?.code, 40) ||
    slugCode(campus?.isVirtual ? schoolUnit?.code || schoolUnit?.name || name : name, 40) ||
    `campus-${campusIndex + 1}`;
  const levelsSource = Array.isArray(campus?.levels)
    ? campus.levels
    : Array.isArray(schoolUnit?.levels)
      ? schoolUnit.levels
      : [];

  return {
    ...(campus || {}),
    id: String(campus?.id || campus?._id || `${schoolUnit?.id || "unit"}-${code}`),
    name,
    code,
    isMain: campus?.isMain !== false,
    isVirtual: campus?.isVirtual === true,
    levels: levelsSource.map((level, levelIndex) => normalizeLevel(level, levelIndex)),
  };
}

function normalizeSchoolUnit(schoolUnit, unitIndex = 0) {
  const name = normalizeText(schoolUnit?.name, 160) || `School Unit ${unitIndex + 1}`;
  const code = normalizeText(schoolUnit?.code, 40) || slugCode(name, 40) || `unit-${unitIndex + 1}`;
  const id = String(schoolUnit?.id || schoolUnit?._id || code);
  const rawCampuses = Array.isArray(schoolUnit?.campuses) ? schoolUnit.campuses : [];
  const campuses = rawCampuses
    .map((campus, campusIndex) => normalizeCampus(campus, campusIndex, { ...schoolUnit, id, name, code }))
    .filter(Boolean);

  if (!campuses.length) {
    campuses.push(
      normalizeCampus(
        {
          id: `${id}-default-campus`,
          name,
          code,
          isMain: true,
          isVirtual: true,
          levels: Array.isArray(schoolUnit?.levels) ? schoolUnit.levels : [],
        },
        0,
        { ...schoolUnit, id, name, code }
      )
    );
  }

  return {
    ...(schoolUnit || {}),
    id,
    name,
    code,
    campuses,
  };
}

function normalizeSchoolUnits(source) {
  const units = Array.isArray(source) ? clone(source) : [];
  return units.map((schoolUnit, unitIndex) => normalizeSchoolUnit(schoolUnit, unitIndex));
}

function extractRawSchoolUnits(source) {
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== "object") return [];
  return (
    source.tenantDoc?.settings?.academics?.schoolUnits ||
    source.tenant?.settings?.academics?.schoolUnits ||
    []
  );
}

function getSchoolUnits(source) {
  return normalizeSchoolUnits(extractRawSchoolUnits(source));
}

module.exports = {
  getSchoolUnits,
  normalizeSchoolUnits,
};

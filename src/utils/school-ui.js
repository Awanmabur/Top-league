// src/utils/school-ui.js

function getSchoolUi(schoolLevel = "high") {
  const isNursery = schoolLevel === "nursery";
  const isPrimary = schoolLevel === "primary";
  const isHigh = schoolLevel === "high";

  return {
    schoolLevel,
    isNursery,
    isPrimary,
    isHigh,

    learners: isNursery ? "Children" : isPrimary ? "Pupils" : "Students",
    learner: isNursery ? "Child" : isPrimary ? "Pupil" : "Student",

    guardians: isHigh ? "Parents" : "Guardians",
    guardian: isHigh ? "Parent" : "Guardian",

    records: isNursery ? "Child Records" : isPrimary ? "Pupil Records" : "Student Docs",

    subjects: isNursery ? "Learning Areas" : "Subjects",
    subject: isNursery ? "Learning Area" : "Subject",

    assignments: isNursery ? "Activities" : "Assignments",
    exams: isNursery ? "Assessments" : "Exams",
    results: isNursery ? "Progress" : "Results",

    reports: isNursery ? "Progress Reports" : "Report Cards",
    report: isNursery ? "Progress Report" : "Report Card",

    statements: isHigh ? "Student Statements" : "Fee Statements",
    bursaries: isHigh ? "Scholarships" : "Bursaries",

    subtitle: isNursery ? "Nursery Management System" : "School Management System",
    studentNavCat: isNursery ? "CHILDREN" : isPrimary ? "PUPILS" : "STUDENTS",

    schoolWord: isNursery ? "nursery" : "school",

    searchPlaceholder: isNursery
      ? "Search children, staff, classes..."
      : isPrimary
      ? "Search pupils, staff, classes..."
      : "Search students, staff, subjects...",

    totalLearnersLabel: `Total ${isNursery ? "Children" : isPrimary ? "Pupils" : "Students"}`,
    recentLearnersTitle: isNursery ? "Recent Children" : isPrimary ? "Recent Pupils" : "Recent Students",
    recentLearnersSub: isNursery ? "Recently admitted" : "Enrolled this month",
    owingLearnersLabel: isNursery ? "Children owing" : isPrimary ? "Pupils owing" : "Students owing",

    groupLabel: isHigh ? "Stream" : "Class",
    groupLabelPlural: isHigh ? "Streams" : "Classes",

    distributionTitle: isHigh
      ? "Students by Stream"
      : isNursery
      ? "Children by Class"
      : "Pupils by Class",

    addLearner: isNursery ? "+ Add Child" : isPrimary ? "+ Add Pupil" : "+ Add Student",
    addGroup: isHigh ? "+ Add Stream" : "+ Add Class",
    addSubject: isNursery ? "+ Add Learning Area" : "+ Add Subject",
  };
}

module.exports = { getSchoolUi };

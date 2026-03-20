/**
 * GPA Calculation Service
 * Multi-tenant safe, reusable in any controller
 */

module.exports = {
  /**
   * Compute GPA for a given list of results (one semester)
   * Results must include: marks, gradePoint, creditUnits, isGPAIncluded
   */
  calculateSemesterGPA(results) {
    const valid = results.filter(r => r.isGPAIncluded);

    if (valid.length === 0) return { gpa: 0, totalCredits: 0 };

    let totalQualityPoints = 0;
    let totalCredits = 0;

    valid.forEach(r => {
      totalQualityPoints += r.gradePoint * r.creditUnits;
      totalCredits += r.creditUnits;
    });

    const gpa = totalQualityPoints / totalCredits;

    return {
      gpa: parseFloat(gpa.toFixed(2)),
      totalCredits
    };
  },

  /**
   * Compute cumulative GPA across all semesters
   */
  calculateCGPA(allResults) {
    const valid = allResults.filter(r => r.isGPAIncluded);

    if (valid.length === 0) return { cgpa: 0, totalCredits: 0 };

    let totalQualityPoints = 0;
    let totalCredits = 0;

    valid.forEach(r => {
      totalQualityPoints += r.gradePoint * r.creditUnits;
      totalCredits += r.creditUnits;
    });

    const cgpa = totalQualityPoints / totalCredits;

    return {
      cgpa: parseFloat(cgpa.toFixed(2)),
      totalCredits
    };
  },

  /**
   * Determine academic standing by CGPA
   */
  getAcademicStanding(cgpa) {
    if (cgpa >= 3.60) return "Distinction";
    if (cgpa >= 3.00) return "Merit";
    if (cgpa >= 2.00) return "Good Standing";
    if (cgpa >= 1.50) return "Probation";
    return "Fail / Dismissal Recommended";
  },

  /**
   * Prepare transcript structure for student
   * Groups results by academic year & semester
   */
  buildTranscript(results) {
    const transcript = {};

    results.forEach((r) => {
      const year = r.academicYear || "Unknown Year";
      const semester = r.semester || "Unknown Semester";

      if (!transcript[year]) transcript[year] = {};
      if (!transcript[year][semester]) transcript[year][semester] = [];

      transcript[year][semester].push({
        course: r.courseId.courseName,
        code: r.courseId.courseCode,
        creditUnits: r.creditUnits,
        marks: r.marks,
        grade: r.grade,
        gradePoint: r.gradePoint
      });
    });

    return transcript;
  }
};

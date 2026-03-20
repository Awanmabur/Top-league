const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");

module.exports = {
  profile: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        {
          tenant: req.tenant,
          user,
          student,
          currentPath: req.originalUrl,
          pageTitle: "Profile",
        },
        "tenant/student/profile"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const profile = {
        fullName: getStudentDisplayName(student, user),
        email: student?.email || user?.email || "",
        phone: student?.phone || student?.phoneNumber || "",
        gender: student?.gender || "",
        dob: student?.dateOfBirth || student?.dob || null,
        nationality: student?.nationality || "",
        address: student?.address || student?.postalAddress || "",
        guardianName: student?.guardianName || student?.parentName || "",
        guardianPhone: student?.guardianPhone || student?.parentPhone || "",
        emergencyContact: student?.emergencyContact || "",
        faculty: meta.faculty,
        department: meta.department,
        program: meta.program,
        level: meta.level,
        semester: meta.semester,
        studentNumber: meta.studentNumber,
      };

      return renderView(req, res, "tenant/student/profile", {
        pageTitle: "Profile",
        user,
        student,
        studentName: profile.fullName,
        meta,
        profile,
      });
    } catch (err) {
      return res.status(500).send("Failed to load profile: " + err.message);
    }
  },
};
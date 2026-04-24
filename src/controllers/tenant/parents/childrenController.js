const { getParent } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { Student } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const childIds = Array.isArray(parent?.childrenStudentIds)
        ? parent.childrenStudentIds
        : [];

      const children =
        parent && Student && childIds.length
          ? await Student.find({ _id: { $in: childIds } })
              .select(
                "firstName lastName middleName fullName regNo program classGroup yearLevel academicYear semester status photoUrl guardianName guardianPhone guardianEmail attendanceRate feeBalance balance averageScore avgScore cgpa latestResult latestAnnouncement lastAttendanceDate nextEvent campus homeroomTeacher parentRelationship"
              )
              .populate({
                path: "program",
                select: "code name title level faculty",
              })
              .populate({
                path: "classGroup",
                select: "code name title",
              })
              .sort({ firstName: 1, lastName: 1 })
              .lean()
              .catch(() => [])
          : [];

      return res.render("parents/children", {
        tenant: req.tenant,
        user,
        parent,
        children,
        pageStats: {
          totalChildren: children.length,
        },
      });
    } catch (err) {
      console.error("PARENT CHILDREN ERROR:", err);
      return res.status(500).send("Failed to load parent children page");
    }
  },
};

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  escapeRegex,
  normalizeAudienceType,
  publicationFilter,
  announcementMatchesContext,
  studentMatchesAudience,
  staffMatchesAudience,
  resolveDirectRecipients,
  materializeRecipients,
  activateAnnouncement,
  expireAnnouncements,
} = require("../src/services/tenant/announcementService");

test("announcement search escapes regex metacharacters instead of treating user input as a regex", () => {
  assert.equal(escapeRegex("fees.*(urgent)+"), "fees\\.\\*\\(urgent\\)\\+");
});

test("legacy audience aliases normalize to the canonical announcement contract", () => {
  assert.equal(normalizeAudienceType("Students"), "All Students");
  assert.equal(normalizeAudienceType("Parents"), "All Parents");
  assert.equal(normalizeAudienceType("Specific Class"), "Specific Program");
  assert.equal(normalizeAudienceType("Cohort"), "Year/Cohort");
});

test("publication filter is fail-closed to Published and excludes deleted/expired announcements", () => {
  const now = new Date("2026-08-29T08:00:00.000Z");
  const filter = publicationFilter(now);
  assert.equal(filter.status, "Published");
  assert.deepEqual(filter.isDeleted, { $ne: true });
  assert.equal(filter.$and.length, 2);
  assert.equal(filter.$and[1].$or[2].expiryDate.$gt, now);
});

test("student audiences match only the intended academic context", () => {
  const student = {
    classId: "class-1",
    className: "S4 Blue",
    classCode: "S4-B",
    schoolUnitName: "Secondary",
    classLevel: "S4",
    academicYear: "2026",
    intakeId: "intake-a",
    subjects: ["507f1f77bcf86cd799439011"],
  };
  assert.equal(studentMatchesAudience(student, "All Students", ""), true);
  assert.equal(studentMatchesAudience(student, "Specific Program", "S4 Blue"), true);
  assert.equal(studentMatchesAudience(student, "Year/Cohort", "S4"), true);
  assert.equal(studentMatchesAudience(student, "Specific Department", "Secondary"), true);
  assert.equal(studentMatchesAudience(student, "Specific Program", "P7"), false);
  assert.equal(studentMatchesAudience(student, "Hostel Residents", "", { hostelResident: false }), false);
  assert.equal(studentMatchesAudience(student, "Hostel Residents", "", { hostelResident: true }), true);
});

test("staff department targeting does not leak student/staff audiences across roles", () => {
  const staff = { departmentId: "507f1f77bcf86cd799439012", jobTitle: "Teacher" };
  assert.equal(staffMatchesAudience(staff, "All Staff", ""), true);
  assert.equal(staffMatchesAudience(staff, "Specific Department", "Teacher"), true);
  assert.equal(staffMatchesAudience(staff, "All Students", ""), false);
});

test("parent portal receives parent notices and child-relevant student notices, but not staff notices", () => {
  const context = {
    role: "parent",
    user: { _id: "u-parent" },
    children: [{ student: { classLevel: "S2", className: "S2 A" }, hostelResident: false }],
  };
  assert.equal(announcementMatchesContext({ audienceType: "All Parents" }, context), true);
  assert.equal(announcementMatchesContext({ audienceType: "All Students" }, context), true);
  assert.equal(announcementMatchesContext({ audienceType: "Year/Cohort", audienceValue: "S2" }, context), true);
  assert.equal(announcementMatchesContext({ audienceType: "Year/Cohort", audienceValue: "S6" }, context), false);
  assert.equal(announcementMatchesContext({ audienceType: "All Staff" }, context), false);
});

test("student and staff contexts cannot see each other's all-role announcements", () => {
  const studentContext = { role: "student", user: { _id: "u1" }, student: { classLevel: "S1" } };
  const staffContext = { role: "staff", user: { _id: "u2" }, staff: { jobTitle: "Teacher" } };
  assert.equal(announcementMatchesContext({ audienceType: "All Staff" }, studentContext), false);
  assert.equal(announcementMatchesContext({ audienceType: "All Students" }, staffContext), false);
});


function leanQuery(rows) {
  return {
    select() { return this; },
    lean: async () => rows,
  };
}

test("direct student audiences materialize both students and parents who can see the same child-targeted notice", async () => {
  const students = [{ _id: "507f1f77bcf86cd799439011", userId: "507f1f77bcf86cd799439021" }];
  const studentUser = { _id: "507f1f77bcf86cd799439021", email: "student@example.test", firstName: "Stu", roles: ["student"] };
  const parentUser = { _id: "507f1f77bcf86cd799439022", email: "parent@example.test", firstName: "Par", roles: ["parent"], childrenStudentIds: [students[0]._id] };

  const Student = { find: () => leanQuery(students) };
  const User = {
    find(query) {
      if (query.roles === "parent") return leanQuery([parentUser]);
      if (query.$or) return leanQuery([studentUser]);
      return leanQuery([]);
    },
  };

  const recipients = await resolveDirectRecipients(
    { models: { User, Student } },
    { audienceType: "All Students", audienceValue: "—" }
  );
  assert.deepEqual(new Set(recipients.map((u) => String(u._id))), new Set([studentUser._id, parentUser._id]));
});

test("recipient materialization prunes stale users after an audience edit before upserting current recipients", async () => {
  const studentId = "507f1f77bcf86cd799439031";
  const currentUser = { _id: "507f1f77bcf86cd799439041", email: "current@example.test", firstName: "Current", roles: ["student"] };
  const Student = { find: () => leanQuery([{ _id: studentId, userId: currentUser._id }]) };
  const User = {
    find(query) {
      if (query.roles === "parent") return leanQuery([]);
      if (query.$or) return leanQuery([currentUser]);
      return leanQuery([]);
    },
  };
  let deletedWith = null;
  let ops = null;
  const AnnouncementReceipt = {
    async deleteMany(filter) { deletedWith = filter; return { deletedCount: 1 }; },
    async bulkWrite(nextOps) { ops = nextOps; return {}; },
  };

  await materializeRecipients(
    { models: { User, Student, AnnouncementReceipt } },
    { _id: "507f1f77bcf86cd799439051", audienceType: "All Students", audienceValue: "—" }
  );

  assert.equal(String(deletedWith.announcementId), "507f1f77bcf86cd799439051");
  assert.deepEqual(deletedWith.userId.$nin.map(String), [currentUser._id]);
  assert.equal(ops.length, 1);
  assert.equal(String(ops[0].updateOne.filter.userId), currentUser._id);
});

test("expired Published and Scheduled announcements are transitioned to Unpublished", async () => {
  let filter = null;
  let update = null;
  const Announcement = {
    async updateMany(nextFilter, nextUpdate) {
      filter = nextFilter;
      update = nextUpdate;
      return { modifiedCount: 2 };
    },
  };
  const now = new Date("2026-08-29T08:00:00.000Z");
  const count = await expireAnnouncements({ models: { Announcement } }, now);
  assert.equal(count, 2);
  assert.deepEqual(filter.status.$in, ["Published", "Scheduled"]);
  assert.equal(filter.expiryDate.$lte, now);
  assert.equal(update.$set.status, "Unpublished");
  assert.equal(update.$set.scheduleClaimedAt, null);
});


test("manual activation refuses an already-expired announcement and leaves it unpublished", async () => {
  let saves = 0;
  const announcement = {
    _id: "507f1f77bcf86cd799439061",
    status: "Draft",
    expiryDate: new Date("2026-08-28T08:00:00.000Z"),
    scheduleAt: new Date("2026-08-30T08:00:00.000Z"),
    scheduleClaimedAt: new Date("2026-08-29T07:00:00.000Z"),
    async save() { saves += 1; },
  };
  const result = await activateAnnouncement(
    { models: {} },
    announcement,
    new Date("2026-08-29T08:00:00.000Z"),
    { updatedBy: "507f1f77bcf86cd799439062" }
  );
  assert.equal(result, null);
  assert.equal(announcement.status, "Unpublished");
  assert.equal(announcement.scheduleAt, null);
  assert.equal(announcement.scheduleClaimedAt, null);
  assert.equal(saves, 1);
});

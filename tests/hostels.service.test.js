const test = require("node:test");
const assert = require("node:assert/strict");

const {
  escapeRegex,
  makeCode,
  applicationTransitionAllowed,
  genderCompatible,
  createApplication,
  allocateStudent,
  vacateAllocation,
} = require("../src/services/tenant/hostelService");

test("hostel search input is escaped instead of treated as a regex", () => {
  assert.equal(escapeRegex("A.*[1]"), "A\\.\\*\\[1\\]");
});

test("hostel identifiers use dated cryptographic suffixes", () => {
  assert.match(makeCode("HAPP", new Date("2026-08-29T10:00:00Z")), /^HAPP-20260829-[A-F0-9]{8}$/);
});

test("hostel application lifecycle blocks terminal transitions", () => {
  assert.equal(applicationTransitionAllowed("Pending", "Approved"), true);
  assert.equal(applicationTransitionAllowed("Waitlist", "Approved"), true);
  assert.equal(applicationTransitionAllowed("Allocated", "Pending"), false);
  assert.equal(applicationTransitionAllowed("Cancelled", "Approved"), false);
  assert.equal(applicationTransitionAllowed("Denied", "Pending"), false);
});

test("room gender compatibility is enforced when the student has a known gender", () => {
  assert.equal(genderCompatible({ gender: "male" }, { gender: "Male" }), true);
  assert.equal(genderCompatible({ gender: "female" }, { gender: "Male" }), false);
  assert.equal(genderCompatible({ gender: "" }, { gender: "Male" }), true);
  assert.equal(genderCompatible({ gender: "female" }, { gender: "Mixed" }), true);
});

test("full rooms create a waitlist application rather than pretending space exists", async () => {
  const created = [];
  const room = { _id: "507f1f77bcf86cd799439011", block: "A", code: "A-1", type: "Standard", gender: "Mixed", status: "Full", occupied: 4, beds: 4 };
  const student = { _id: "507f191e810c19729de860ea", fullName: "Student One", regNo: "REG-1", academicYear: "2026", term: 1 };
  const models = {
    Hostel: { findOne: async () => room },
    HostelApplication: {
      exists: async () => false,
      findOne: async () => null,
      create: async (doc) => { created.push(doc); return { ...doc, _id: "507f1f77bcf86cd799439012" }; },
    },
    HostelAllocation: { findOne: () => ({ lean: async () => null }) },
  };
  const result = await createApplication(models, { student, roomId: room._id });
  assert.equal(result.application.status, "Waitlist");
  assert.equal(created[0].isCurrent, true);
});

test("allocation rolls room capacity back when the unique allocation write fails", async () => {
  let released = 0;
  let findCalls = 0;
  const room = {
    _id: "507f1f77bcf86cd799439011",
    block: "A", code: "A-1", gender: "Mixed", status: "Available", occupied: 1, beds: 2,
  };
  const Hostel = {
    findById: async () => {
      findCalls += 1;
      return {
        ...room,
        occupied: findCalls > 1 ? 2 : 1,
        status: findCalls > 1 ? "Full" : "Available",
        save: async function () { if (findCalls > 1) released += 1; },
      };
    },
    findOneAndUpdate: async () => ({ ...room, occupied: 2, status: "Full", save: async () => {} }),
  };
  const models = {
    Hostel,
    HostelAllocation: {
      findOne: () => ({ lean: async () => null }),
      create: async () => { const err = new Error("duplicate"); err.code = 11000; throw err; },
    },
  };
  const student = { _id: "507f191e810c19729de860ea", fullName: "Student", regNo: "REG", academicYear: "2026", term: 1 };
  await assert.rejects(() => allocateStudent(models, { student, roomId: room._id }), /already has an active hostel allocation/);
  assert.equal(released, 1);
});


test("allocation cannot bypass a pending application or switch an approved application to another room", async () => {
  const roomA = { _id: "507f1f77bcf86cd799439011", block: "A", code: "A-1", gender: "Mixed", status: "Available", occupied: 0, beds: 2 };
  const roomB = { _id: "507f1f77bcf86cd799439012", block: "B", code: "B-1", gender: "Mixed", status: "Available", occupied: 0, beds: 2 };
  const student = { _id: "507f191e810c19729de860ea", fullName: "Student", regNo: "REG", academicYear: "2026", term: 1 };
  const pending = { _id: "507f1f77bcf86cd799439013", student: student._id, hostel: roomA._id, status: "Pending", isCurrent: true };
  let claimed = 0;
  const Hostel = {
    findById: async (id) => String(id) === String(roomA._id) ? roomA : roomB,
    findOneAndUpdate: async () => { claimed += 1; return roomA; },
  };
  const HostelAllocation = { findOne: () => ({ lean: async () => null }), create: async () => ({}) };
  const HostelApplication = {
    findOne: (filter) => ({
      sort: async () => pending,
      then: (resolve) => Promise.resolve(pending).then(resolve),
    }),
  };

  await assert.rejects(
    () => allocateStudent({ Hostel, HostelAllocation, HostelApplication }, { student, roomId: roomA._id }),
    /Approve the student's current hostel application/
  );
  assert.equal(claimed, 0);

  pending.status = "Approved";
  await assert.rejects(
    () => allocateStudent({ Hostel, HostelAllocation, HostelApplication }, { student, roomId: roomB._id }),
    /current hostel application for a different room/
  );
  assert.equal(claimed, 0);
});

test("an explicit application must be current, approved, owned by the student and match the allocated room", async () => {
  const room = { _id: "507f1f77bcf86cd799439011", block: "A", code: "A-1", gender: "Mixed", status: "Available", occupied: 0, beds: 2 };
  const student = { _id: "507f191e810c19729de860ea", fullName: "Student", regNo: "REG", academicYear: "2026", term: 1 };
  const appId = "507f1f77bcf86cd799439013";
  let claimed = 0;
  const application = { _id: appId, student: student._id, hostel: room._id, status: "Waitlist", isCurrent: true };
  const models = {
    Hostel: {
      findById: async () => room,
      findOneAndUpdate: async () => { claimed += 1; return room; },
    },
    HostelAllocation: { findOne: () => ({ lean: async () => null }), create: async () => ({}) },
    HostelApplication: { findOne: async () => application },
  };
  await assert.rejects(
    () => allocateStudent(models, { student, roomId: room._id, applicationId: appId }),
    /Only a current approved hostel application can be allocated/
  );
  assert.equal(claimed, 0);
});

test("vacating an allocation atomically requires an active record before capacity is released", async () => {
  let roomTouched = false;
  const models = {
    HostelAllocation: { findOneAndUpdate: async () => null },
    Hostel: { findById: async () => { roomTouched = true; } },
  };
  await assert.rejects(() => vacateAllocation(models, "507f1f77bcf86cd799439011"), /Active hostel allocation not found/);
  assert.equal(roomTouched, false);
});

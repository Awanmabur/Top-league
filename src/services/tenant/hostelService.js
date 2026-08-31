const crypto = require("crypto");
const mongoose = require("mongoose");

const APPLICATION_STATUSES = ["Pending", "Approved", "Denied", "Waitlist", "Allocated", "Cancelled"];
const ROOM_STATUSES = ["Available", "Full", "Maintenance", "Closed"];
const MAINTENANCE_STATUSES = ["Open", "In Progress", "Resolved"];

const str = (value, max = 1000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const isValidId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactRegex = (value) => new RegExp(`^${escapeRegex(str(value, 180))}$`, "i");

function actorUserId(req) {
  return req?.user?.userId || req?.user?._id || req?.session?.tenantUser?.id || null;
}

function studentName(student) {
  return str(
    student?.fullName ||
      [student?.firstName, student?.middleName, student?.lastName].filter(Boolean).join(" ") ||
      student?.regNo ||
      "Student",
    160
  );
}

function currentAcademicYear(student, now = new Date()) {
  return str(student?.academicYear, 20) || String(now.getFullYear());
}

function currentTerm(student) {
  const n = Number(student?.term || 1);
  return [1, 2, 3].includes(n) ? n : 1;
}

function makeCode(prefix, now = new Date(), bytes = 4) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${date}-${crypto.randomBytes(bytes).toString("hex").toUpperCase()}`;
}

async function uniqueCode(Model, field, prefix, now = new Date()) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = makeCode(prefix, now);
    const exists = typeof Model.exists === "function"
      ? await Model.exists({ [field]: candidate })
      : await Model.findOne({ [field]: candidate }).lean();
    if (!exists) return candidate;
  }
  throw new Error(`Could not allocate a unique ${prefix} identifier.`);
}

function applicationTransitionAllowed(from, to) {
  if (!APPLICATION_STATUSES.includes(to)) return false;
  if (from === to) return true;
  if (["Allocated", "Cancelled", "Denied"].includes(from)) return false;
  return ["Pending", "Approved", "Denied", "Waitlist", "Cancelled"].includes(to);
}

async function resolveStudent(models, input = {}) {
  const Student = models?.Student;
  if (!Student) throw new Error("Student model is unavailable.");

  const studentId = str(input.studentId, 80);
  const regNo = str(input.regNo, 80);
  const name = str(input.studentName, 160);

  if (studentId && isValidId(studentId)) {
    const student = await Student.findOne({ _id: studentId, isDeleted: { $ne: true } });
    if (student) return student;
  }

  if (regNo) {
    const student = await Student.findOne({ regNo: exactRegex(regNo), isDeleted: { $ne: true } });
    if (student) return student;
  }

  if (name) {
    const rows = await Student.find({
      isDeleted: { $ne: true },
      $or: [
        { fullName: exactRegex(name) },
        { firstName: exactRegex(name) },
      ],
    }).limit(2);
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) throw new Error("More than one student matches that name. Use the registration number.");
  }

  throw new Error("A valid student registration number is required.");
}

async function notifyStudent(models, student, payload = {}) {
  const Notification = models?.Notification;
  if (!Notification || !student?.userId) return null;
  return Notification.create({
    audience: "student",
    userId: student.userId,
    title: str(payload.title || "Hostel update", 180),
    message: str(payload.message || "Your hostel record was updated.", 2000),
    type: str(payload.type || "info", 30),
    url: "/student/hostel",
    entityType: str(payload.entityType || "Hostel", 80),
    entityId: payload.entityId || null,
    createdBy: payload.createdBy || null,
  }).catch(() => null);
}

function normalizeGender(value) {
  const v = str(value, 30).toLowerCase();
  if (["male", "m", "boy"].includes(v)) return "Male";
  if (["female", "f", "girl"].includes(v)) return "Female";
  return "";
}

function genderCompatible(student, room) {
  if (!room || room.gender === "Mixed") return true;
  const studentGender = normalizeGender(student?.gender);
  return !studentGender || studentGender === room.gender;
}

async function createApplication(models, input = {}) {
  const { Hostel, HostelApplication, HostelAllocation } = models || {};
  if (!Hostel || !HostelApplication) throw new Error("Hostel application service is unavailable.");
  const student = input.student || await resolveStudent(models, input);
  const roomId = str(input.roomId || input.hostelId, 80);
  if (!isValidId(roomId)) throw new Error("Choose a valid hostel room.");

  const room = await Hostel.findOne({ _id: roomId });
  if (!room) throw new Error("Hostel room not found.");
  if (["Closed", "Maintenance"].includes(room.status)) throw new Error("That room is not accepting applications right now.");
  if (!genderCompatible(student, room)) throw new Error("This room is not available for the student's gender.");

  if (HostelAllocation) {
    const active = await HostelAllocation.findOne({ student: student._id, status: "active", isDeleted: { $ne: true } }).lean();
    if (active && String(active.hostel) === String(room._id)) throw new Error("You are already allocated to this room.");
  }

  const current = await HostelApplication.findOne({ student: student._id, isCurrent: true, isDeleted: { $ne: true } });
  if (current && ["Pending", "Waitlist", "Approved"].includes(current.status)) {
    throw new Error("You already have an active hostel application.");
  }
  if (current) {
    current.isCurrent = false;
    current.updatedBy = input.actorUserId || null;
    await current.save();
  }

  const applicationId = await uniqueCode(HostelApplication, "applicationId", "HAPP", input.now || new Date());
  const initialStatus = room.status === "Full" || Number(room.occupied || 0) >= Number(room.beds || 1) ? "Waitlist" : "Pending";
  const application = await HostelApplication.create({
    applicationId,
    student: student._id,
    studentId: student._id,
    hostel: room._id,
    room: room._id,
    studentName: studentName(student),
    regNo: str(student.regNo, 80),
    roomCode: str(room.code, 80),
    block: str(room.block, 120),
    preference: str(input.preference || room.type, 300),
    notes: str(input.notes, 1500),
    status: initialStatus,
    isCurrent: true,
    submittedAt: input.now || new Date(),
    createdBy: input.actorUserId || null,
    updatedBy: input.actorUserId || null,
  });

  return { application, student, room };
}

async function setApplicationStatus(models, application, nextStatus, actorId = null) {
  if (!application) throw new Error("Hostel application not found.");
  const next = str(nextStatus, 30);
  if (!applicationTransitionAllowed(application.status, next)) {
    throw new Error(`Hostel application cannot move from ${application.status} to ${next}.`);
  }
  application.status = next;
  application.decidedAt = ["Approved", "Denied", "Waitlist"].includes(next) ? new Date() : application.decidedAt;
  application.decidedBy = ["Approved", "Denied", "Waitlist"].includes(next) ? actorId : application.decidedBy;
  application.updatedBy = actorId;
  if (["Denied", "Cancelled", "Allocated"].includes(next)) application.isCurrent = false;
  await application.save();
  return application;
}

async function claimRoom(Hostel, roomId, actorId = null) {
  const room = await Hostel.findOneAndUpdate(
    {
      _id: roomId,
      status: { $nin: ["Maintenance", "Closed"] },
      $expr: { $lt: [{ $ifNull: ["$occupied", 0] }, { $ifNull: ["$beds", 1] }] },
    },
    { $inc: { occupied: 1 }, $set: { updatedBy: actorId } },
    { new: true }
  );
  if (!room) throw new Error("That hostel room is full or unavailable.");
  if (Number(room.occupied || 0) >= Number(room.beds || 1) && room.status !== "Full") {
    room.status = "Full";
    await room.save();
  }
  return room;
}

async function releaseRoom(Hostel, roomId, actorId = null) {
  const room = await Hostel.findById(roomId);
  if (!room) return null;
  room.occupied = Math.max(0, Number(room.occupied || 0) - 1);
  if (room.status === "Full" && room.occupied < Number(room.beds || 1)) room.status = "Available";
  room.updatedBy = actorId;
  await room.save();
  return room;
}

async function allocateStudent(models, input = {}) {
  const { Hostel, HostelAllocation, HostelApplication } = models || {};
  if (!Hostel || !HostelAllocation) throw new Error("Hostel allocation service is unavailable.");
  const student = input.student || await resolveStudent(models, input);
  const roomId = str(input.roomId, 80);
  if (!isValidId(roomId)) throw new Error("Choose a valid hostel room.");

  const existing = await HostelAllocation.findOne({ student: student._id, status: "active", isDeleted: { $ne: true } }).lean();
  if (existing) throw new Error("This student already has an active hostel allocation.");
  const roomBeforeClaim = await Hostel.findById(roomId);
  if (!roomBeforeClaim) throw new Error("Hostel room not found.");
  if (!genderCompatible(student, roomBeforeClaim)) throw new Error("This room is not available for the student's gender.");

  let sourceApplication = null;
  if (HostelApplication) {
    if (input.applicationId) {
      if (!isValidId(input.applicationId)) throw new Error("Invalid hostel application.");
      sourceApplication = await HostelApplication.findOne({
        _id: input.applicationId,
        student: student._id,
        isDeleted: { $ne: true },
      });
      if (!sourceApplication) throw new Error("Hostel application not found for this student.");
      if (String(sourceApplication.hostel || sourceApplication.room) !== String(roomId)) {
        throw new Error("The approved application belongs to a different hostel room.");
      }
      if (sourceApplication.status !== "Approved" || sourceApplication.isCurrent !== true) {
        throw new Error("Only a current approved hostel application can be allocated.");
      }
    } else {
      const currentApplication = await HostelApplication.findOne({
        student: student._id,
        isCurrent: true,
        isDeleted: { $ne: true },
      }).sort({ submittedAt: -1 });
      if (currentApplication) {
        if (String(currentApplication.hostel || currentApplication.room) !== String(roomId)) {
          throw new Error("This student has a current hostel application for a different room.");
        }
        if (currentApplication.status !== "Approved") {
          throw new Error("Approve the student's current hostel application before allocating the room.");
        }
        sourceApplication = currentApplication;
      }
    }
  }

  const room = await claimRoom(Hostel, roomId, input.actorUserId || null);
  let allocation;
  try {
    allocation = await HostelAllocation.create({
      student: student._id,
      studentId: student._id,
      hostel: room._id,
      room: room._id,
      studentName: studentName(student),
      regNo: str(student.regNo, 80),
      roomCode: str(room.code, 80),
      block: str(room.block, 120),
      academicYear: currentAcademicYear(student, input.now),
      semester: currentTerm(student),
      bedLabel: str(input.bedLabel, 40),
      notes: str(input.notes || input.note, 1000),
      checkInDate: input.now || new Date(),
      status: "active",
      sourceApplicationId: sourceApplication?._id || null,
      createdBy: input.actorUserId || null,
      updatedBy: input.actorUserId || null,
    });
  } catch (error) {
    await releaseRoom(Hostel, room._id, input.actorUserId || null).catch(() => null);
    throw error?.code === 11000 ? new Error("This student already has an active hostel allocation.") : error;
  }

  if (sourceApplication) {
    sourceApplication.status = "Allocated";
    sourceApplication.isCurrent = false;
    sourceApplication.allocatedAt = input.now || new Date();
    sourceApplication.updatedBy = input.actorUserId || null;
    await sourceApplication.save();
    if (String(allocation.sourceApplicationId || "") !== String(sourceApplication._id)) {
      allocation.sourceApplicationId = sourceApplication._id;
      await allocation.save();
    }
  }

  return { allocation, student, room };
}

async function vacateAllocation(models, allocationId, actorId = null) {
  const { HostelAllocation, Hostel } = models || {};
  if (!HostelAllocation || !Hostel) throw new Error("Hostel allocation service is unavailable.");
  if (!isValidId(allocationId)) throw new Error("Invalid hostel allocation.");
  const allocation = await HostelAllocation.findOneAndUpdate(
    { _id: allocationId, status: "active", isDeleted: { $ne: true } },
    { $set: { status: "vacated", checkOutDate: new Date(), updatedBy: actorId } },
    { new: true }
  );
  if (!allocation) throw new Error("Active hostel allocation not found.");
  await releaseRoom(Hostel, allocation.hostel || allocation.room, actorId);
  return allocation;
}

module.exports = {
  APPLICATION_STATUSES,
  ROOM_STATUSES,
  MAINTENANCE_STATUSES,
  str,
  escapeRegex,
  exactRegex,
  isValidId,
  actorUserId,
  studentName,
  currentAcademicYear,
  currentTerm,
  normalizeGender,
  genderCompatible,
  makeCode,
  uniqueCode,
  applicationTransitionAllowed,
  resolveStudent,
  notifyStudent,
  createApplication,
  setApplicationStatus,
  claimRoom,
  releaseRoom,
  allocateStudent,
  vacateAllocation,
};

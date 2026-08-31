const {
  uniqueCode,
  str,
  exactRegex,
  currentAcademicYear,
  currentTerm,
  studentName,
} = require("../../src/services/tenant/hostelService");

async function findStudent(Student, legacy = {}) {
  if (!Student) return null;
  const regNo = str(legacy.regNo, 80);
  if (regNo) {
    const byReg = await Student.findOne({ regNo: exactRegex(regNo), isDeleted: { $ne: true } });
    if (byReg) return byReg;
  }
  const name = str(legacy.studentName, 160);
  if (!name) return null;
  const rows = await Student.find({
    isDeleted: { $ne: true },
    fullName: exactRegex(name),
  }).limit(2);
  return rows.length === 1 ? rows[0] : null;
}

async function repairRoomIds(Hostel) {
  const rooms = await Hostel.find({}).sort({ createdAt: 1, _id: 1 });
  const counts = new Map();
  for (const room of rooms) {
    const id = str(room.roomId, 80);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const kept = new Set();
  let repaired = 0;
  for (const room of rooms) {
    const id = str(room.roomId, 80);
    const duplicate = id && (counts.get(id) || 0) > 1;
    if (id && (!duplicate || !kept.has(id))) {
      kept.add(id);
      continue;
    }
    room.roomId = await uniqueCode(Hostel, "roomId", "HRM", room.createdAt || new Date());
    await room.save();
    repaired += 1;
  }
  return { rooms, repaired };
}

async function migrateLegacyApplications(models, rooms) {
  const { HostelApplication, Student } = models;
  if (!HostelApplication || !Student) return { migrated: 0, unresolved: 0 };
  let migrated = 0;
  let unresolved = 0;

  for (const room of rooms) {
    for (const legacy of room.applications || []) {
      const legacyId = str(legacy?._id, 80);
      if (legacyId && await HostelApplication.exists({ legacyEmbeddedId: legacyId })) continue;
      const student = await findStudent(Student, legacy);
      if (!student) {
        unresolved += 1;
        continue;
      }
      let applicationId = str(legacy.applicationId, 80).toUpperCase();
      if (!applicationId || await HostelApplication.exists({ applicationId })) {
        applicationId = await uniqueCode(HostelApplication, "applicationId", "HAPP", legacy.submittedAt || room.createdAt || new Date());
      }
      const status = ["Pending", "Approved", "Denied", "Waitlist"].includes(legacy.status) ? legacy.status : "Pending";
      const hasCurrent = await HostelApplication.exists({ student: student._id, isCurrent: true, isDeleted: { $ne: true } });
      await HostelApplication.create({
        applicationId,
        student: student._id,
        studentId: student._id,
        hostel: room._id,
        room: room._id,
        studentName: studentName(student),
        regNo: str(student.regNo, 80),
        roomCode: str(room.code, 80),
        block: str(room.block, 120),
        preference: str(legacy.preference || room.type, 300),
        notes: str(legacy.note, 1500),
        status,
        isCurrent: !hasCurrent && ["Pending", "Approved", "Waitlist"].includes(status),
        submittedAt: legacy.submittedAt || room.createdAt || new Date(),
        decidedAt: ["Approved", "Denied", "Waitlist"].includes(status) ? (legacy.updatedAt || room.updatedAt || new Date()) : null,
        legacyEmbeddedId: legacyId,
      });
      migrated += 1;
    }
  }
  return { migrated, unresolved };
}

async function migrateLegacyCheckins(models, rooms) {
  const { HostelAllocation, Student } = models;
  if (!HostelAllocation || !Student) return { migrated: 0, unresolved: 0 };
  let migrated = 0;
  let unresolved = 0;

  for (const room of rooms) {
    for (const legacy of room.checkins || []) {
      const legacyId = str(legacy?._id, 80);
      if (legacyId && await HostelAllocation.exists({ legacyCheckinId: legacyId })) continue;
      const student = await findStudent(Student, legacy);
      if (!student) {
        if (legacy.status === "Checked-in") unresolved += 1;
        continue;
      }
      const status = legacy.status === "Checked-out" ? "vacated" : "active";
      if (status === "active") {
        const other = await HostelAllocation.findOne({ student: student._id, status: "active", isDeleted: { $ne: true } }).lean();
        if (other) {
          if (String(other.hostel || other.room) === String(room._id)) continue;
          unresolved += 1;
          continue;
        }
      }
      await HostelAllocation.create({
        student: student._id,
        studentId: student._id,
        hostel: room._id,
        room: room._id,
        studentName: studentName(student),
        regNo: str(student.regNo, 80),
        roomCode: str(room.code, 80),
        block: str(room.block, 120),
        academicYear: currentAcademicYear(student, legacy.checkInDate || room.createdAt || new Date()),
        semester: currentTerm(student),
        checkInDate: legacy.checkInDate || room.createdAt || new Date(),
        checkOutDate: status === "vacated" ? (legacy.checkOutDate || legacy.updatedAt || new Date()) : null,
        status,
        notes: str(legacy.note, 1000),
        legacyCheckinId: legacyId,
      });
      migrated += 1;
    }
  }
  return { migrated, unresolved };
}

async function normalizeExistingAllocations(models) {
  const { HostelAllocation, Hostel } = models;
  if (!HostelAllocation || !Hostel) return 0;
  const rows = await HostelAllocation.find({});
  let normalized = 0;
  for (const row of rows) {
    const patch = {};
    if (!row.student && row.studentId) patch.student = row.studentId;
    if (!row.studentId && row.student) patch.studentId = row.student;
    let roomId = row.hostel || row.room;
    if (roomId && await Hostel.exists({ _id: roomId })) {
      if (!row.hostel) patch.hostel = roomId;
      if (!row.room || String(row.room) !== String(roomId)) patch.room = roomId;
      const room = await Hostel.findById(roomId).lean();
      if (room) {
        if (!row.roomCode) patch.roomCode = str(room.code, 80);
        if (!row.block) patch.block = str(room.block, 120);
      }
    }
    if (Object.keys(patch).length) {
      await HostelAllocation.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }
  return normalized;
}

async function syncOccupancy(models, rooms) {
  const { Hostel, HostelAllocation, Student } = models;
  if (!Hostel || !HostelAllocation) return { roomsSynced: 0, unresolvedActive: 0 };
  let roomsSynced = 0;
  let unresolvedActive = 0;
  for (const room of rooms) {
    const canonical = await HostelAllocation.countDocuments({ hostel: room._id, status: "active", isDeleted: { $ne: true } });
    let unresolved = 0;
    for (const legacy of room.checkins || []) {
      if (legacy.status !== "Checked-in") continue;
      const student = await findStudent(Student, legacy);
      if (!student) unresolved += 1;
    }
    unresolvedActive += unresolved;
    const occupied = canonical + unresolved;
    const patch = { occupied };
    if (!["Maintenance", "Closed"].includes(room.status)) patch.status = occupied >= Number(room.beds || 1) ? "Full" : "Available";
    await Hostel.updateOne({ _id: room._id }, { $set: patch });
    roomsSynced += 1;
  }
  return { roomsSynced, unresolvedActive };
}

async function dropLegacyAllocationIndex(HostelAllocation) {
  if (!HostelAllocation) return 0;
  let dropped = 0;
  const indexes = await HostelAllocation.collection.indexes().catch(() => []);
  for (const index of indexes) {
    const keys = Object.keys(index.key || {});
    if (index.unique && keys.includes("academicYear") && keys.includes("semester") && keys.includes("student")) {
      await HostelAllocation.collection.dropIndex(index.name).catch(() => null);
      dropped += 1;
    }
  }
  return dropped;
}

async function migrateHostels(models = {}) {
  const { Hostel } = models;
  if (!Hostel) return {
    rooms: 0, repairedRoomIds: 0, applicationsMigrated: 0, allocationsMigrated: 0,
    unresolvedApplications: 0, unresolvedCheckins: 0, allocationsNormalized: 0, roomsSynced: 0,
    unresolvedActive: 0, legacyIndexesDropped: 0,
  };

  const legacyIndexesDropped = await dropLegacyAllocationIndex(models.HostelAllocation);
  const roomResult = await repairRoomIds(Hostel);
  const applications = await migrateLegacyApplications(models, roomResult.rooms);
  const checkins = await migrateLegacyCheckins(models, roomResult.rooms);
  const allocationsNormalized = await normalizeExistingAllocations(models);
  const occupancy = await syncOccupancy(models, roomResult.rooms);

  return {
    rooms: roomResult.rooms.length,
    repairedRoomIds: roomResult.repaired,
    applicationsMigrated: applications.migrated,
    allocationsMigrated: checkins.migrated,
    unresolvedApplications: applications.unresolved,
    unresolvedCheckins: checkins.unresolved,
    allocationsNormalized,
    roomsSynced: occupancy.roomsSynced,
    unresolvedActive: occupancy.unresolvedActive,
    legacyIndexesDropped,
  };
}

module.exports = { migrateHostels, findStudent, repairRoomIds, dropLegacyAllocationIndex };

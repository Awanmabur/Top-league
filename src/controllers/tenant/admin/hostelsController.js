const {
  str,
  escapeRegex,
  isValidId,
  actorUserId,
  uniqueCode,
  resolveStudent,
  notifyStudent,
  setApplicationStatus,
  allocateStudent,
  vacateAllocation,
  MAINTENANCE_STATUSES,
  ROOM_STATUSES,
} = require("../../../services/tenant/hostelService");

const GENDERS = ["Male", "Female", "Mixed"];
const ROOM_TYPES = ["Standard", "Premium", "VIP"];
const PRIORITIES = ["Normal", "High", "Urgent"];

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function safeRegex(value) {
  const clean = str(value, 120);
  return clean ? new RegExp(escapeRegex(clean), "i") : null;
}

function roomPayload(body = {}) {
  const gender = str(body.gender, 30);
  const type = str(body.type, 30);
  const status = str(body.status, 30);
  return {
    block: str(body.block, 120),
    code: str(body.code, 80).toUpperCase(),
    gender: GENDERS.includes(gender) ? gender : "Mixed",
    type: ROOM_TYPES.includes(type) ? type : "Standard",
    beds: Math.max(1, Math.min(100, Math.floor(num(body.beds, 1)))),
    pricePerSemester: Math.max(0, num(body.pricePerSemester, 0)),
    status: ROOM_STATUSES.includes(status) ? status : "Available",
    warden: str(body.warden, 160),
    notes: str(body.notes, 1500),
  };
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function readPolicy(Setting) {
  if (!Setting) return { applicationsOpen: true, policyText: "", checkInInstructions: "", contact: "" };
  const row = await Setting.findOne({ key: "hostel_policy", isDeleted: { $ne: true } }).lean().catch(() => null);
  const value = row?.value && typeof row.value === "object" ? row.value : {};
  return {
    applicationsOpen: value.applicationsOpen !== false,
    policyText: str(value.policyText, 5000),
    checkInInstructions: str(value.checkInInstructions, 3000),
    contact: str(value.contact, 300),
  };
}

async function loadHostelData(req) {
  const { Hostel, HostelApplication, HostelAllocation, Student, Setting } = req.models || {};
  if (!Hostel) throw new Error("Hostel model is unavailable.");

  const q = str(req.query.q, 120);
  const block = str(req.query.block || "all", 120);
  const gender = str(req.query.gender || "all", 30);
  const status = str(req.query.status || "all", 30);
  const view = str(req.query.view || "rooms", 30) || "rooms";

  const filter = {};
  const rx = safeRegex(q);
  if (rx) {
    filter.$or = ["code", "block", "gender", "type", "status", "warden"].map((field) => ({ [field]: rx }));
  }
  if (block !== "all") filter.block = block;
  if (gender !== "all") filter.gender = gender;
  if (status !== "all") filter.status = status;

  const [rooms, allRooms, applicationsRaw, allocationsRaw, studentDocs, policy] = await Promise.all([
    Hostel.find(filter).sort({ block: 1, code: 1 }).lean(),
    Hostel.find({}).sort({ block: 1, code: 1 }).lean(),
    HostelApplication
      ? HostelApplication.find({ isDeleted: { $ne: true } }).sort({ submittedAt: -1, createdAt: -1 }).lean()
      : [],
    HostelAllocation
      ? HostelAllocation.find({ isDeleted: { $ne: true } }).sort({ checkInDate: -1, createdAt: -1 }).lean()
      : [],
    Student
      ? Student.find({ isDeleted: { $ne: true }, status: { $ne: "archived" } })
          .select("_id fullName firstName middleName lastName regNo gender academicYear term userId")
          .sort({ fullName: 1, regNo: 1 })
          .lean()
      : [],
    readPolicy(Setting),
  ]);

  const roomById = new Map(allRooms.map((room) => [String(room._id), room]));
  const studentById = new Map(studentDocs.map((student) => [String(student._id), student]));

  const applications = applicationsRaw.map((application) => {
    const room = roomById.get(String(application.hostel || application.room)) || {};
    const student = studentById.get(String(application.student || application.studentId)) || {};
    return {
      ...application,
      roomMongoId: String(room._id || application.hostel || application.room || ""),
      roomCode: application.roomCode || room.code || "—",
      roomBlock: application.block || room.block || "—",
      studentName:
        application.studentName ||
        student.fullName ||
        [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") ||
        "Student",
      regNo: application.regNo || student.regNo || "",
    };
  });

  const checkins = allocationsRaw.map((allocation) => {
    const room = roomById.get(String(allocation.hostel || allocation.room)) || {};
    const student = studentById.get(String(allocation.student || allocation.studentId)) || {};
    return {
      ...allocation,
      allocationId: String(allocation._id),
      roomMongoId: String(room._id || allocation.hostel || allocation.room || ""),
      roomCode: allocation.roomCode || room.code || "—",
      roomBlock: allocation.block || room.block || "—",
      studentName:
        allocation.studentName ||
        student.fullName ||
        [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") ||
        "Student",
      regNo: allocation.regNo || student.regNo || "",
      statusLabel: allocation.status === "active" ? "Checked-in" : "Checked-out",
    };
  });

  const maintenance = allRooms.flatMap((room) =>
    (room.maintenanceTickets || []).map((ticket) => ({
      ...(ticket?.toObject ? ticket.toObject() : ticket),
      roomMongoId: String(room._id),
      roomCode: room.code,
      roomBlock: room.block,
    }))
  );
  const discipline = allRooms.flatMap((room) =>
    (room.disciplineCases || []).map((row) => ({ ...row, roomMongoId: String(room._id), roomCode: room.code, roomBlock: room.block }))
  );
  const fees = allRooms.flatMap((room) =>
    (room.feeReceipts || []).map((row) => ({ ...row, roomMongoId: String(room._id), roomCode: room.code, roomBlock: room.block }))
  );

  const applicationCounts = new Map();
  for (const application of applicationsRaw) {
    const key = String(application.hostel || application.room || "");
    applicationCounts.set(key, (applicationCounts.get(key) || 0) + 1);
  }
  const allocationCounts = new Map();
  for (const allocation of allocationsRaw) {
    const key = String(allocation.hostel || allocation.room || "");
    allocationCounts.set(key, (allocationCounts.get(key) || 0) + 1);
  }
  for (const room of [...rooms, ...allRooms]) {
    const key = String(room._id);
    room._applicationCount = applicationCounts.get(key) || 0;
    room._allocationCount = allocationCounts.get(key) || 0;
  }

  const blocks = [...new Set(allRooms.map((room) => room.block).filter(Boolean))].sort();
  const activeAllocations = allocationsRaw.filter((allocation) => allocation.status === "active");
  const kpis = {
    rooms: allRooms.length,
    beds: allRooms.reduce((sum, room) => sum + Number(room.beds || 0), 0),
    occupied: activeAllocations.length,
    applications: applicationsRaw.filter((application) => ["Pending", "Waitlist"].includes(application.status)).length,
  };

  return {
    query: { q, block, gender, status, view },
    blocks,
    rooms,
    allRooms,
    applications,
    checkins,
    maintenance,
    discipline,
    fees,
    students: studentDocs.map((student) => ({
      id: String(student._id),
      name: student.fullName || [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") || student.regNo,
      regNo: student.regNo || "",
    })),
    policy,
    kpis,
  };
}

exports.index = async (req, res) => {
  try {
    const data = await loadHostelData(req);
    return res.render("tenant/hostels/index", {
      title: "Hostels",
      tenant: req.tenant || null,
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      ...data,
      helpers: { formatDate },
    });
  } catch (error) {
    console.error("hostelsController.index error:", error);
    req.flash?.("error", "Failed to load hostels page.");
    return res.redirect("/admin/dashboard");
  }
};

exports.createRoom = async (req, res) => {
  try {
    const { Hostel } = req.models || {};
    const payload = roomPayload(req.body);
    if (!Hostel) throw new Error("Hostel model is unavailable.");
    if (!payload.block || !payload.code) throw new Error("Block and room code are required.");
    if (await Hostel.exists({ code: payload.code })) throw new Error("A room with that code already exists.");
    const roomId = await uniqueCode(Hostel, "roomId", "HRM");
    await Hostel.create({ roomId, ...payload, occupied: 0, createdBy: actorUserId(req), updatedBy: actorUserId(req) });
    req.flash?.("success", "Room created successfully.");
  } catch (error) {
    req.flash?.("error", error?.message || "Failed to create room.");
  }
  return res.redirect("/admin/hostels");
};

exports.updateRoom = async (req, res) => {
  try {
    const { Hostel, HostelAllocation } = req.models || {};
    if (!Hostel || !isValidId(req.params.id)) throw new Error("Room not found.");
    const payload = roomPayload(req.body);
    if (!payload.block || !payload.code) throw new Error("Block and room code are required.");
    const room = await Hostel.findById(req.params.id);
    if (!room) throw new Error("Room not found.");
    if (await Hostel.exists({ _id: { $ne: room._id }, code: payload.code })) throw new Error("Another room already uses that code.");
    const activeCount = HostelAllocation
      ? await HostelAllocation.countDocuments({ hostel: room._id, status: "active", isDeleted: { $ne: true } })
      : Number(room.occupied || 0);
    if (payload.beds < activeCount) throw new Error(`Capacity cannot be lower than ${activeCount} active allocation(s).`);
    if (["Maintenance", "Closed"].includes(payload.status) && activeCount > 0) {
      throw new Error("Vacate active residents before closing a room or placing it into maintenance.");
    }
    Object.assign(room, payload, { occupied: activeCount, updatedBy: actorUserId(req) });
    if (activeCount >= payload.beds && !["Maintenance", "Closed"].includes(room.status)) room.status = "Full";
    if (activeCount < payload.beds && room.status === "Full") room.status = "Available";
    await room.save();
    req.flash?.("success", "Room updated successfully.");
  } catch (error) {
    req.flash?.("error", error?.message || "Failed to update room.");
  }
  return res.redirect("/admin/hostels");
};

exports.allocateStudent = async (req, res) => {
  try {
    const student = await resolveStudent(req.models, req.body);
    const result = await allocateStudent(req.models, {
      student,
      roomId: req.params.id,
      bedLabel: req.body.bedLabel,
      note: req.body.note,
      applicationId: req.body.applicationId,
      actorUserId: actorUserId(req),
    });
    await notifyStudent(req.models, student, {
      title: "Hostel allocation confirmed",
      message: `You have been allocated to ${result.room.block} • ${result.room.code}.`,
      type: "success",
      entityType: "HostelAllocation",
      entityId: result.allocation._id,
      createdBy: actorUserId(req),
    });
    req.flash?.("success", "Student assigned successfully.");
  } catch (error) {
    req.flash?.("error", error?.message || "Failed to assign student.");
  }
  return res.redirect("/admin/hostels?view=allocations");
};

exports.vacateStudent = async (req, res) => {
  try {
    const { HostelAllocation, Student } = req.models || {};
    const allocation = HostelAllocation && isValidId(req.params.allocationId)
      ? await HostelAllocation.findById(req.params.allocationId)
      : null;
    if (!allocation) throw new Error("Active hostel allocation not found.");
    const student = Student ? await Student.findById(allocation.student || allocation.studentId) : null;
    const result = await vacateAllocation(req.models, allocation._id, actorUserId(req));
    if (student) {
      await notifyStudent(req.models, student, {
        title: "Hostel check-out recorded",
        message: `Your check-out from ${allocation.block || allocation.roomCode || "the hostel"} has been recorded.`,
        entityType: "HostelAllocation",
        entityId: result._id,
        createdBy: actorUserId(req),
      });
    }
    req.flash?.("success", "Student checked out successfully.");
  } catch (error) {
    req.flash?.("error", error?.message || "Failed to check out student.");
  }
  return res.redirect("/admin/hostels?view=checkin");
};

exports.createMaintenanceTicket = async (req, res) => {
  try {
    const { Hostel } = req.models || {};
    if (!Hostel || !isValidId(req.params.id)) throw new Error("Room not found.");
    const room = await Hostel.findById(req.params.id);
    if (!room) throw new Error("Room not found.");
    const issue = str(req.body.issue, 1000);
    if (!issue) throw new Error("Issue description is required.");
    const priority = PRIORITIES.includes(str(req.body.priority, 30)) ? str(req.body.priority, 30) : "Normal";
    const ticketId = `MT-${require("crypto").randomBytes(5).toString("hex").toUpperCase()}`;
    room.maintenanceTickets.unshift({
      ticketId,
      roomCode: room.code,
      issue,
      priority,
      status: "Open",
      note: str(req.body.note, 1500),
      createdAt: new Date(),
    });
    room.updatedBy = actorUserId(req);
    await room.save();
    req.flash?.("success", "Maintenance ticket created.");
  } catch (error) {
    req.flash?.("error", error?.message || "Failed to create maintenance ticket.");
  }
  return res.redirect("/admin/hostels?view=maintenance");
};

exports.updateMaintenanceStatus = async (req, res) => {
  try {
    const { Hostel } = req.models || {};
    const nextStatus = str(req.body.status, 30);
    if (!MAINTENANCE_STATUSES.includes(nextStatus)) throw new Error("Invalid maintenance status.");
    if (!Hostel || !isValidId(req.params.roomId) || !isValidId(req.params.ticketId)) throw new Error("Maintenance ticket not found.");
    const room = await Hostel.findById(req.params.roomId);
    if (!room) throw new Error("Room not found.");
    const ticket = room.maintenanceTickets.id(req.params.ticketId);
    if (!ticket) throw new Error("Maintenance ticket not found.");
    ticket.status = nextStatus;
    room.updatedBy = actorUserId(req);
    await room.save();
    req.flash?.("success", "Maintenance status updated.");
  } catch (error) {
    req.flash?.("error", error?.message || "Failed to update maintenance status.");
  }
  return res.redirect("/admin/hostels?view=maintenance");
};

exports.changeApplicationStatus = async (req, res) => {
  try {
    const { HostelApplication, Student } = req.models || {};
    if (!HostelApplication || !isValidId(req.params.applicationId)) throw new Error("Application not found.");
    const application = await HostelApplication.findOne({ _id: req.params.applicationId, isDeleted: { $ne: true } });
    if (!application) throw new Error("Application not found.");
    if (req.params.roomId && String(application.hostel || application.room) !== String(req.params.roomId)) {
      throw new Error("Application does not belong to that room.");
    }
    await setApplicationStatus(req.models, application, req.body.status, actorUserId(req));
    const student = Student ? await Student.findById(application.student || application.studentId) : null;
    if (student) {
      await notifyStudent(req.models, student, {
        title: "Hostel application updated",
        message: `Your hostel application ${application.applicationId} is now ${application.status}.`,
        type: application.status === "Denied" ? "warning" : "info",
        entityType: "HostelApplication",
        entityId: application._id,
        createdBy: actorUserId(req),
      });
    }
    req.flash?.("success", `Application marked ${application.status}.`);
  } catch (error) {
    req.flash?.("error", error?.message || "Failed to update application.");
  }
  return res.redirect("/admin/hostels?view=applications");
};

exports.savePolicies = async (req, res) => {
  try {
    const { Setting } = req.models || {};
    if (!Setting) throw new Error("Settings model is unavailable.");
    const value = {
      applicationsOpen: String(req.body.applicationsOpen || "") === "on",
      policyText: str(req.body.policyText, 5000),
      checkInInstructions: str(req.body.checkInInstructions, 3000),
      contact: str(req.body.contact, 300),
    };
    await Setting.findOneAndUpdate(
      { key: "hostel_policy" },
      { $set: { value, updatedBy: actorUserId(req), isDeleted: false, deletedAt: null }, $setOnInsert: { key: "hostel_policy", createdBy: actorUserId(req) } },
      { upsert: true, new: true }
    );
    req.flash?.("success", "Hostel policies saved.");
  } catch (error) {
    req.flash?.("error", error?.message || "Failed to save hostel policies.");
  }
  return res.redirect("/admin/hostels");
};

exports.exportCsv = async (req, res) => {
  try {
    const data = await loadHostelData(req);
    const rows = [["Record Type", "Reference", "Student", "Registration No", "Block", "Room", "Status", "Amount/Capacity", "Date/Notes"]];
    data.rooms.forEach((room) => rows.push(["Room", room.roomId || room._id, "", "", room.block, room.code, room.status, `${room.occupied || 0}/${room.beds || 0}`, room.notes || ""]));
    data.applications.forEach((app) => rows.push(["Application", app.applicationId || app._id, app.studentName, app.regNo, app.roomBlock, app.roomCode, app.status, "", formatDate(app.submittedAt)]));
    data.checkins.forEach((row) => rows.push(["Allocation", row._id, row.studentName, row.regNo, row.roomBlock, row.roomCode, row.statusLabel, "", `${formatDate(row.checkInDate)}${row.checkOutDate ? ` → ${formatDate(row.checkOutDate)}` : ""}`]));
    data.maintenance.forEach((row) => rows.push(["Maintenance", row.ticketId || row._id, "", "", row.roomBlock, row.roomCode, row.status, row.priority, row.issue || ""]));
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="hostel-report-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\uFEFF${csv}`);
  } catch (error) {
    return res.status(500).send(error?.message || "Failed to export hostel report.");
  }
};

exports.report = async (req, res) => {
  try {
    const data = await loadHostelData(req);
    return res.render("tenant/hostels/report", {
      title: "Hostel Report",
      tenant: req.tenant || null,
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      ...data,
      helpers: { formatDate },
    });
  } catch (error) {
    req.flash?.("error", error?.message || "Failed to load hostel report.");
    return res.redirect("/admin/hostels");
  }
};

exports._test = { roomPayload, safeRegex, csvCell, readPolicy, loadHostelData };

const HostelModel = require("../../../models/tenant/Hostel");

function actorUserId(req) {
  return req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
}

function safe(v) {
  return v == null ? "" : String(v).trim();
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatDate(v) {
  if (!v) return "â€”";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "â€”";
  return d.toISOString().slice(0, 10);
}

function getHostel(req) {
  const conn = req.tenantDb || req.db || req.tenantConnection;
  if (!conn) throw new Error("Tenant DB connection not found on request");
  return HostelModel(conn);
}

function generateCode(prefix) {
  return `${prefix}${Math.floor(100000 + Math.random() * 900000)}`;
}

function roomPayload(body) {
  return {
    block: safe(body.block),
    code: safe(body.code).toUpperCase(),
    gender: safe(body.gender) || "Mixed",
    type: safe(body.type) || "Standard",
    beds: Math.max(1, num(body.beds, 1)),
    pricePerSemester: Math.max(0, num(body.pricePerSemester, 0)),
    status: safe(body.status) || "Available",
    warden: safe(body.warden),
    notes: safe(body.notes),
  };
}

exports.index = async (req, res) => {
  try {
    const Hostel = getHostel(req);

    const q = safe(req.query.q);
    const block = safe(req.query.block) || "all";
    const gender = safe(req.query.gender) || "all";
    const status = safe(req.query.status) || "all";
    const view = safe(req.query.view) || "rooms";

    const filter = {};

    if (q) {
      filter.$or = [
        { code: { $regex: q, $options: "i" } },
        { block: { $regex: q, $options: "i" } },
        { gender: { $regex: q, $options: "i" } },
        { type: { $regex: q, $options: "i" } },
        { status: { $regex: q, $options: "i" } },
        { warden: { $regex: q, $options: "i" } },
      ];
    }

    if (block !== "all") filter.block = block;
    if (gender !== "all") filter.gender = gender;
    if (status !== "all") filter.status = status;

    const rooms = await Hostel.find(filter).sort({ block: 1, code: 1 }).lean();
    const allRooms = await Hostel.find({}).sort({ block: 1, code: 1 }).lean();

    const blocks = [...new Set(allRooms.map((r) => r.block).filter(Boolean))].sort();

    const applications = allRooms.flatMap((room) =>
      (room.applications || []).map((a) => ({
        ...a,
        roomMongoId: String(room._id),
        roomCode: room.code,
        roomBlock: room.block,
      }))
    );

    const checkins = allRooms.flatMap((room) =>
      (room.checkins || []).map((c) => ({
        ...c,
        roomMongoId: String(room._id),
        roomCode: room.code,
        roomBlock: room.block,
      }))
    );

    const maintenance = allRooms.flatMap((room) =>
      (room.maintenanceTickets || []).map((m) => ({
        ...m,
        roomMongoId: String(room._id),
        roomCode: room.code,
        roomBlock: room.block,
      }))
    );

    const discipline = allRooms.flatMap((room) =>
      (room.disciplineCases || []).map((d) => ({
        ...d,
        roomMongoId: String(room._id),
        roomCode: room.code,
        roomBlock: room.block,
      }))
    );

    const fees = allRooms.flatMap((room) =>
      (room.feeReceipts || []).map((f) => ({
        ...f,
        roomMongoId: String(room._id),
        roomCode: room.code,
        roomBlock: room.block,
      }))
    );

    const kpis = {
      rooms: allRooms.length,
      beds: allRooms.reduce((sum, r) => sum + (r.beds || 0), 0),
      occupied: allRooms.reduce((sum, r) => sum + (r.occupied || 0), 0),
      applications: applications.filter((a) => a.status === "Pending").length,
    };

    return res.render("tenant/hostels/index", {
      title: "Hostels",
      tenant: req.tenant || null,
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      query: { q, block, gender, status, view },
      blocks,
      rooms,
      applications,
      checkins,
      maintenance,
      discipline,
      fees,
      kpis,
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
    const Hostel = getHostel(req);
    const payload = roomPayload(req.body);

    if (!payload.block || !payload.code) {
      req.flash?.("error", "Block and room code are required.");
      return res.redirect("/admin/hostels");
    }

    const exists = await Hostel.findOne({ code: payload.code }).lean();
    if (exists) {
      req.flash?.("error", "A room with that code already exists.");
      return res.redirect("/admin/hostels");
    }

    await Hostel.create({
      roomId: generateCode("RM"),
      ...payload,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Room created successfully.");
    return res.redirect("/admin/hostels");
  } catch (error) {
    console.error("hostelsController.createRoom error:", error);
    req.flash?.("error", "Failed to create room.");
    return res.redirect("/admin/hostels");
  }
};

exports.updateRoom = async (req, res) => {
  try {
    const Hostel = getHostel(req);
    const { id } = req.params;
    const payload = roomPayload(req.body);

    if (!payload.block || !payload.code) {
      req.flash?.("error", "Block and room code are required.");
      return res.redirect("/admin/hostels");
    }

    const room = await Hostel.findById(id);
    if (!room) {
      req.flash?.("error", "Room not found.");
      return res.redirect("/admin/hostels");
    }

    const duplicate = await Hostel.findOne({
      _id: { $ne: id },
      code: payload.code,
    }).lean();

    if (duplicate) {
      req.flash?.("error", "Another room already uses that code.");
      return res.redirect("/admin/hostels");
    }

    room.block = payload.block;
    room.code = payload.code;
    room.gender = payload.gender;
    room.type = payload.type;
    room.beds = payload.beds;
    room.pricePerSemester = payload.pricePerSemester;
    room.status = payload.status;
    room.warden = payload.warden;
    room.notes = payload.notes;
    room.updatedBy = actorUserId(req);

    if (room.occupied > room.beds) {
      room.occupied = room.beds;
    }

    if (room.occupied >= room.beds && room.status === "Available") {
      room.status = "Full";
    }

    await room.save();

    req.flash?.("success", "Room updated successfully.");
    return res.redirect("/admin/hostels");
  } catch (error) {
    console.error("hostelsController.updateRoom error:", error);
    req.flash?.("error", "Failed to update room.");
    return res.redirect("/admin/hostels");
  }
};

exports.allocateStudent = async (req, res) => {
  try {
    const Hostel = getHostel(req);
    const { id } = req.params;

    const studentName = safe(req.body.studentName);
    const regNo = safe(req.body.regNo);
    const note = safe(req.body.note);

    const room = await Hostel.findById(id);
    if (!room) {
      req.flash?.("error", "Room not found.");
      return res.redirect("/admin/hostels?view=allocations");
    }

    if (!studentName) {
      req.flash?.("error", "Student name is required.");
      return res.redirect("/admin/hostels?view=allocations");
    }

    if (room.status === "Closed" || room.status === "Maintenance") {
      req.flash?.("error", "This room cannot receive allocations right now.");
      return res.redirect("/admin/hostels?view=allocations");
    }

    if (room.occupied >= room.beds) {
      req.flash?.("error", "This room is already full.");
      return res.redirect("/admin/hostels?view=allocations");
    }

    room.occupied += 1;
    room.status = room.occupied >= room.beds ? "Full" : "Available";

    room.checkins.unshift({
      checkinId: generateCode("CHK"),
      studentName,
      regNo,
      roomCode: room.code,
      checkInDate: new Date(),
      status: "Checked-in",
      note,
    });

    room.updatedBy = actorUserId(req);
    await room.save();

    req.flash?.("success", "Student assigned successfully.");
    return res.redirect("/admin/hostels?view=allocations");
  } catch (error) {
    console.error("hostelsController.allocateStudent error:", error);
    req.flash?.("error", "Failed to assign student.");
    return res.redirect("/admin/hostels?view=allocations");
  }
};

exports.createMaintenanceTicket = async (req, res) => {
  try {
    const Hostel = getHostel(req);
    const { id } = req.params;

    const room = await Hostel.findById(id);
    if (!room) {
      req.flash?.("error", "Room not found.");
      return res.redirect("/admin/hostels?view=maintenance");
    }

    const issue = safe(req.body.issue);
    if (!issue) {
      req.flash?.("error", "Issue description is required.");
      return res.redirect("/admin/hostels?view=maintenance");
    }

    room.maintenanceTickets.unshift({
      ticketId: generateCode("MT"),
      roomCode: room.code,
      issue,
      priority: safe(req.body.priority) || "Normal",
      status: safe(req.body.status) || "Open",
      note: safe(req.body.note),
      createdAt: new Date(),
    });

    if (room.status === "Available") {
      room.status = "Maintenance";
    }

    room.updatedBy = actorUserId(req);
    await room.save();

    req.flash?.("success", "Maintenance ticket created.");
    return res.redirect("/admin/hostels?view=maintenance");
  } catch (error) {
    console.error("hostelsController.createMaintenanceTicket error:", error);
    req.flash?.("error", "Failed to create maintenance ticket.");
    return res.redirect("/admin/hostels?view=maintenance");
  }
};

exports.changeApplicationStatus = async (req, res) => {
  try {
    const Hostel = getHostel(req);
    const { roomId, applicationId } = req.params;
    const newStatus = safe(req.body.status);

    const allowed = ["Pending", "Approved", "Denied", "Waitlist"];
    if (!allowed.includes(newStatus)) {
      req.flash?.("error", "Invalid application status.");
      return res.redirect("/admin/hostels?view=applications");
    }

    const room = await Hostel.findById(roomId);
    if (!room) {
      req.flash?.("error", "Room not found.");
      return res.redirect("/admin/hostels?view=applications");
    }

    const application = room.applications.id(applicationId);
    if (!application) {
      req.flash?.("error", "Application not found.");
      return res.redirect("/admin/hostels?view=applications");
    }

    application.status = newStatus;
    application.note = safe(req.body.note) || application.note;
    room.updatedBy = actorUserId(req);

    await room.save();

    req.flash?.("success", "Application status updated.");
    return res.redirect("/admin/hostels?view=applications");
  } catch (error) {
    console.error("hostelsController.changeApplicationStatus error:", error);
    req.flash?.("error", "Failed to update application.");
    return res.redirect("/admin/hostels?view=applications");
  }
};

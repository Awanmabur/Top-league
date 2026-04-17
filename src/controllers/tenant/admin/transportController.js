function safe(value) {
  return String(value || "").trim();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function actorUserId(req) {
  return req.user?.userId || req.user?._id || null;
}

function payload(body) {
  return {
    routeName: safe(body.routeName),
    routeCode: safe(body.routeCode),
    vehicleName: safe(body.vehicleName),
    vehicleRegNo: safe(body.vehicleRegNo),
    driverName: safe(body.driverName),
    driverPhone: safe(body.driverPhone),
    pickupPoints: safe(body.pickupPoints)
      .split(/\r?\n|,/)
      .map((x) => x.trim())
      .filter(Boolean),
    feeAmount: Math.max(0, num(body.feeAmount, 0)),
    capacity: Math.max(0, num(body.capacity, 0)),
    assignedLearners: Math.max(0, num(body.assignedLearners, 0)),
    status: safe(body.status) || "active",
    notes: safe(body.notes),
  };
}

exports.index = async (req, res) => {
  const { Transport } = req.models || {};
  if (!Transport) return res.status(500).send("Transport model is not loaded.");

  const q = safe(req.query.q);
  const status = safe(req.query.status);
  const filter = {};

  if (q) {
    filter.$or = [
      { routeName: { $regex: q, $options: "i" } },
      { routeCode: { $regex: q, $options: "i" } },
      { vehicleName: { $regex: q, $options: "i" } },
      { vehicleRegNo: { $regex: q, $options: "i" } },
      { driverName: { $regex: q, $options: "i" } },
    ];
  }
  if (status) filter.status = status;

  const routes = await Transport.find(filter).sort({ routeName: 1 }).lean();
  const allRoutes = await Transport.find({}).select("status feeAmount capacity assignedLearners").lean();

  const kpis = {
    routes: allRoutes.length,
    active: allRoutes.filter((r) => r.status === "active").length,
    learners: allRoutes.reduce((sum, r) => sum + Number(r.assignedLearners || 0), 0),
    capacity: allRoutes.reduce((sum, r) => sum + Number(r.capacity || 0), 0),
  };

  return res.render("tenant/admin/transport/index", {
    tenant: req.tenant,
    query: { q, status },
    routes,
    kpis,
  });
};

exports.create = async (req, res) => {
  const { Transport } = req.models || {};
  if (!Transport) return res.status(500).send("Transport model is not loaded.");

  const data = payload(req.body);
  if (!data.routeName || !data.routeCode) {
    req.flash?.("error", "Route name and route code are required.");
    return res.redirect("/admin/transport");
  }

  try {
    await Transport.create({
      ...data,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });
    req.flash?.("success", "Transport route created.");
  } catch (err) {
    req.flash?.("error", err?.code === 11000 ? "Route code already exists." : "Failed to create route.");
  }
  return res.redirect("/admin/transport");
};

exports.update = async (req, res) => {
  const { Transport } = req.models || {};
  if (!Transport) return res.status(500).send("Transport model is not loaded.");

  const data = payload(req.body);
  if (!data.routeName || !data.routeCode) {
    req.flash?.("error", "Route name and route code are required.");
    return res.redirect("/admin/transport");
  }

  try {
    await Transport.updateOne(
      { _id: req.params.id },
      { $set: { ...data, updatedBy: actorUserId(req) } },
      { runValidators: true }
    );
    req.flash?.("success", "Transport route updated.");
  } catch (err) {
    req.flash?.("error", err?.code === 11000 ? "Route code already exists." : "Failed to update route.");
  }
  return res.redirect("/admin/transport");
};

exports.remove = async (req, res) => {
  const { Transport } = req.models || {};
  if (!Transport) return res.status(500).send("Transport model is not loaded.");

  await Transport.deleteOne({ _id: req.params.id });
  req.flash?.("success", "Transport route removed.");
  return res.redirect("/admin/transport");
};

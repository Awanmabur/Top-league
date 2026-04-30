const AssetModel = require("../../../models/tenant/Asset");

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

function getAsset(req) {
  const conn = req.tenantDb || req.db || req.tenantConnection;
  if (!conn) throw new Error("Tenant DB connection not found on request");
  return AssetModel(conn);
}

function generateCode(prefix) {
  return `${prefix}${Math.floor(100000 + Math.random() * 900000)}`;
}

function assetPayload(body) {
  return {
    assetTag: safe(body.assetTag).toUpperCase(),
    name: safe(body.name),
    category: safe(body.category) || "Other",
    brand: safe(body.brand),
    model: safe(body.model),
    serialNumber: safe(body.serialNumber),
    quantity: Math.max(1, num(body.quantity, 1)),
    unitCost: Math.max(0, num(body.unitCost, 0)),
    purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null,
    supplier: safe(body.supplier),
    location: safe(body.location),
    condition: safe(body.condition) || "Good",
    status: safe(body.status) || "Available",
    notes: safe(body.notes),
  };
}

exports.index = async (req, res) => {
  try {
    const Asset = getAsset(req);

    const q = safe(req.query.q);
    const category = safe(req.query.category) || "all";
    const status = safe(req.query.status) || "all";
    const condition = safe(req.query.condition) || "all";
    const view = safe(req.query.view) || "assets";

    const filter = {};

    if (q) {
      filter.$or = [
        { assetTag: { $regex: q, $options: "i" } },
        { name: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } },
        { location: { $regex: q, $options: "i" } },
        { supplier: { $regex: q, $options: "i" } },
        { serialNumber: { $regex: q, $options: "i" } },
      ];
    }

    if (category !== "all") filter.category = category;
    if (status !== "all") filter.status = status;
    if (condition !== "all") filter.condition = condition;

    const assets = await Asset.find(filter).sort({ createdAt: -1 }).lean();
    const allAssets = await Asset.find({}).sort({ createdAt: -1 }).lean();

    const categories = [...new Set(allAssets.map((a) => a.category).filter(Boolean))].sort();

    const assignments = allAssets.flatMap((asset) =>
      (asset.assignments || []).map((a) => ({
        ...a,
        assetMongoId: String(asset._id),
        assetTag: asset.assetTag,
        assetName: asset.name,
      }))
    );

    const maintenance = allAssets.flatMap((asset) =>
      (asset.maintenanceLogs || []).map((m) => ({
        ...m,
        assetMongoId: String(asset._id),
        assetTag: asset.assetTag,
        assetName: asset.name,
      }))
    );

    const movements = allAssets.flatMap((asset) =>
      (asset.movements || []).map((m) => ({
        ...m,
        assetMongoId: String(asset._id),
        assetTag: asset.assetTag,
        assetName: asset.name,
      }))
    ).sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalValue = allAssets.reduce((sum, a) => sum + ((a.unitCost || 0) * (a.quantity || 0)), 0);

    const kpis = {
      assets: allAssets.length,
      assigned: allAssets.filter((a) => a.status === "Assigned").length,
      maintenance: allAssets.filter((a) => a.status === "Maintenance").length,
      totalValue,
    };

    return res.render("tenant/assets/index", {
      title: "Assets",
      tenant: req.tenant || null,
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      query: { q, category, status, condition, view },
      categories,
      assets,
      assignments,
      maintenance,
      movements,
      kpis,
      helpers: { formatDate },
    });
  } catch (error) {
    console.error("assetsController.index error:", error);
    req.flash?.("error", "Failed to load assets page.");
    return res.redirect("/admin/dashboard");
  }
};

exports.createAsset = async (req, res) => {
  try {
    const Asset = getAsset(req);
    const payload = assetPayload(req.body);

    if (!payload.assetTag || !payload.name) {
      req.flash?.("error", "Asset tag and asset name are required.");
      return res.redirect("/admin/assets");
    }

    const exists = await Asset.findOne({ assetTag: payload.assetTag }).lean();
    if (exists) {
      req.flash?.("error", "An asset with that tag already exists.");
      return res.redirect("/admin/assets");
    }

    await Asset.create({
      assetId: generateCode("AST"),
      ...payload,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
      movements: [
        {
          type: "Created",
          actorName: req.user?.name || req.session?.tenantUser?.name || "System",
          note: "Asset created",
          date: new Date(),
        },
      ],
    });

    req.flash?.("success", "Asset created successfully.");
    return res.redirect("/admin/assets");
  } catch (error) {
    console.error("assetsController.createAsset error:", error);
    req.flash?.("error", "Failed to create asset.");
    return res.redirect("/admin/assets");
  }
};

exports.updateAsset = async (req, res) => {
  try {
    const Asset = getAsset(req);
    const { id } = req.params;
    const payload = assetPayload(req.body);

    if (!payload.assetTag || !payload.name) {
      req.flash?.("error", "Asset tag and asset name are required.");
      return res.redirect("/admin/assets");
    }

    const asset = await Asset.findById(id);
    if (!asset) {
      req.flash?.("error", "Asset not found.");
      return res.redirect("/admin/assets");
    }

    const duplicate = await Asset.findOne({
      _id: { $ne: id },
      assetTag: payload.assetTag,
    }).lean();

    if (duplicate) {
      req.flash?.("error", "Another asset already uses that tag.");
      return res.redirect("/admin/assets");
    }

    asset.assetTag = payload.assetTag;
    asset.name = payload.name;
    asset.category = payload.category;
    asset.brand = payload.brand;
    asset.model = payload.model;
    asset.serialNumber = payload.serialNumber;
    asset.quantity = payload.quantity;
    asset.unitCost = payload.unitCost;
    asset.purchaseDate = payload.purchaseDate;
    asset.supplier = payload.supplier;
    asset.location = payload.location;
    asset.condition = payload.condition;
    asset.status = payload.status;
    asset.notes = payload.notes;
    asset.updatedBy = actorUserId(req);

    asset.movements.unshift({
      type: "Updated",
      actorName: req.user?.name || req.session?.tenantUser?.name || "System",
      note: "Asset updated",
      date: new Date(),
    });

    await asset.save();

    req.flash?.("success", "Asset updated successfully.");
    return res.redirect("/admin/assets");
  } catch (error) {
    console.error("assetsController.updateAsset error:", error);
    req.flash?.("error", "Failed to update asset.");
    return res.redirect("/admin/assets");
  }
};

exports.assignAsset = async (req, res) => {
  try {
    const Asset = getAsset(req);
    const { id } = req.params;

    const assignedTo = safe(req.body.assignedTo);
    const assigneeType = safe(req.body.assigneeType) || "Staff";
    const dueBackAt = req.body.dueBackAt ? new Date(req.body.dueBackAt) : null;
    const note = safe(req.body.note);

    if (!assignedTo) {
      req.flash?.("error", "Assigned to is required.");
      return res.redirect("/admin/assets?view=assignments");
    }

    const asset = await Asset.findById(id);
    if (!asset) {
      req.flash?.("error", "Asset not found.");
      return res.redirect("/admin/assets?view=assignments");
    }

    if (asset.status === "Disposed") {
      req.flash?.("error", "Disposed assets cannot be assigned.");
      return res.redirect("/admin/assets?view=assignments");
    }

    asset.assignments.unshift({
      assignedTo,
      assigneeType,
      assignedAt: new Date(),
      dueBackAt,
      status: "Assigned",
      note,
    });

    asset.assignedCount += 1;
    asset.status = "Assigned";
    asset.updatedBy = actorUserId(req);

    asset.movements.unshift({
      type: "Assigned",
      actorName: req.user?.name || req.session?.tenantUser?.name || "System",
      note: `Assigned to ${assignedTo}`,
      date: new Date(),
    });

    await asset.save();

    req.flash?.("success", "Asset assigned successfully.");
    return res.redirect("/admin/assets?view=assignments");
  } catch (error) {
    console.error("assetsController.assignAsset error:", error);
    req.flash?.("error", "Failed to assign asset.");
    return res.redirect("/admin/assets?view=assignments");
  }
};

exports.createMaintenance = async (req, res) => {
  try {
    const Asset = getAsset(req);
    const { id } = req.params;

    const issue = safe(req.body.issue);
    const priority = safe(req.body.priority) || "Normal";
    const status = safe(req.body.status) || "Open";
    const note = safe(req.body.note);

    if (!issue) {
      req.flash?.("error", "Issue description is required.");
      return res.redirect("/admin/assets?view=maintenance");
    }

    const asset = await Asset.findById(id);
    if (!asset) {
      req.flash?.("error", "Asset not found.");
      return res.redirect("/admin/assets?view=maintenance");
    }

    asset.maintenanceLogs.unshift({
      ticketId: generateCode("MT"),
      issue,
      priority,
      status,
      openedAt: new Date(),
      note,
    });

    asset.status = "Maintenance";
    asset.updatedBy = actorUserId(req);

    asset.movements.unshift({
      type: "Maintenance",
      actorName: req.user?.name || req.session?.tenantUser?.name || "System",
      note: issue,
      date: new Date(),
    });

    await asset.save();

    req.flash?.("success", "Maintenance ticket created.");
    return res.redirect("/admin/assets?view=maintenance");
  } catch (error) {
    console.error("assetsController.createMaintenance error:", error);
    req.flash?.("error", "Failed to create maintenance ticket.");
    return res.redirect("/admin/assets?view=maintenance");
  }
};

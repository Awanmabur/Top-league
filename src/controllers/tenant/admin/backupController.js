const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function formatDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function pretty(obj) {
  try {
    return JSON.stringify(obj || {}, null, 2);
  } catch (_) {
    return "{}";
  }
}

function serializeBackup(doc) {
  return {
    id: String(doc._id),
    name: doc.name || "",
    type: doc.type || "Manual",
    scope: doc.scope || "Full System",
    storage: doc.storage || "Local",
    size: doc.sizeLabel || "—",
    status: doc.status || "Scheduled",
    createdAt: formatDateTime(doc.createdAt),
    retentionDays: Number(doc.retentionDays || 0),
    notes: doc.notes || "",
    metaPretty: pretty({
      checksum: doc.checksum || "",
      filePath: doc.filePath || "",
      createdBy: doc.createdBy || null,
      scheduleAt: doc.scheduleAt || null,
    }),
  };
}

function buildStats(backups) {
  let successful = 0;
  let scheduled = 0;
  let failed = 0;
  let totalBytes = 0;

  backups.forEach((b) => {
    if (b.status === "Completed") successful += 1;
    if (b.status === "Scheduled") scheduled += 1;
    if (b.status === "Failed") failed += 1;
    totalBytes += Number(b.sizeBytes || 0);
  });

  const gb = totalBytes / (1024 * 1024 * 1024);
  return {
    successful,
    scheduled,
    failed,
    storageUsed: `${gb ? gb.toFixed(2) : "0.00"} GB`,
  };
}

function buildStorageSummary(backups) {
  const bucket = new Map();

  backups.forEach((doc) => {
    const key = doc.storage || "Local";
    if (!bucket.has(key)) {
      bucket.set(key, {
        storage: key,
        count: 0,
        totalBytes: 0,
        completed: 0,
        failed: 0,
        latest: "—",
        latestDate: null,
      });
    }

    const row = bucket.get(key);
    row.count += 1;
    row.totalBytes += Number(doc.sizeBytes || 0);
    if (doc.status === "Completed") row.completed += 1;
    if (doc.status === "Failed") row.failed += 1;

    const d = doc.createdAt ? new Date(doc.createdAt) : null;
    if (d && !Number.isNaN(d.getTime()) && (!row.latestDate || d > row.latestDate)) {
      row.latestDate = d;
      row.latest = formatDateTime(doc.createdAt);
    }
  });

  return Array.from(bucket.values()).map((row) => ({
    storage: row.storage,
    count: row.count,
    totalSize: `${(row.totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`,
    completed: row.completed,
    failed: row.failed,
    latest: row.latest,
  }));
}

function buildRestoreHistory(backups) {
  const items = [];
  backups.forEach((doc) => {
    (doc.restoreHistory || []).forEach((r) => {
      items.push({
        backupName: doc.name || "",
        actor: r.actorName || "System",
        status: r.status || "Pending",
        scope: r.scope || doc.scope || "Full System",
        note: r.note || "",
        createdAt: formatDateTime(r.createdAt),
      });
    });
  });
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = {
  index: async (req, res) => {
    const { BackupJob } = req.models;

    const q = str(req.query.q);
    const status = str(req.query.status || "all");
    const type = str(req.query.type || "all");
    const storage = str(req.query.storage || "all");

    const query = { isDeleted: { $ne: true } };

    if (q) {
      query.$or = [
        { name: new RegExp(q, "i") },
        { notes: new RegExp(q, "i") },
        { type: new RegExp(q, "i") },
        { scope: new RegExp(q, "i") },
        { storage: new RegExp(q, "i") },
        { status: new RegExp(q, "i") },
      ];
    }

    if (status !== "all") query.status = status;
    if (type !== "all") query.type = type;
    if (storage !== "all") query.storage = storage;

    const docs = await BackupJob.find(query).sort({ createdAt: -1 }).lean();
    const backups = docs.map(serializeBackup);

    return res.render("tenant/admin/backup/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      backups,
      storageSummary: buildStorageSummary(docs),
      restoreHistory: buildRestoreHistory(docs),
      stats: buildStats(docs),
      query: { q, status, type, storage },
    });
  },

  create: async (req, res) => {
    const { BackupJob } = req.models;

    const name = str(req.body.name);
    if (!name) {
      req.flash?.("error", "Backup name is required.");
      return res.redirect("/admin/backup");
    }

    const scheduleAt = asDate(req.body.scheduleAt);
    const type = str(req.body.type || "Manual");
    const status = scheduleAt ? "Scheduled" : "Completed";

    await BackupJob.create({
      name,
      type,
      scope: str(req.body.scope || "Full System"),
      storage: str(req.body.storage || "Local"),
      retentionDays: Number(req.body.retentionDays || 30),
      scheduleAt,
      status,
      notes: str(req.body.notes || ""),
      sizeBytes: 0,
      sizeLabel: "0.00 GB",
      checksum: "",
      filePath: "",
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Backup job saved successfully.");
    return res.redirect("/admin/backup");
  },

  run: async (req, res) => {
    const { BackupJob } = req.models;
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ""))) {
      return res.redirect("/admin/backup");
    }

    await BackupJob.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          status: "Running",
          updatedBy: actorUserId(req),
        },
      }
    );

    return res.redirect("/admin/backup");
  },

  archive: async (req, res) => {
    const { BackupJob } = req.models;
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ""))) {
      return res.redirect("/admin/backup");
    }

    await BackupJob.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Archived", updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/backup");
  },

  delete: async (req, res) => {
    const { BackupJob } = req.models;
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ""))) {
      return res.redirect("/admin/backup");
    }

    await BackupJob.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/backup");
  },

  bulkAction: async (req, res) => {
    const { BackupJob } = req.models;

    const ids = String(req.body.ids || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => mongoose.Types.ObjectId.isValid(x));

    const action = str(req.body.action);
    if (!ids.length || !action) return res.redirect("/admin/backup");

    const patch = { updatedBy: actorUserId(req) };

    if (action === "run") {
      patch.status = "Running";
    } else if (action === "archive") {
      patch.status = "Archived";
    } else {
      return res.redirect("/admin/backup");
    }

    await BackupJob.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    return res.redirect("/admin/backup");
  },
};
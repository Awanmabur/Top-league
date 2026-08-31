function normalizeAudienceType(value) {
  const raw = String(value || "").trim();
  const aliases = {
    Students: "All Students",
    Staff: "All Staff",
    "Specific Class": "Specific Program",
    Program: "Specific Program",
    Subject: "Specific Subject",
    Cohort: "Year/Cohort",
  };
  const normalized = aliases[raw] || raw || "All Students";
  const allowed = ["All Students", "All Staff", "Specific Department", "Specific Program", "Specific Subject", "Year/Cohort"];
  return allowed.includes(normalized) ? normalized : "All Students";
}

async function migrateMessages(models = {}) {
  const { Message, MessageRecipient } = models;
  if (!Message || !MessageRecipient) return { scanned: 0, normalized: 0, recipientsMigrated: 0 };

  const rows = await Message.find({}).select(
    "_id audienceType status sentAt createdAt scheduleClaimedAt recipients"
  );
  let normalized = 0;
  let recipientsMigrated = 0;

  for (const row of rows) {
    const patch = {};
    const audienceType = normalizeAudienceType(row.audienceType);
    if (audienceType !== row.audienceType) patch.audienceType = audienceType;
    if (row.status === "Sent" && !row.sentAt) patch.sentAt = row.createdAt || new Date();
    if (row.scheduleClaimedAt) patch.scheduleClaimedAt = null;
    if (Object.keys(patch).length) {
      await Message.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }

    const embedded = Array.isArray(row.recipients) ? row.recipients : [];
    const ops = embedded.filter((r) => r?.userId).map((r) => ({
      updateOne: {
        filter: { messageId: row._id, userId: r.userId },
        update: {
          $setOnInsert: { messageId: row._id, userId: r.userId },
          $set: {
            name: String(r.name || "").trim(),
            email: String(r.email || "").trim().toLowerCase(),
            role: String(r.role || "").trim(),
            status: ["Pending", "Delivered", "Opened", "Failed"].includes(r.status) ? r.status : "Pending",
            deliveredAt: r.deliveredAt || null,
            openedAt: r.openedAt || null,
          },
        },
        upsert: true,
      },
    }));
    if (ops.length) {
      await MessageRecipient.bulkWrite(ops, { ordered: false });
      recipientsMigrated += ops.length;
    }
  }

  return { scanned: rows.length, normalized, recipientsMigrated };
}

module.exports = { normalizeAudienceType, migrateMessages };

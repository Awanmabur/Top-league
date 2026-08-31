function normalizeAudienceType(value) {
  const raw = String(value || "").trim();
  const aliases = {
    Students: "All Students",
    Staff: "All Staff",
    Parents: "All Parents",
    "Specific Class": "Specific Program",
    Program: "Specific Program",
    Cohort: "Year/Cohort",
    Hostel: "Hostel Residents",
  };
  return aliases[raw] || raw || "All Students";
}

async function migrateAnnouncements(models = {}) {
  const { Announcement, AnnouncementReceipt } = models;
  if (!Announcement || !AnnouncementReceipt) {
    return { scanned: 0, normalized: 0, receiptsMigrated: 0 };
  }

  const rows = await Announcement.find({}).select(
    "_id audienceType status publishedAt createdAt scheduleClaimedAt receipts"
  );

  let normalized = 0;
  let receiptsMigrated = 0;

  for (const row of rows) {
    const patch = {};
    const audienceType = normalizeAudienceType(row.audienceType);
    if (audienceType !== row.audienceType) patch.audienceType = audienceType;
    if (row.status === "Published" && !row.publishedAt) patch.publishedAt = row.createdAt || new Date();
    if (row.scheduleClaimedAt) patch.scheduleClaimedAt = null;

    if (Object.keys(patch).length) {
      await Announcement.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }

    const receipts = Array.isArray(row.receipts) ? row.receipts : [];
    const ops = receipts
      .filter((receipt) => receipt?.userId)
      .map((receipt) => ({
        updateOne: {
          filter: { announcementId: row._id, userId: receipt.userId },
          update: {
            $setOnInsert: {
              announcementId: row._id,
              userId: receipt.userId,
            },
            $set: {
              name: String(receipt.name || "").trim(),
              email: String(receipt.email || "").trim().toLowerCase(),
              role: String(receipt.role || "").trim(),
              status: ["Unread", "Read", "Acknowledged"].includes(receipt.status) ? receipt.status : "Unread",
              readAt: receipt.readAt || null,
              ackAt: receipt.ackAt || null,
            },
          },
          upsert: true,
        },
      }));

    if (ops.length) {
      await AnnouncementReceipt.bulkWrite(ops, { ordered: false });
      receiptsMigrated += ops.length;
    }
  }

  return { scanned: rows.length, normalized, receiptsMigrated };
}

module.exports = { normalizeAudienceType, migrateAnnouncements };

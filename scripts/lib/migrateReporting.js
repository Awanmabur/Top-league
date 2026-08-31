const ALLOWED_TYPES = new Set([
  "finance_summary",
  "invoices",
  "payments",
  "admissions",
  "students_outstanding",
  "analytics_summary",
]);

function fileName(value) {
  return String(value || "")
    .replace(/[\r\n\0]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 120) || "report.csv";
}

function validChecksum(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

async function migrateReporting(models) {
  const Model = models?.ReportExport;
  if (!Model?.collection) return { scanned: 0, normalized: 0, quarantined: 0, scrubbedLegacyUrls: 0 };

  const rows = await Model.collection.find({}).toArray();
  let normalized = 0;
  let quarantined = 0;
  let scrubbedLegacyUrls = 0;

  for (const row of rows) {
    const hasPrivateArtifact = !!String(row.filePublicId || "").trim();
    const hadLegacyUrl = !!String(row.fileUrl || "").trim();
    const status = ["ready", "failed", "quarantined"].includes(row.status) ? row.status : "failed";
    const set = {
      revision: Math.max(1, Number(row.revision || 1)),
      source: row.source === "import" ? "import" : "export",
      contentType: "text/csv",
      fileName: row.fileName || fileName(row.originalFileName || `report-${row._id}.csv`),
      fileResourceType: row.fileResourceType || "raw",
      accessType: hasPrivateArtifact ? "authenticated" : "missing",
      fileUrl: "",
      rowsCount: Math.max(0, Number(row.rowsCount) || 0),
      byteSize: Math.max(0, Number(row.byteSize) || 0),
      status,
    };

    if (hadLegacyUrl) scrubbedLegacyUrls += 1;

    const reasons = [];
    if (status === "ready" && !hasPrivateArtifact) reasons.push("Legacy report has no authenticated artifact id.");
    if (status === "ready" && !validChecksum(row.checksum)) reasons.push("Legacy report has no trustworthy SHA-256 checksum.");
    if (!ALLOWED_TYPES.has(String(row.type || ""))) reasons.push("Legacy report type is unsupported.");

    if (reasons.length) {
      set.status = "quarantined";
      set.migrationQuarantinedAt = row.migrationQuarantinedAt || new Date();
      set.migrationQuarantineReason = reasons.join(" ").slice(0, 300);
      quarantined += row.status === "quarantined" ? 0 : 1;
    } else if (status !== "quarantined") {
      set.migrationQuarantinedAt = null;
      set.migrationQuarantineReason = "";
    }

    await Model.collection.updateOne({ _id: row._id }, { $set: set });
    normalized += 1;
  }

  return { scanned: rows.length, normalized, quarantined, scrubbedLegacyUrls };
}

module.exports = { migrateReporting, fileName, validChecksum, ALLOWED_TYPES };

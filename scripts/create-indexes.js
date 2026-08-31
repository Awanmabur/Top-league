require("dotenv").config({ quiet: true });

// Index/migration maintenance is a cold-start operation and may need more TLS/DNS
// setup time than the live web process. Keep the live runtime defaults tight, but
// tolerate transient Atlas handshakes here unless the operator explicitly overrides.
if (!process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS = "30000";
if (!process.env.MONGO_CONNECT_TIMEOUT_MS) process.env.MONGO_CONNECT_TIMEOUT_MS = "30000";

const mongoose = require("mongoose");

const {
  platformConnection,
  waitForPlatform,
  getTenantConnection,
} = require("../src/config/db");
const loadTenantModels = require("../src/models/tenant/loadModels");
const { migrateHelpdeskTickets } = require("./lib/migrateHelpdeskTickets");
const { migrateAnnouncements } = require("./lib/migrateAnnouncements");
const { migrateMessages } = require("./lib/migrateMessages");
const { migrateEvents } = require("./lib/migrateEvents");
const { migrateExpenses } = require("./lib/migrateExpenses");
const { migrateAdmissions } = require("./lib/migrateAdmissions");
const { migrateAdmissionsOperations } = require("./lib/migrateAdmissionsOperations");
const { migrateHostels } = require("./lib/migrateHostels");
const { migrateLibrary } = require("./lib/migrateLibrary");
const { migrateInquiries } = require("./lib/migrateInquiries");
const { migrateFinance } = require("./lib/migrateFinance");
const { migrateFeeStructures } = require("./lib/migrateFeeStructures");
const { migrateScholarships } = require("./lib/migrateScholarships");
const { migrateStaffRoles } = require("./lib/migrateStaffRoles");
const { migrateLeaveRequests } = require("./lib/migrateLeaveRequests");
const { migratePayroll } = require("./lib/migratePayroll");
const { migrateStudents } = require("./lib/migrateStudents");
const { migrateParents } = require("./lib/migrateParents");
const { migratePromotions } = require("./lib/migratePromotions");
const { migrateAcademicCatalog } = require("./lib/migrateAcademicCatalog");
const { migrateExams } = require("./lib/migrateExams");
const { migrateResults } = require("./lib/migrateResults");
const { migrateTranscripts } = require("./lib/migrateTranscripts");
const { migrateAssignments } = require("./lib/migrateAssignments");
const { migrateAttendance } = require("./lib/migrateAttendance");
const { migrateTimetable } = require("./lib/migrateTimetable");
const { migrateAcademicCalendar } = require("./lib/migrateAcademicCalendar");
const { migrateDiscipline } = require("./lib/migrateDiscipline");
const { migrateStudentDocs } = require("./lib/migrateStudentDocs");
const { migrateTransport } = require("./lib/migrateTransport");
const { migrateAssets } = require("./lib/migrateAssets");
const { migrateFacilities } = require("./lib/migrateFacilities");
const { migrateReporting } = require("./lib/migrateReporting");
const { migrateAuditHealth } = require("./lib/migrateAuditHealth");
const { migrateBackups } = require("./lib/migrateBackups");
const { migrateIdentityIntegrations } = require("./lib/migrateIdentityIntegrations");
const { migratePublicPresence } = require("./lib/migratePublicPresence");
const { migrateStudentSelfService } = require("./lib/migrateStudentSelfService");
const { migrateOrganizationCatalog } = require("./lib/migrateOrganizationCatalog");
const { migratePlatformSaas } = require("./lib/migratePlatformSaas");
const { migratePlatformOperations } = require("./lib/migratePlatformOperations");
const { indexName, ensureCollectionIndex } = require("./lib/indexReconciler");

const platformModelNames = [
  "Tenant",
  "Plan",
  "PlatformPayment",
  "PlatformSubscription",
  "SupportTicket",
  "PlatformAnnouncement",
  "AuditLog",
  "PlatformUser",
  "PlatformSetting",
  "PlatformConfig",
  "PlatformBooking",
  "PlatformIntegrationCredential",
];

function loadPlatformModels() {
  for (const name of platformModelNames) {
    require(`../src/models/platform/${name}`)(platformConnection);
  }
  return platformConnection.models;
}

function instantiateTenantModels(conn) {
  const lazyModels = loadTenantModels(conn);
  const models = {};

  for (const name of Object.keys(lazyModels)) {
    models[name] = lazyModels[name];
  }

  return models;
}

async function createModelIndexes(scope, models) {
  const entries = Object.entries(models);
  let ok = 0;
  let failed = 0;

  for (const [name, Model] of entries) {
    const indexes = Model.schema.indexes();

    if (!indexes.length) {
      console.log(`[skip] ${scope}.${name}: no declared indexes`);
      continue;
    }

    for (const [fields, options = {}] of indexes) {
      const desiredName = indexName(fields, options);

      try {
        const result = await ensureCollectionIndex(Model.collection, fields, options);
        ok += 1;
        const suffix = result.status === "replaced" ? ` (replaced ${result.dropped.join(", ")})` : "";
        console.log(`[ok] ${scope}.${name}.${desiredName}${suffix}`);
      } catch (err) {
        failed += 1;
        console.error(`[failed] ${scope}.${name}.${desiredName}: ${err.message || err}`);
      }
    }
  }

  return { ok, failed };
}

function tenantMatchesArg(tenant, requested) {
  if (!requested) return true;
  const target = String(requested).trim().toLowerCase();
  return [tenant.code, tenant.subdomain, tenant.dbName, String(tenant._id)]
    .map((value) => String(value || "").trim().toLowerCase())
    .includes(target);
}

async function main() {
  const requestedTenant =
    process.env.TENANT_CODE ||
    process.argv.find((arg) => arg.startsWith("--tenant="))?.slice("--tenant=".length) ||
    "";

  await waitForPlatform();

  console.log("Migrating platform SaaS lifecycle before platform index synchronization...");
  const platformModels = loadPlatformModels();
  const platformSaasMigration = await migratePlatformSaas(platformModels);
  console.log(`[migration] platform SaaS: ${JSON.stringify(platformSaasMigration)}`);
  console.log("Migrating platform operations/privacy before platform index synchronization...");
  const platformOperationsMigration = await migratePlatformOperations(platformModels);
  console.log(`[migration] platform operations: ${JSON.stringify(platformOperationsMigration)}`);

  console.log("Creating platform indexes...");
  const platformResult = await createModelIndexes("platform", platformModels);

  const Tenant = platformModels.Tenant;
  const tenants = await Tenant.find({ isDeleted: { $ne: true } })
    .select("name code subdomain dbName settings planName customDomain status country timezone currency updatedBy")
    .lean();

  const selectedTenants = tenants.filter((tenant) => tenantMatchesArg(tenant, requestedTenant));

  if (requestedTenant && !selectedTenants.length) {
    throw new Error(`No tenant found for ${requestedTenant}`);
  }

  console.log(`Creating tenant indexes for ${selectedTenants.length} tenant(s)...`);

  const tenantConnections = [];
  const totals = {
    ok: platformResult.ok,
    failed: platformResult.failed,
  };

  for (const tenant of selectedTenants) {
    if (!tenant.dbName) {
      console.warn(`[skip] tenant ${tenant.code || tenant._id} has no dbName`);
      continue;
    }

    const label = tenant.code || tenant.dbName;
    console.log(`Tenant ${label} (${tenant.dbName})`);

    const conn = await getTenantConnection(tenant.dbName);
    tenantConnections.push(conn);
    const tenantModels = instantiateTenantModels(conn);
    const helpdeskMigration = await migrateHelpdeskTickets(tenantModels.HelpdeskTicket);
    console.log(`[ok] ${label}.HelpdeskTicket migration: scanned=${helpdeskMigration.scanned}, repairedTicketNumbers=${helpdeskMigration.repairedNumbers}`);
    const announcementMigration = await migrateAnnouncements(tenantModels);
    console.log(`[ok] ${label}.Announcement migration: scanned=${announcementMigration.scanned}, normalized=${announcementMigration.normalized}, receiptsMigrated=${announcementMigration.receiptsMigrated}`);
    const messageMigration = await migrateMessages(tenantModels);
    console.log(`[ok] ${label}.Message migration: scanned=${messageMigration.scanned}, normalized=${messageMigration.normalized}, recipientsMigrated=${messageMigration.recipientsMigrated}`);
    const eventMigration = await migrateEvents(tenantModels);
    console.log(`[ok] ${label}.Event migration: scanned=${eventMigration.scanned}, normalized=${eventMigration.normalized}, registrationsMigrated=${eventMigration.registrationsMigrated}, statsSynced=${eventMigration.statsSynced}`);
    const expenseMigration = await migrateExpenses(tenantModels);
    console.log(`[ok] ${label}.Expense migration: scanned=${expenseMigration.scanned}, normalized=${expenseMigration.normalized}, repairedNumbers=${expenseMigration.repairedNumbers}, lifecycleBackfilled=${expenseMigration.lifecycleBackfilled}`);
    const admissionsMigration = await migrateAdmissions(tenantModels);
    console.log(`[ok] ${label}.Admissions migration: applicants=${admissionsMigration.applicantsScanned}, letters=${admissionsMigration.lettersScanned}, normalizedApplicants=${admissionsMigration.normalizedApplicants}, repairedApplicationIds=${admissionsMigration.repairedApplicationIds}, repairedLetterNumbers=${admissionsMigration.repairedLetterNumbers}`);
    const admissionsOperationsMigration = await migrateAdmissionsOperations(tenantModels);
    console.log(`[migration] ${label}: admissions operations`, admissionsOperationsMigration);
    const hostelMigration = await migrateHostels(tenantModels);
    console.log(`[ok] ${label}.Hostel migration: rooms=${hostelMigration.rooms}, repairedRoomIds=${hostelMigration.repairedRoomIds}, applicationsMigrated=${hostelMigration.applicationsMigrated}, allocationsMigrated=${hostelMigration.allocationsMigrated}, unresolvedActive=${hostelMigration.unresolvedActive}`);
    const libraryMigration = await migrateLibrary(tenantModels);
    console.log(`[ok] ${label}.Library migration: books=${libraryMigration.books || 0}, loans=${libraryMigration.loans || 0}, reservations=${libraryMigration.reservations || 0}, fines=${libraryMigration.fines || 0}, holds=${libraryMigration.holds || 0}, unresolved=${libraryMigration.unresolved || 0}`);
    const inquiryMigration = await migrateInquiries(tenantModels, { schoolCode: tenant.code || tenant.subdomain });
    console.log(`[ok] ${label}.Inquiry migration: scanned=${inquiryMigration.scanned || 0}, normalized=${inquiryMigration.normalized || 0}, schoolCodesBackfilled=${inquiryMigration.schoolCodesBackfilled || 0}`);
    const organizationCatalogMigration = await migrateOrganizationCatalog(tenantModels);
    console.log(`[migration] ${label}: organization catalog`, organizationCatalogMigration);
    const scholarshipMigration = await migrateScholarships(tenantModels);
    console.log(`[ok] ${label}.Scholarship migration: scholarships=${scholarshipMigration.scholarships || 0}, applications=${scholarshipMigration.applications || 0}, applicantKeys=${scholarshipMigration.applicantKeys || 0}`);
    const feeStructureMigration = await migrateFeeStructures(tenantModels);
    console.log(`[ok] ${label}.FeeStructure migration: repairedCodes=${feeStructureMigration.repairedStructureCodes || 0}, legacyFees=${feeStructureMigration.scanned || 0}, invoicesCreated=${feeStructureMigration.invoicesCreated || 0}, pendingPaidClaims=${feeStructureMigration.paymentClaimsCreated || 0}`);
    const financeMigration = await migrateFinance(tenantModels);
    console.log(`[ok] ${label}.Finance migration: invoices=${financeMigration.invoices || 0}, payments=${financeMigration.payments || 0}, repairedInvoiceNumbers=${financeMigration.repairedInvoiceNumbers || 0}, repairedReceiptNumbers=${financeMigration.repairedReceiptNumbers || 0}, allocationsRebuilt=${financeMigration.allocationsRebuilt || 0}`);
    const staffRoleMigration = await migrateStaffRoles(tenantModels);
    console.log(`[ok] ${label}.Staff/RBAC migration: roles=${staffRoleMigration.rolesScanned || 0}, normalized=${staffRoleMigration.rolesNormalized || 0}, duplicateStaffLinksCleared=${staffRoleMigration.duplicateStaffLinksCleared || 0}`);
    const leaveMigration = await migrateLeaveRequests(tenantModels, { timezone: tenant.timezone || "UTC" });
    console.log(`[ok] ${label}.Leave migration: scanned=${leaveMigration.scanned || 0}, normalized=${leaveMigration.normalized || 0}, userIdsBackfilled=${leaveMigration.userIdsBackfilled || 0}, overlapWarnings=${leaveMigration.overlapWarnings || 0}, staffStatusesSynced=${leaveMigration.staffStatusesSynced || 0}`);
    const payrollMigration = await migratePayroll(tenantModels);
    console.log(`[ok] ${label}.Payroll migration: runs=${payrollMigration.runs || 0}, items=${payrollMigration.items || 0}, repairedRunNumbers=${payrollMigration.repairedRunNumbers || 0}, duplicateScopes=${payrollMigration.duplicateScopes || 0}, duplicateItems=${payrollMigration.duplicateItems || 0}, downgradedClosedRuns=${payrollMigration.downgradedClosedRuns || 0}`);
    const studentMigration = await migrateStudents(tenantModels);
    console.log(`[ok] ${label}.Student migration: scanned=${studentMigration.scanned || 0}, repairedRegNos=${studentMigration.repairedRegNos || 0}, repairedStudentNos=${studentMigration.repairedStudentNos || 0}, duplicateUserLinksCleared=${studentMigration.duplicateUserLinksCleared || 0}, authLinksBackfilled=${studentMigration.authLinksBackfilled || 0}`);
    const parentMigration = await migrateParents(tenantModels);
    console.log(`[ok] ${label}.Parent migration: scanned=${parentMigration.scanned || 0}, normalized=${parentMigration.normalized || 0}, mergedDuplicates=${parentMigration.mergedDuplicates || 0}, userLinksBackfilled=${parentMigration.userLinksBackfilled || 0}, profilesCreated=${parentMigration.profilesCreated || 0}, childLinksPruned=${parentMigration.childLinksPruned || 0}`);
    const promotionMigration = await migratePromotions(tenantModels);
    console.log(`[ok] ${label}.Promotion migration: logs=${promotionMigration.logsScanned || 0}, normalized=${promotionMigration.logsNormalized || 0}, expiredLeasesCleared=${promotionMigration.expiredLeasesCleared || 0}`);
    const academicCatalogMigration = await migrateAcademicCatalog(tenantModels);
    console.log(`[migration] ${label}: academic catalog`, academicCatalogMigration);
    const examMigration = await migrateExams(tenantModels);
    console.log(`[migration] ${label}: exams`, examMigration);
    const resultMigration = await migrateResults(tenantModels);
    console.log(`[migration] ${label}: results`, resultMigration);
    const transcriptMigration = await migrateTranscripts(tenantModels);
    console.log(`[migration] ${label}: transcripts`, transcriptMigration);
    const assignmentMigration = await migrateAssignments(tenantModels);
    console.log(`[migration] ${label}: assignments`, assignmentMigration);
    const attendanceMigration = await migrateAttendance(tenantModels, { timezone: tenant.timezone || "UTC" });
    console.log(`[migration] ${label}: attendance`, attendanceMigration);
    const timetableMigration = await migrateTimetable(tenantModels);
    console.log(`[migration] ${label}: timetable`, timetableMigration);
    const academicCalendarMigration = await migrateAcademicCalendar(tenantModels);
    console.log(`[migration] ${label}: academic calendar`, academicCalendarMigration);
    const disciplineMigration = await migrateDiscipline(tenantModels);
    console.log(`[migration] ${label}: discipline`, disciplineMigration);
    const studentDocMigration = await migrateStudentDocs(tenantModels);
    console.log(`[migration] ${label}: student documents`, studentDocMigration);
    const transportMigration = await migrateTransport(tenantModels);
    console.log(`[migration] ${label}: transport`, transportMigration);
    const assetMigration = await migrateAssets(tenantModels);
    console.log(`[migration] ${label}: assets`, assetMigration);
    const facilityMigration = await migrateFacilities(tenantModels);
    console.log(`[migration] ${label}: facilities`, facilityMigration);
    const reportingMigration = await migrateReporting(tenantModels);
    console.log(`[migration] ${label}: reporting`, reportingMigration);
    const auditHealthMigration = await migrateAuditHealth(tenantModels);
    console.log(`[migration] ${label}: audit/system health`, auditHealthMigration);
    const backupMigration = await migrateBackups(tenantModels);
    console.log(`[migration] ${label}: backups`, backupMigration);
    const identityIntegrationMigration = await migrateIdentityIntegrations(tenantModels);
    console.log(`[migration] ${label}: identity/integrations`, identityIntegrationMigration);
    const publicPresenceMigration = await migratePublicPresence(tenantModels, { tenant });
    console.log(`[migration] ${label}: public presence`, publicPresenceMigration);
    const studentSelfServiceMigration = await migrateStudentSelfService(tenantModels);
    console.log(`[migration] ${label}: student self-service`, studentSelfServiceMigration);
    console.log(`[ok] ${label}.Academic catalog migration: classes=${academicCatalogMigration.classes?.scanned || 0}, sections=${academicCatalogMigration.sections?.scanned || 0}, streams=${academicCatalogMigration.streams?.scanned || 0}, subjects=${academicCatalogMigration.subjects?.scanned || 0}, orphanedArchived=${academicCatalogMigration.orphanedArchived || 0}, linksNormalized=${academicCatalogMigration.linksNormalized || 0}`);
    const result = await createModelIndexes(label, tenantModels);
    totals.ok += result.ok;
    totals.failed += result.failed;
  }

  await Promise.allSettled(tenantConnections.map((conn) => conn.close()));
  await platformConnection.close();
  await mongoose.disconnect().catch(() => {});

  console.log(`Index creation complete: ${totals.ok} model(s) ok, ${totals.failed} failed.`);

  if (totals.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error("Index creation failed:", err.message || err);
  await platformConnection.close().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

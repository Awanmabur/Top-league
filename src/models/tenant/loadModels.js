// src/models/tenant/loadModels.js
// Lazily loads tenant models for a given DB connection and caches them per connection
module.exports = function loadTenantModels(conn) {
  if (!conn) throw new Error("loadTenantModels: connection is required");

  // Cache model accessors map on the connection
  if (conn.__tenantModels) return conn.__tenantModels;

  function defineModel(fileName) {
    let cachedModel = null;

    return function getModel() {
      if (cachedModel) return cachedModel;
      cachedModel = require(`./${fileName}`)(conn);
      return cachedModel;
    };
  }

  const loaders = {
    Applicant: defineModel("Applicant"),
    User: defineModel("User"),
    InviteToken: defineModel("InviteToken"),

    Program: defineModel("Program"),
    Exam: defineModel("Exam"),
    Result: defineModel("Result"),
    Transcript: defineModel("Transcript"),
    AcademicEvent: defineModel("AcademicEvent"),
    Assignment: defineModel("Assignment"),
    Subject: defineModel("Subject"),

    Fees: defineModel("Fees"),
    Scholarship: defineModel("Scholarship"),
    ScholarshipApplication: defineModel("ScholarshipApplication"),
    Notification: defineModel("Notification"),
    NotificationPreference: defineModel("NotificationPreference"),
    Intake: defineModel("Intake"),
    OfferLetterTemplate: defineModel("OfferLetterTemplate"),
    AdmissionRequirement: defineModel("AdmissionRequirement"),
    OfferLetter: defineModel("OfferLetter"),

    PromotionLog: defineModel("PromotionLog"),
    StudentDoc: defineModel("StudentDoc"),
    DisciplineCase: defineModel("DisciplineCase"),
    Enrollment: defineModel("Enrollment"),

    LeaveRequest: defineModel("LeaveRequest"),
    PayrollRun: defineModel("PayrollRun"),
    PayrollItem: defineModel("PayrollItem"),
    StaffRole: defineModel("StaffRole"),

    Class: defineModel("Class"),
    TimetableEntry: defineModel("TimetableEntry"),
    Section: defineModel("Section"),

    Student: defineModel("Student"),
    Parent: defineModel("Parent"),
    Counter: defineModel("Counter"),
    Staff: defineModel("Staff"),

    Department: defineModel("Department"),
    Faculty: defineModel("Faculty"),

    Invoice: defineModel("Invoice"),
    Payment: defineModel("Payment"),
    ReportExport: defineModel("ReportExport"),
    Expense: defineModel("Expense"),

    Attendance: defineModel("Attendance"),
    LibraryBook: defineModel("LibraryBook"),
    Hostel: defineModel("Hostel"),
    Asset: defineModel("Asset"),
    Setting: defineModel("Setting"),

    Event: defineModel("Event"),
    Announcement: defineModel("Announcement"),
    Message: defineModel("Message"),
    HelpdeskTicket: defineModel("HelpdeskTicket"),
    AuditLog: defineModel("AuditLog"),
    BackupJob: defineModel("BackupJob"),
    TenantProfile: defineModel("TenantProfile"),
    ApiIntegration: defineModel("ApiIntegration"),
    SystemHealth: defineModel("SystemHealth"),
    SchoolFAQ: defineModel("SchoolFAQ"),
    SchoolInquiry: defineModel("SchoolInquiry"),
    SchoolReview: defineModel("SchoolReview"),
  };

  const models = {};

  for (const [key, getter] of Object.entries(loaders)) {
    Object.defineProperty(models, key, {
      enumerable: true,
      configurable: false,
      get: getter,
    });
  }

  conn.__tenantModels = models;
  return models;
};
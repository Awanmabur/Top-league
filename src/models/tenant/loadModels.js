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

    Exam: defineModel("Exam"),
    Result: defineModel("Result"),
    Transcript: defineModel("Transcript"),
    AcademicEvent: defineModel("AcademicEvent"),
    Assignment: defineModel("Assignment"),
    AssignmentSubmission: defineModel("AssignmentSubmission"),
    Subject: defineModel("Subject"),
    Program: defineModel("Program"),
    Department: defineModel("Department"),
    CourseRegistration: defineModel("CourseRegistration"),
    RegistrationWindow: defineModel("RegistrationWindow"),
    StudentHold: defineModel("StudentHold"),
    JobOpportunity: defineModel("JobOpportunity"),
    JobApplication: defineModel("JobApplication"),
    LetterRequest: defineModel("LetterRequest"),

    Fees: defineModel("Fees"),
    FeeStructure: defineModel("FeeStructure"),
    Scholarship: defineModel("Scholarship"),
    ScholarshipApplication: defineModel("ScholarshipApplication"),
    Notification: defineModel("Notification"),
    NotificationPreference: defineModel("NotificationPreference"),
    NotificationReceipt: defineModel("NotificationReceipt"),
    Intake: defineModel("Intake"),
    OfferLetterTemplate: defineModel("OfferLetterTemplate"),
    AdmissionRequirement: defineModel("AdmissionRequirement"),
    OfferLetter: defineModel("OfferLetter"),

    PromotionLog: defineModel("PromotionLog"),
    StudentDoc: defineModel("StudentDoc"),
    DisciplineCase: defineModel("DisciplineCase"),

    LeaveRequest: defineModel("LeaveRequest"),
    PayrollRun: defineModel("PayrollRun"),
    PayrollItem: defineModel("PayrollItem"),
    StaffRole: defineModel("StaffRole"),

    Class: defineModel("Class"),
    TimetableEntry: defineModel("TimetableEntry"),
    TimetableMutationLock: defineModel("TimetableMutationLock"),
    Section: defineModel("Section"),
    Stream: defineModel("Stream"),

    Student: defineModel("Student"),
    Parent: defineModel("Parent"),
    Counter: defineModel("Counter"),
    Staff: defineModel("Staff"),

    Invoice: defineModel("Invoice"),
    Payment: defineModel("Payment"),
    ReportExport: defineModel("ReportExport"),
    Expense: defineModel("Expense"),

    Attendance: defineModel("Attendance"),
    LibraryBook: defineModel("LibraryBook"),
    LibraryLoan: defineModel("LibraryLoan"),
    LibraryReservation: defineModel("LibraryReservation"),
    LibraryFine: defineModel("LibraryFine"),
    LibraryHold: defineModel("LibraryHold"),
    Hostel: defineModel("Hostel"),
    HostelAllocation: defineModel("HostelAllocation"),
    HostelApplication: defineModel("HostelApplication"),
    Asset: defineModel("Asset"),
    AssetMaintenance: defineModel("AssetMaintenance"),
    Classroom: defineModel("Classroom"),
    Transport: defineModel("Transport"),
    TransportAssignment: defineModel("TransportAssignment"),
    Setting: defineModel("Setting"),

    Event: defineModel("Event"),
    EventRegistration: defineModel("EventRegistration"),
    EventTemplate: defineModel("EventTemplate"),
    EventSubscription: defineModel("EventSubscription"),
    EventView: defineModel("EventView"),
    Announcement: defineModel("Announcement"),
    AnnouncementReceipt: defineModel("AnnouncementReceipt"),
    AnnouncementTemplate: defineModel("AnnouncementTemplate"),
    Message: defineModel("Message"),
    MessageRecipient: defineModel("MessageRecipient"),
    MessageTemplate: defineModel("MessageTemplate"),
    HelpdeskTicket: defineModel("HelpdeskTicket"),
    HelpdeskTemplate: defineModel("HelpdeskTemplate"),
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

const { buildStudentContext, findVisibleAnnouncements } = require("../../../services/tenant/announcementService");
const {
  processDueEvents,
  findVisibleEvents,
  recordEventViews,
  getRegistrationMap,
  registerForEvent,
  cancelRegistration,
  toggleEventSubscription,
  buildEventsIcs,
} = require("../../../services/tenant/eventService");
const {
  getStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");

function eventTime(startAt, endAt) {
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  const valid = (d) => d && !Number.isNaN(d.getTime());
  if (!valid(start)) return "TBA";
  const fmt = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return valid(end) ? `${fmt(start)}–${fmt(end)}` : fmt(start);
}

function registrationState(event, registration, now = new Date()) {
  if (registration) return { registered: true, canRegister: false, label: registration.status === "Checked In" ? "Checked In" : "Registered" };
  if (!event.startAt || new Date(event.startAt) <= now) return { registered: false, canRegister: false, label: "Closed" };
  if (event.registrationDeadline && new Date(event.registrationDeadline) <= now) return { registered: false, canRegister: false, label: "Closed" };
  const capacity = Number(event.capacity || 0);
  const count = Number(event.stats?.registrations || 0);
  if (capacity > 0 && count >= capacity) return { registered: false, canRegister: false, label: "Full" };
  return { registered: false, canRegister: true, label: "Register" };
}

async function getPageContext(req) {
  const got = await getStudent(req);
  const user = got?.user || null;
  const student = got?.student || null;
  if (!user) return { user: null, student, context: null };
  const context = await buildStudentContext(req, user, student);
  return { user, student, context };
}

module.exports = {
  events: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");
      const { Announcement, EventSubscription } = req.models;
      const { user, student, context } = await getPageContext(req);
      if (!user) return res.redirect("/login");

      await processDueEvents(req, new Date()).catch(() => {});
      const meta = academicMeta(student);
      const events = await findVisibleEvents(req, context, { limit: 100, now: new Date() }).catch(() => []);
      await recordEventViews(req, events.map((e) => e._id), user._id, new Date()).catch(() => {});
      const registrations = await getRegistrationMap(req, events.map((e) => e._id), user._id);
      const subscription = EventSubscription ? await EventSubscription.findOne({ userId: user._id }).lean().catch(() => null) : null;
      const announcements = Announcement
        ? await findVisibleAnnouncements(req, context, { limit: 8, markRead: true }).catch(() => [])
        : [];

      const now = new Date();
      const rows = events.map((e) => {
        const reg = registrations.get(String(e._id));
        const state = registrationState(e, reg, now);
        return {
          id: String(e._id),
          date: e.startAt || null,
          title: e.title || "Event",
          organizer: e.organizer || e.department || e.faculty || "",
          type: e.type || "General",
          location: e.venue || "Campus",
          time: eventTime(e.startAt, e.endAt),
          description: e.description || "",
          registrationDeadline: e.registrationDeadline || null,
          capacity: Number(e.capacity || 0),
          registrations: Number(e.stats?.registrations || 0),
          registered: state.registered,
          canRegister: state.canRegister,
          registrationLabel: state.label,
        };
      });

      return renderView(req, res, "students/events", {
        pageTitle: "Events",
        csrfToken: req.csrfToken?.(),
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        events: rows,
        eventLocations: [...new Set(rows.map((e) => e.location).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
        eventAlertsEnabled: !!subscription?.enabled,
        announcements: announcements.map((a) => ({
          title: a.title || "Announcement",
          message: a.message || a.body || "",
          createdAt: a.createdAt || null,
        })),
      });
    } catch (err) {
      return res.status(500).send("Failed to load events: " + err.message);
    }
  },

  register: async (req, res) => {
    try {
      const { user, student, context } = await getPageContext(req);
      if (!user) return res.redirect("/login");
      const result = await registerForEvent(req, { eventId: req.params.id, user, student, context, now: new Date() });
      req.flash?.("success", result.alreadyRegistered ? "You are already registered for this event." : "Event registration successful.");
    } catch (err) {
      req.flash?.("error", err?.message || "Event registration failed.");
    }
    return res.redirect("/student/events");
  },

  cancelRegistration: async (req, res) => {
    try {
      const { user } = await getPageContext(req);
      if (!user) return res.redirect("/login");
      const ok = await cancelRegistration(req, { eventId: req.params.id, userId: user._id, now: new Date() });
      req.flash?.(ok ? "success" : "error", ok ? "Event registration cancelled." : "Registration could not be cancelled.");
    } catch {
      req.flash?.("error", "Registration could not be cancelled.");
    }
    return res.redirect("/student/events");
  },

  toggleAlerts: async (req, res) => {
    try {
      const { user } = await getPageContext(req);
      if (!user) return res.redirect("/login");
      const sub = await toggleEventSubscription(req, user._id);
      req.flash?.("success", sub.enabled ? "Event alerts subscribed." : "Event alerts unsubscribed.");
    } catch (err) {
      req.flash?.("error", err?.message || "Event alert preference could not be updated.");
    }
    return res.redirect("/student/events");
  },

  calendar: async (req, res) => {
    try {
      const { user, context } = await getPageContext(req);
      if (!user) return res.redirect("/login");
      await processDueEvents(req, new Date()).catch(() => {});
      const events = await findVisibleEvents(req, context, { limit: 500, now: new Date() });
      const ics = buildEventsIcs(events, req.tenant || {});
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="classic-academy-events.ics"');
      return res.send(ics);
    } catch (err) {
      return res.status(500).send("Failed to export calendar: " + err.message);
    }
  },
};

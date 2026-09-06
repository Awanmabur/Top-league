const crypto = require("crypto");
const { z } = require("zod");
const { DateTime, Interval } = require("luxon");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { redisRateLimitOptions } = require("../../services/rateLimitStoreFactory");

const { platformConnection } = require("../../config/db");
const PlatformBooking = require("../../models/platform/PlatformBooking")(platformConnection);
const { privacyHmac } = require("../../services/platformAuditService");
const googleCalendar = require("../../services/googleCalendarAuthService");

const ALLOWED_DURATIONS = [30, 45, 60];
const SLOT_SEGMENT_MINUTES = 15;

function finiteInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

const bookingEnv = {
  BOOKING_TIMEZONE: process.env.BOOKING_TIMEZONE || "Africa/Kampala",
  BOOKING_START_HOUR: finiteInt(process.env.BOOKING_START_HOUR, 9),
  BOOKING_END_HOUR: finiteInt(process.env.BOOKING_END_HOUR, 17),
  DEFAULT_DURATION_MIN: finiteInt(process.env.DEFAULT_DURATION_MIN, 30),
  SLOT_INTERVAL_MIN: finiteInt(process.env.SLOT_INTERVAL_MIN, 30),
  LEAD_MINUTES: finiteInt(process.env.LEAD_MINUTES, 10),
  MAX_ADVANCE_DAYS: finiteInt(process.env.BOOKING_MAX_ADVANCE_DAYS, 180),
  CLAIM_TTL_MINUTES: finiteInt(process.env.BOOKING_CLAIM_TTL_MINUTES, 5),

  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || "primary",
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,

  HOST_EMAILS: process.env.HOST_EMAILS || "",

  ZOOM_ACCOUNT_ID: process.env.ZOOM_ACCOUNT_ID,
  ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID,
  ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET,
  ZOOM_HOST_USER_ID: process.env.ZOOM_HOST_USER_ID || "me",
};

if (!ALLOWED_DURATIONS.includes(bookingEnv.DEFAULT_DURATION_MIN)) {
  bookingEnv.DEFAULT_DURATION_MIN = 30;
}
if (
  bookingEnv.SLOT_INTERVAL_MIN < SLOT_SEGMENT_MINUTES ||
  bookingEnv.SLOT_INTERVAL_MIN > 60 ||
  bookingEnv.SLOT_INTERVAL_MIN % SLOT_SEGMENT_MINUTES !== 0
) {
  bookingEnv.SLOT_INTERVAL_MIN = 30;
}
if (bookingEnv.BOOKING_START_HOUR < 0 || bookingEnv.BOOKING_START_HOUR > 22) {
  bookingEnv.BOOKING_START_HOUR = 9;
}
if (
  bookingEnv.BOOKING_END_HOUR <= bookingEnv.BOOKING_START_HOUR ||
  bookingEnv.BOOKING_END_HOUR > 24
) {
  bookingEnv.BOOKING_END_HOUR = 17;
}
bookingEnv.LEAD_MINUTES = Math.min(Math.max(bookingEnv.LEAD_MINUTES, 0), 24 * 60);
bookingEnv.MAX_ADVANCE_DAYS = Math.min(Math.max(bookingEnv.MAX_ADVANCE_DAYS, 1), 365);
bookingEnv.CLAIM_TTL_MINUTES = Math.min(Math.max(bookingEnv.CLAIM_TTL_MINUTES, 2), 30);

const bookingEnabled =
  googleCalendar.configured() &&
  !!bookingEnv.ZOOM_ACCOUNT_ID &&
  !!bookingEnv.ZOOM_CLIENT_ID &&
  !!bookingEnv.ZOOM_CLIENT_SECRET;

if (!bookingEnabled) {
  console.warn(
    "Booking is not fully configured. /schedule remains available, but booking APIs require Google Calendar authentication and Zoom credentials.",
  );
}

function bookingNonce(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  return next();
}

const bookingCsp = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    "default-src": ["'self'"],
    "script-src": ["'self'", (req, res) => `'nonce-${res.locals.cspNonce || "missing"}'`],
    "style-src": [
      "'self'",
      "'unsafe-inline'",
      "https://cdnjs.cloudflare.com",
      "https://fonts.googleapis.com",
    ],
    "font-src": [
      "'self'",
      "data:",
      "https://cdnjs.cloudflare.com",
      "https://fonts.gstatic.com",
    ],
    "img-src": ["'self'", "data:", "https://res.cloudinary.com", "https://upload.wikimedia.org", "https://developer.apple.com"],
    "connect-src": ["'self'"],
  },
});

const bookingApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  ...redisRateLimitOptions("booking-api"),
});

const bookingSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  ...redisRateLimitOptions("booking-submit"),
});

async function ensureGoogleAuth() {
  if (!bookingEnabled) {
    const err = new Error("Booking service is not configured.");
    err.code = "BOOKING_NOT_CONFIGURED";
    throw err;
  }
  return googleCalendar.getCalendarClient();
}

const pad = (n) => String(n).padStart(2, "0");
const isoKey = (dt) => `${dt.year}-${pad(dt.month)}-${pad(dt.day)}`;

function publicBookingError(res, error, fallback = "Booking service is temporarily unavailable.") {
  if (["BOOKING_NOT_CONFIGURED", "GOOGLE_CALENDAR_RECONNECT_REQUIRED", "GOOGLE_CALENDAR_SERVICE_ACCOUNT_ERROR", "GOOGLE_SERVICE_ACCOUNT_NOT_CONFIGURED"].includes(error?.code)) {
    return res.status(503).json({ ok: false, message: fallback });
  }
  console.error("platform booking:", error?.message || error);
  return res.status(502).json({ ok: false, message: fallback });
}

function normalizeDuration(value) {
  const duration = Number(value || bookingEnv.DEFAULT_DURATION_MIN);
  return ALLOWED_DURATIONS.includes(duration) ? duration : null;
}

function overlapsAny(slotInterval, busyIntervals) {
  return busyIntervals.some((busyInterval) => slotInterval.overlaps(busyInterval));
}

async function freeBusyBetween(googleClient, timeMinISO, timeMaxISO) {
  let fb;
  try {
    fb = await googleClient.calendar.freebusy.query({
      requestBody: {
        timeMin: timeMinISO,
        timeMax: timeMaxISO,
        items: [{ id: googleClient.calendarId }],
      },
    });
    await googleCalendar.markSuccess(googleClient.credentialId).catch(() => {});
  } catch (error) {
    throw await googleCalendar.normalizeCalendarError(error, googleClient.credentialId);
  }

  const busy = fb.data.calendars?.[googleClient.calendarId]?.busy || [];
  return busy
    .map((item) =>
      Interval.fromDateTimes(DateTime.fromISO(item.start), DateTime.fromISO(item.end)),
    )
    .filter((interval) => interval.isValid);
}

async function releaseExpiredClaims(now = new Date()) {
  await PlatformBooking.updateMany(
    {
      status: "claimed",
      blocksSlot: true,
      claimExpiresAt: { $lte: now },
      calendarEventId: { $in: [null, ""] },
    },
    {
      $set: {
        status: "failed",
        blocksSlot: false,
        failureReason: "Claim expired before external booking confirmation.",
        claimExpiresAt: null,
      },
      $inc: { revision: 1 },
    },
  );
}

async function localBusyBetween(startUtc, endUtc) {
  const now = new Date();
  await releaseExpiredClaims(now);
  const rows = await PlatformBooking.find({
    blocksSlot: true,
    startAt: { $lt: endUtc.toJSDate() },
    endAt: { $gt: startUtc.toJSDate() },
    $or: [
      { status: "confirmed" },
      { status: "claimed", claimExpiresAt: { $gt: now } },
    ],
  })
    .select("startAt endAt")
    .limit(500)
    .lean();

  return rows
    .map((row) =>
      Interval.fromDateTimes(
        DateTime.fromJSDate(row.startAt, { zone: "utc" }),
        DateTime.fromJSDate(row.endAt, { zone: "utc" }),
      ),
    )
    .filter((interval) => interval.isValid);
}

function computeSlotsForDay({
  dayStart,
  dayEnd,
  durationMin,
  slotIntervalMin,
  busyIntervals,
  leadMinutes,
  maxStartAt,
}) {
  const slots = [];
  const now = DateTime.now().setZone(dayStart.zoneName).plus({ minutes: leadMinutes });

  for (
    let t = dayStart;
    t.plus({ minutes: durationMin }) <= dayEnd;
    t = t.plus({ minutes: slotIntervalMin })
  ) {
    if (t < now) continue;
    if (maxStartAt && t > maxStartAt) continue;

    const end = t.plus({ minutes: durationMin });
    const slotInterval = Interval.fromDateTimes(t.toUTC(), end.toUTC());
    if (overlapsAny(slotInterval, busyIntervals)) continue;

    slots.push({ time: t.toFormat("HH:mm"), startISO: t.toISO(), endISO: end.toISO() });
  }

  return slots;
}

let zoomTokenCache = { token: null, exp: 0 };

async function getZoomAccessToken() {
  if (!bookingEnabled) {
    const err = new Error("Booking service is not configured.");
    err.code = "BOOKING_NOT_CONFIGURED";
    throw err;
  }

  const now = Date.now();
  if (zoomTokenCache.token && zoomTokenCache.exp - now > 60_000) {
    return zoomTokenCache.token;
  }

  const basic = Buffer.from(`${bookingEnv.ZOOM_CLIENT_ID}:${bookingEnv.ZOOM_CLIENT_SECRET}`).toString("base64");
  const url = new URL("https://zoom.us/oauth/token");
  url.searchParams.set("grant_type", "account_credentials");
  url.searchParams.set("account_id", bookingEnv.ZOOM_ACCOUNT_ID);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    console.error("Zoom token request failed with status", response.status);
    throw new Error("Zoom authentication failed.");
  }

  const data = await response.json();
  if (!data?.access_token || !Number(data.expires_in)) {
    throw new Error("Zoom authentication response was invalid.");
  }
  zoomTokenCache = { token: data.access_token, exp: now + Number(data.expires_in) * 1000 };
  return zoomTokenCache.token;
}

async function createZoomMeeting(booking, start, zone) {
  const zoomToken = await getZoomAccessToken();
  const response = await fetch(
    `https://api.zoom.us/v2/users/${encodeURIComponent(bookingEnv.ZOOM_HOST_USER_ID)}/meetings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${zoomToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: `${booking.product} — ${booking.purpose} (${booking.name})`,
        type: 2,
        start_time: start.toUTC().toISO(),
        timezone: zone,
        duration: booking.durationMin,
        agenda: booking.notes ? booking.notes.slice(0, 1800) : "",
        settings: { waiting_room: true, mute_upon_entry: true },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    console.error("Zoom meeting creation failed with status", response.status);
    throw new Error("Video meeting creation failed.");
  }
  const meeting = await response.json();
  if (!meeting?.id || !meeting?.join_url) throw new Error("Video meeting response was incomplete.");
  return meeting;
}

async function deleteZoomMeeting(meetingId) {
  if (!meetingId) return;
  try {
    const token = await getZoomAccessToken();
    const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(String(meetingId))}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 404) {
      console.error("Zoom compensation delete failed with status", response.status);
    }
  } catch (error) {
    console.error("Zoom compensation delete failed:", error?.message || error);
  }
}

async function deleteCalendarEvent(googleClient, eventId) {
  if (!eventId || !googleClient?.calendar) return;
  try {
    await googleClient.calendar.events.delete({
      calendarId: googleClient.calendarId,
      eventId,
      sendUpdates: "all",
    });
  } catch (error) {
    console.error("Calendar compensation delete failed:", error?.message || error);
  }
}

const BookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.coerce.number().int().refine((n) => ALLOWED_DURATIONS.includes(n)),
  product: z.enum(["Classic Academy"]),
  purpose: z.enum(["Demo", "Onboarding", "Support"]),
  company: z.string().max(200).optional().default(""),
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(60).optional().default(""),
  notes: z.string().max(2000).optional().default(""),
  hp: z.string().optional().default(""),
});

function configuredPublicOrigin(req) {
  const configured = String(process.env.PUBLIC_SITE_URL || process.env.PLATFORM_SITE_URL || "").trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "https:" || (process.env.NODE_ENV !== "production" && parsed.protocol === "http:")) {
        return parsed.origin;
      }
    } catch (_) {}
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_SITE_URL or PLATFORM_SITE_URL is required for booking URLs in production.");
  }
  const hostname = String(req.hostname || "localhost").trim().toLowerCase();
  if (!/^(?:localhost|127\.0\.0\.1|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/.test(hostname)) {
    throw new Error("Request hostname is invalid.");
  }
  const localPort = Number(req.socket?.localPort || process.env.PORT || 0);
  const port = localPort > 0 && localPort <= 65535 ? `:${localPort}` : "";
  return `${req.protocol === "https" ? "https" : "http"}://${hostname}${port}`;
}

function renderSchedule(req, res) {
  const baseUrl = configuredPublicOrigin(req);
  res.set("Cache-Control", "no-cache, max-age=0");
  return res.render("platform/public/schedule", { baseUrl, pageUrl: `${baseUrl}/schedule` });
}

function validBookingWindow(start, durationMin) {
  const zone = bookingEnv.BOOKING_TIMEZONE;
  if (!start?.isValid || start.zoneName !== zone) return false;
  const now = DateTime.now().setZone(zone);
  const earliest = now.plus({ minutes: bookingEnv.LEAD_MINUTES });
  const latest = now.plus({ days: bookingEnv.MAX_ADVANCE_DAYS });
  if (start < earliest || start > latest) return false;
  if (start.minute % bookingEnv.SLOT_INTERVAL_MIN !== 0 || start.second !== 0) return false;

  const dayStart = start.startOf("day").set({ hour: bookingEnv.BOOKING_START_HOUR });
  const dayEnd = start.startOf("day").set({ hour: bookingEnv.BOOKING_END_HOUR });
  const end = start.plus({ minutes: durationMin });
  return start >= dayStart && end <= dayEnd;
}

function bookingSegments(start, end) {
  const segments = [];
  for (let t = start.toUTC(); t < end.toUTC(); t = t.plus({ minutes: SLOT_SEGMENT_MINUTES })) {
    segments.push(t.toFormat("yyyyLLdd'T'HHmm'Z'"));
  }
  return segments;
}

function bookingCode() {
  return `BK-${DateTime.utc().toFormat("yyyyLLdd")}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
}

async function acquireSlotClaim({ booking, start, end, req }) {
  await releaseExpiredClaims();
  const payload = {
    bookingCode: bookingCode(),
    slotSegments: bookingSegments(start, end),
    blocksSlot: true,
    status: "claimed",
    claimExpiresAt: new Date(Date.now() + bookingEnv.CLAIM_TTL_MINUTES * 60_000),
    startAt: start.toUTC().toJSDate(),
    endAt: end.toUTC().toJSDate(),
    timezone: bookingEnv.BOOKING_TIMEZONE,
    durationMin: booking.durationMin,
    product: booking.product,
    purpose: booking.purpose,
    company: booking.company,
    name: booking.name,
    email: booking.email.toLowerCase(),
    phone: booking.phone,
    notes: booking.notes,
    ipHash: privacyHmac("platform-booking-ip", String(req.ip || "")),
    userAgentHash: privacyHmac("platform-booking-ua", String(req.get("user-agent") || "").slice(0, 400)),
    revision: 1,
  };

  try {
    return await PlatformBooking.create(payload);
  } catch (error) {
    if (error?.code === 11000) {
      const slotConflict = error?.keyPattern?.slotSegments || error?.keyValue?.slotSegments;
      if (slotConflict) return null;
      payload.bookingCode = bookingCode();
      try {
        return await PlatformBooking.create(payload);
      } catch (retryError) {
        if (retryError?.code === 11000) return null;
        throw retryError;
      }
    }
    throw error;
  }
}

async function failClaim(claimId, reason) {
  if (!claimId) return;
  await PlatformBooking.updateOne(
    { _id: claimId, status: "claimed" },
    {
      $set: {
        status: "failed",
        blocksSlot: false,
        claimExpiresAt: null,
        failureReason: String(reason || "Booking failed.").slice(0, 500),
      },
      $inc: { revision: 1 },
    },
  );
}

async function combinedBusy(googleClient, start, end) {
  const [googleBusy, localBusy] = await Promise.all([
    freeBusyBetween(googleClient, start.toUTC().toISO(), end.toUTC().toISO()),
    localBusyBetween(start.toUTC(), end.toUTC()),
  ]);
  return [...googleBusy, ...localBusy];
}

async function monthAvailability(req, res) {
  try {
    const googleClient = await ensureGoogleAuth();
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const durationMin = normalizeDuration(req.query.duration);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ ok: false, message: "Invalid year" });
    if (!Number.isInteger(month) || month < 1 || month > 12) return res.status(400).json({ ok: false, message: "Invalid month" });
    if (!durationMin) return res.status(400).json({ ok: false, message: "Invalid duration" });

    const zone = bookingEnv.BOOKING_TIMEZONE;
    const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone }).set({ hour: bookingEnv.BOOKING_START_HOUR, minute: 0, second: 0, millisecond: 0 });
    if (!monthStart.isValid) return res.status(400).json({ ok: false, message: "Invalid month" });
    const monthEnd = monthStart.plus({ months: 1 }).set({ hour: bookingEnv.BOOKING_END_HOUR, minute: 0, second: 0, millisecond: 0 });
    const [googleBusy, localBusy] = await Promise.all([
      freeBusyBetween(googleClient, monthStart.toUTC().toISO(), monthEnd.toUTC().toISO()),
      localBusyBetween(monthStart.toUTC(), monthEnd.toUTC()),
    ]);
    const busyUTC = [...googleBusy, ...localBusy];
    const now = DateTime.now().setZone(zone);
    const maxStartAt = now.plus({ days: bookingEnv.MAX_ADVANCE_DAYS });
    const days = [];

    for (let day = 1; day <= monthStart.daysInMonth; day += 1) {
      const dayStart = DateTime.fromObject({ year, month, day }, { zone }).set({ hour: bookingEnv.BOOKING_START_HOUR, minute: 0, second: 0, millisecond: 0 });
      const dayEnd = DateTime.fromObject({ year, month, day }, { zone }).set({ hour: bookingEnv.BOOKING_END_HOUR, minute: 0, second: 0, millisecond: 0 });
      if (dayEnd <= now) {
        days.push({ date: isoKey(dayStart), availableSlots: 0, status: "past" });
        continue;
      }
      if (dayStart > maxStartAt.endOf("day")) {
        days.push({ date: isoKey(dayStart), availableSlots: 0, status: "unavailable" });
        continue;
      }
      const dayWindowUTC = Interval.fromDateTimes(dayStart.toUTC(), dayEnd.toUTC());
      const dayBusy = busyUTC.filter((busy) => busy.overlaps(dayWindowUTC));
      const slots = computeSlotsForDay({
        dayStart,
        dayEnd,
        durationMin,
        slotIntervalMin: bookingEnv.SLOT_INTERVAL_MIN,
        busyIntervals: dayBusy,
        leadMinutes: dayStart.hasSame(now, "day") ? bookingEnv.LEAD_MINUTES : 0,
        maxStartAt,
      });
      days.push({ date: isoKey(dayStart), availableSlots: slots.length, status: slots.length ? "available" : "booked" });
    }

    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, timezone: zone, year, month, durationMin, days });
  } catch (error) {
    return publicBookingError(res, error, "Availability is temporarily unavailable.");
  }
}

async function dayAvailability(req, res) {
  try {
    const googleClient = await ensureGoogleAuth();
    const dateStr = String(req.query.date || "");
    const durationMin = normalizeDuration(req.query.duration);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ ok: false, message: "Invalid date format" });
    if (!durationMin) return res.status(400).json({ ok: false, message: "Invalid duration" });

    const zone = bookingEnv.BOOKING_TIMEZONE;
    const dayStart = DateTime.fromISO(dateStr, { zone }).set({ hour: bookingEnv.BOOKING_START_HOUR, minute: 0, second: 0, millisecond: 0 });
    if (!dayStart.isValid) return res.status(400).json({ ok: false, message: "Invalid date" });
    const dayEnd = dayStart.set({ hour: bookingEnv.BOOKING_END_HOUR });
    const now = DateTime.now().setZone(zone);
    const maxStartAt = now.plus({ days: bookingEnv.MAX_ADVANCE_DAYS });
    if (dayEnd <= now || dayStart > maxStartAt.endOf("day")) {
      return res.json({ ok: true, timezone: zone, date: dateStr, durationMin, slots: [] });
    }

    const busyUTC = await combinedBusy(googleClient, dayStart, dayEnd);
    const slots = computeSlotsForDay({
      dayStart,
      dayEnd,
      durationMin,
      slotIntervalMin: bookingEnv.SLOT_INTERVAL_MIN,
      busyIntervals: busyUTC,
      leadMinutes: bookingEnv.LEAD_MINUTES,
      maxStartAt,
    });
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, timezone: zone, date: dateStr, durationMin, slots });
  } catch (error) {
    return publicBookingError(res, error, "Availability is temporarily unavailable.");
  }
}

async function book(req, res) {
  let claim = null;
  let googleClient = null;
  let calendarApi = null;
  let zoom = null;
  let calendarEvent = null;
  try {
    googleClient = await ensureGoogleAuth();
    calendarApi = googleClient.calendar;
    const parsed = BookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, message: "Invalid booking details." });
    }
    const booking = parsed.data;
    if (booking.hp) return res.status(400).json({ ok: false, message: "Invalid booking details." });

    const zone = bookingEnv.BOOKING_TIMEZONE;
    const start = DateTime.fromISO(`${booking.date}T${booking.time}`, { zone });
    if (!validBookingWindow(start, booking.durationMin)) {
      return res.status(400).json({ ok: false, message: "That booking time is not available." });
    }
    const end = start.plus({ minutes: booking.durationMin });

    claim = await acquireSlotClaim({ booking, start, end, req });
    if (!claim) {
      return res.status(409).json({ ok: false, message: "That slot was just taken. Choose another." });
    }

    const googleBusy = await freeBusyBetween(googleClient, start.toUTC().toISO(), end.toUTC().toISO());
    if (googleBusy.length) {
      await failClaim(claim._id, "Calendar reported the slot as busy after claim.");
      return res.status(409).json({ ok: false, message: "That slot was just taken. Choose another." });
    }

    zoom = await createZoomMeeting(booking, start, zone);
    const hostEmails = bookingEnv.HOST_EMAILS.split(",").map((value) => value.trim()).filter(Boolean);
    const attendees = [{ email: booking.email, displayName: booking.name }, ...hostEmails.map((email) => ({ email }))];
    const description = [
      `Zoom: ${zoom.join_url}`,
      "",
      `Product: ${booking.product}`,
      `Purpose: ${booking.purpose}`,
      "",
      `Name: ${booking.name}`,
      `Email: ${booking.email}`,
      booking.phone ? `Phone: ${booking.phone}` : null,
      booking.company ? `Institution: ${booking.company}` : null,
      "",
      "Notes:",
      booking.notes || "-",
    ].filter(Boolean).join("\n");

    try {
      calendarEvent = await calendarApi.events.insert({
        calendarId: googleClient.calendarId,
        sendUpdates: "all",
        requestBody: {
          summary: `${booking.product} — ${booking.purpose}`,
          description,
          location: zoom.join_url,
          start: { dateTime: start.toISO(), timeZone: zone },
          end: { dateTime: end.toISO(), timeZone: zone },
          attendees,
          reminders: { useDefault: true },
        },
      });
      await googleCalendar.markSuccess(googleClient.credentialId).catch(() => {});
    } catch (error) {
      throw await googleCalendar.normalizeCalendarError(error, googleClient.credentialId);
    }

    const eventId = String(calendarEvent?.data?.id || "");
    if (!eventId) throw new Error("Calendar booking response was incomplete.");

    const confirmed = await PlatformBooking.findOneAndUpdate(
      { _id: claim._id, status: "claimed", revision: Number(claim.revision || 1) },
      {
        $set: {
          status: "confirmed",
          blocksSlot: true,
          claimExpiresAt: null,
          zoomMeetingId: String(zoom.id),
          calendarEventId: eventId,
          calendarHtmlLink: String(calendarEvent.data.htmlLink || "").slice(0, 1000),
          failureReason: "",
        },
        $inc: { revision: 1 },
      },
      { new: true },
    ).lean();

    if (!confirmed) {
      await deleteCalendarEvent(googleClient, eventId);
      await deleteZoomMeeting(zoom.id);
      await failClaim(claim._id, "Booking confirmation lost a revision race.");
      return res.status(503).json({ ok: false, message: "Booking could not be confirmed. Please choose the slot again." });
    }

    res.set("Cache-Control", "no-store");
    return res.status(201).json({
      ok: true,
      bookingCode: confirmed.bookingCode,
      zoom: { join_url: zoom.join_url },
      calendar: { htmlLink: confirmed.calendarHtmlLink || "" },
    });
  } catch (error) {
    if (calendarEvent?.data?.id && googleClient) await deleteCalendarEvent(googleClient, calendarEvent.data.id);
    if (zoom?.id) await deleteZoomMeeting(zoom.id);
    if (claim?._id) {
      try { await failClaim(claim._id, "External booking operation failed."); } catch (_) {}
    }
    return publicBookingError(res, error, "Booking could not be completed. Please try another slot.");
  }
}

module.exports = {
  bookingNonce,
  bookingCsp,
  bookingApiLimiter,
  bookingSubmitLimiter,
  renderSchedule,
  monthAvailability,
  dayAvailability,
  book,
  computeSlotsForDay,
  bookingSegments,
  validBookingWindow,
  releaseExpiredClaims,
};

const { z } = require("zod");
const { DateTime, Interval } = require("luxon");
const { google } = require("googleapis");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

const bookingEnv = {
  BOOKING_TIMEZONE: process.env.BOOKING_TIMEZONE || "Africa/Kampala",
  BOOKING_START_HOUR: Number(process.env.BOOKING_START_HOUR || 9),
  BOOKING_END_HOUR: Number(process.env.BOOKING_END_HOUR || 17),
  DEFAULT_DURATION_MIN: Number(process.env.DEFAULT_DURATION_MIN || 30),
  SLOT_INTERVAL_MIN: Number(process.env.SLOT_INTERVAL_MIN || 30),
  LEAD_MINUTES: Number(process.env.LEAD_MINUTES || 10),

  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || "primary",
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  GOOGLE_OAUTH_REFRESH_TOKEN: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,

  HOST_EMAILS: process.env.HOST_EMAILS || "",

  ZOOM_ACCOUNT_ID: process.env.ZOOM_ACCOUNT_ID,
  ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID,
  ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET,
  ZOOM_HOST_USER_ID: process.env.ZOOM_HOST_USER_ID || "me",
};

const bookingEnabled =
  !!bookingEnv.GOOGLE_OAUTH_CLIENT_ID &&
  !!bookingEnv.GOOGLE_OAUTH_CLIENT_SECRET &&
  !!bookingEnv.GOOGLE_OAUTH_REDIRECT_URI &&
  !!bookingEnv.ZOOM_ACCOUNT_ID &&
  !!bookingEnv.ZOOM_CLIENT_ID &&
  !!bookingEnv.ZOOM_CLIENT_SECRET;

if (!bookingEnabled) {
  console.warn(
    "⚠️ Booking is not fully configured. Missing Google OAuth and/or Zoom env vars. /schedule will render, but booking APIs will fail until configured.",
  );
}

const bookingCsp = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'"],
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
    "img-src": ["'self'", "data:", "https://res.cloudinary.com"],
    "connect-src": ["'self'"],
  },
});

const bookingApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

const oauth2Client = new google.auth.OAuth2(
  bookingEnv.GOOGLE_OAUTH_CLIENT_ID,
  bookingEnv.GOOGLE_OAUTH_CLIENT_SECRET,
  bookingEnv.GOOGLE_OAUTH_REDIRECT_URI,
);

function ensureGoogleAuth() {
  if (!bookingEnabled) {
    throw new Error("Booking is not configured (missing Google/Zoom env vars).");
  }

  if (!bookingEnv.GOOGLE_OAUTH_REFRESH_TOKEN) {
    throw new Error("Missing GOOGLE_OAUTH_REFRESH_TOKEN. Visit /google/auth to generate it.");
  }

  oauth2Client.setCredentials({
    refresh_token: bookingEnv.GOOGLE_OAUTH_REFRESH_TOKEN,
  });

  return google.calendar({
    version: "v3",
    auth: oauth2Client,
  });
}

const pad = (n) => String(n).padStart(2, "0");
const isoKey = (dt) => `${dt.year}-${pad(dt.month)}-${pad(dt.day)}`;

function overlapsAny(slotInterval, busyIntervals) {
  return busyIntervals.some((busyInterval) => slotInterval.overlaps(busyInterval));
}

async function freeBusyBetween(calendarApi, timeMinISO, timeMaxISO) {
  const fb = await calendarApi.freebusy.query({
    requestBody: {
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      items: [{ id: bookingEnv.GOOGLE_CALENDAR_ID }],
    },
  });

  const busy = fb.data.calendars?.[bookingEnv.GOOGLE_CALENDAR_ID]?.busy || [];

  return busy.map((b) =>
    Interval.fromDateTimes(
      DateTime.fromISO(b.start),
      DateTime.fromISO(b.end),
    ),
  );
}

function computeSlotsForDay({
  dayStart,
  dayEnd,
  durationMin,
  slotIntervalMin,
  busyIntervals,
  leadMinutes,
}) {
  const slots = [];
  const now = DateTime.now().setZone(dayStart.zoneName).plus({ minutes: leadMinutes });

  for (
    let t = dayStart;
    t.plus({ minutes: durationMin }) <= dayEnd;
    t = t.plus({ minutes: slotIntervalMin })
  ) {
    if (t < now) continue;

    const end = t.plus({ minutes: durationMin });
    const slotInterval = Interval.fromDateTimes(t.toUTC(), end.toUTC());

    if (overlapsAny(slotInterval, busyIntervals)) continue;

    slots.push({
      time: t.toFormat("HH:mm"),
      startISO: t.toISO(),
      endISO: end.toISO(),
    });
  }

  return slots;
}

let zoomTokenCache = {
  token: null,
  exp: 0,
};

async function getZoomAccessToken() {
  if (!bookingEnabled) {
    throw new Error("Booking is not configured (missing Google/Zoom env vars).");
  }

  const now = Date.now();

  if (zoomTokenCache.token && zoomTokenCache.exp - now > 60_000) {
    return zoomTokenCache.token;
  }

  const basic = Buffer.from(
    `${bookingEnv.ZOOM_CLIENT_ID}:${bookingEnv.ZOOM_CLIENT_SECRET}`,
  ).toString("base64");

  const url = new URL("https://zoom.us/oauth/token");
  url.searchParams.set("grant_type", "account_credentials");
  url.searchParams.set("account_id", bookingEnv.ZOOM_ACCOUNT_ID);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Zoom token error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();

  zoomTokenCache = {
    token: data.access_token,
    exp: now + data.expires_in * 1000,
  };

  return zoomTokenCache.token;
}

const BookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.coerce.number().int().min(15).max(180),

  product: z.enum(["Classic Academy", "Classic Campus", "Both"]),
  purpose: z.enum(["Demo", "Onboarding", "Support"]),

  company: z.string().max(200).optional().default(""),
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(60).optional().default(""),
  notes: z.string().max(2000).optional().default(""),

  hp: z.string().optional().default(""),
});

function renderSchedule(req, res) {
  const forwardedProto = (req.headers["x-forwarded-proto"] || "")
    .toString()
    .split(",")[0]
    .trim();

  const proto = forwardedProto || req.protocol;
  const baseUrl = `${proto}://${req.get("host")}`;
  const pageUrl = `${baseUrl}/schedule`;

  return res.render("platform/public/schedule", {
    baseUrl,
    pageUrl,
  });
}

function googleAuth(req, res) {
  if (
    !bookingEnv.GOOGLE_OAUTH_CLIENT_ID ||
    !bookingEnv.GOOGLE_OAUTH_CLIENT_SECRET ||
    !bookingEnv.GOOGLE_OAUTH_REDIRECT_URI
  ) {
    return res
      .status(500)
      .send("Google OAuth env vars missing (CLIENT_ID/SECRET/REDIRECT_URI).");
  }

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });

  return res.redirect(url);
}

async function oauthCallback(req, res) {
  try {
    const code = String(req.query.code || "");

    if (!code) {
      return res.status(400).send("Missing code.");
    }

    const { tokens } = await oauth2Client.getToken(code);

    return res.type("text/plain").send(
      `TOKENS RECEIVED:\n\n${JSON.stringify(tokens, null, 2)}\n\n` +
        "Copy tokens.refresh_token into GOOGLE_OAUTH_REFRESH_TOKEN in your .env, then restart.",
    );
  } catch (error) {
    return res.status(500).send(error.message || "OAuth error");
  }
}

async function monthAvailability(req, res) {
  try {
    const calendarApi = ensureGoogleAuth();

    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const durationMin = Number(req.query.duration || bookingEnv.DEFAULT_DURATION_MIN);

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ ok: false, message: "Invalid year" });
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ ok: false, message: "Invalid month" });
    }

    const zone = bookingEnv.BOOKING_TIMEZONE;

    const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone }).set({
      hour: bookingEnv.BOOKING_START_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    const monthEnd = monthStart.plus({ months: 1 }).set({
      hour: bookingEnv.BOOKING_END_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    const busyUTC = await freeBusyBetween(
      calendarApi,
      monthStart.toUTC().toISO(),
      monthEnd.toUTC().toISO(),
    );

    const now = DateTime.now().setZone(zone);
    const days = [];

    for (let day = 1; day <= monthStart.daysInMonth; day += 1) {
      const dayStart = DateTime.fromObject({ year, month, day }, { zone }).set({
        hour: bookingEnv.BOOKING_START_HOUR,
        minute: 0,
        second: 0,
        millisecond: 0,
      });

      const dayEnd = DateTime.fromObject({ year, month, day }, { zone }).set({
        hour: bookingEnv.BOOKING_END_HOUR,
        minute: 0,
        second: 0,
        millisecond: 0,
      });

      if (dayEnd <= now) {
        days.push({
          date: isoKey(dayStart),
          availableSlots: 0,
          status: "past",
        });
        continue;
      }

      const dayWindowUTC = Interval.fromDateTimes(dayStart.toUTC(), dayEnd.toUTC());
      const dayBusy = busyUTC.filter((busyInterval) => busyInterval.overlaps(dayWindowUTC));

      const leadMinutes = dayStart.hasSame(now, "day") ? bookingEnv.LEAD_MINUTES : 0;

      const slots = computeSlotsForDay({
        dayStart,
        dayEnd,
        durationMin,
        slotIntervalMin: bookingEnv.SLOT_INTERVAL_MIN,
        busyIntervals: dayBusy,
        leadMinutes,
      });

      days.push({
        date: isoKey(dayStart),
        availableSlots: slots.length,
        status: slots.length > 0 ? "available" : "booked",
      });
    }

    return res.json({
      ok: true,
      timezone: zone,
      year,
      month,
      durationMin,
      days,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Server error",
    });
  }
}

async function dayAvailability(req, res) {
  try {
    const calendarApi = ensureGoogleAuth();

    const dateStr = String(req.query.date || "");
    const durationMin = Number(req.query.duration || bookingEnv.DEFAULT_DURATION_MIN);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ ok: false, message: "Invalid date format" });
    }

    const zone = bookingEnv.BOOKING_TIMEZONE;

    const dayStart = DateTime.fromISO(dateStr, { zone }).set({
      hour: bookingEnv.BOOKING_START_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    const dayEnd = DateTime.fromISO(dateStr, { zone }).set({
      hour: bookingEnv.BOOKING_END_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    if (dayEnd <= DateTime.now().setZone(zone)) {
      return res.json({
        ok: true,
        timezone: zone,
        date: dateStr,
        durationMin,
        slots: [],
      });
    }

    const busyUTC = await freeBusyBetween(
      calendarApi,
      dayStart.toUTC().toISO(),
      dayEnd.toUTC().toISO(),
    );

    const slots = computeSlotsForDay({
      dayStart,
      dayEnd,
      durationMin,
      slotIntervalMin: bookingEnv.SLOT_INTERVAL_MIN,
      busyIntervals: busyUTC,
      leadMinutes: bookingEnv.LEAD_MINUTES,
    });

    return res.json({
      ok: true,
      timezone: zone,
      date: dateStr,
      durationMin,
      slots,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Server error",
    });
  }
}

async function book(req, res) {
  try {
    const calendarApi = ensureGoogleAuth();

    const parsed = BookingSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        message: "Invalid payload",
        issues: parsed.error.issues,
      });
    }

    const booking = parsed.data;

    if (booking.hp) {
      return res.status(400).json({
        ok: false,
        message: "Bot rejected",
      });
    }

    const zone = bookingEnv.BOOKING_TIMEZONE;
    const start = DateTime.fromISO(`${booking.date}T${booking.time}`, { zone });
    const end = start.plus({ minutes: booking.durationMin });

    const busyNow = await freeBusyBetween(
      calendarApi,
      start.toUTC().toISO(),
      end.toUTC().toISO(),
    );

    if (busyNow.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "That slot was just taken. Choose another.",
      });
    }

    const zoomToken = await getZoomAccessToken();

    const zoomResp = await fetch(
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
          settings: {
            waiting_room: true,
            mute_upon_entry: true,
          },
        }),
      },
    );

    if (!zoomResp.ok) {
      return res.status(502).json({
        ok: false,
        message: `Zoom create meeting failed: ${zoomResp.status} ${await zoomResp.text()}`,
      });
    }

    const zoom = await zoomResp.json();

    const hostEmails = bookingEnv.HOST_EMAILS
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const attendees = [
      { email: booking.email, displayName: booking.name },
      ...hostEmails.map((email) => ({ email })),
    ];

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
    ]
      .filter(Boolean)
      .join("\n");

    const event = await calendarApi.events.insert({
      calendarId: bookingEnv.GOOGLE_CALENDAR_ID,
      sendUpdates: "all",
      requestBody: {
        summary: `${booking.product} — ${booking.purpose}`,
        description,
        location: zoom.join_url,
        start: {
          dateTime: start.toISO(),
          timeZone: zone,
        },
        end: {
          dateTime: end.toISO(),
          timeZone: zone,
        },
        attendees,
        reminders: {
          useDefault: true,
        },
      },
    });

    return res.json({
      ok: true,
      zoom: {
        join_url: zoom.join_url,
        start_url: zoom.start_url,
      },
      calendar: {
        htmlLink: event.data.htmlLink,
        eventId: event.data.id,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Server error",
    });
  }
}

module.exports = {
  bookingCsp,
  bookingApiLimiter,
  renderSchedule,
  googleAuth,
  oauthCallback,
  monthAvailability,
  dayAvailability,
  book,
};
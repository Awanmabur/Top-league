require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { DateTime, Interval } = require("luxon");
const { google } = require("googleapis");

const app = express();

// ✅ Fix “inline script blocked” problem for this 1-page view
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(express.json({ limit: "200kb" }));

// ✅ Static assets (images/css/js in /public)
app.use(express.static(path.join(__dirname, "public")));

app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  })
);


// ✅ EJS setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ============================================================
   ✅ CLEAN ROUTES FOR EJS PAGES
   - Home is: views/index.ejs
   - Other pages live in: views/pages/*.ejs (and nested folders)
   ============================================================ */

const render = (res, view, data = {}) => res.render(view, data);

// Home page
app.get("/", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const pageUrl = `${baseUrl}/`;
  return render(res, "index", { baseUrl, pageUrl });
});

// Map clean routes -> views/pages/*
const pageRoutes = {
  "/about": "pages/about",
  "/features": "pages/features",
  "/services": "pages/services",

  "/schools": "pages/schools",
  "/search": "pages/search",
  "/contact": "pages/contact",

  "/schedule": "pages/schedule",
  "/plan": "pages/plan",
  "/blog": "pages/blog",

  "/careers": "pages/careers",
  "/faq": "pages/faq",
  "/privacy": "pages/privacy",
  "/terms": "pages/terms",
  "/admissions": "pages/admissions",
  "/share": "pages/share",
};

// Register routes
Object.entries(pageRoutes).forEach(([route, view]) => {
  app.get(route, (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const pageUrl = `${baseUrl}${route}`;
    return render(res, view, { baseUrl, pageUrl });
  });
});

// ✅ Booking page route: http://localhost:3000/book
app.get("/book", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const pageUrl = `${baseUrl}/book`;
  res.render("book", { baseUrl, pageUrl });
});

/* ============================================================
   END CLEAN ROUTES
   ============================================================ */

// ---------- Env ----------
const env = {
  PORT: Number(process.env.PORT || 3000),

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

if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) {
  throw new Error("Missing Google OAuth env vars (CLIENT_ID/SECRET/REDIRECT_URI).");
}
if (!env.ZOOM_ACCOUNT_ID || !env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) {
  throw new Error("Missing Zoom env vars.");
}

// ---------- Google OAuth client ----------
const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_OAUTH_CLIENT_ID,
  env.GOOGLE_OAUTH_CLIENT_SECRET,
  env.GOOGLE_OAUTH_REDIRECT_URI
);

function ensureGoogleAuth() {
  if (!env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    throw new Error("Missing GOOGLE_OAUTH_REFRESH_TOKEN. Visit /google/auth to generate it.");
  }
  oauth2Client.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

// 1) Visit this once to generate refresh token
app.get("/google/auth", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });
  res.redirect(url);
});

// 2) Google redirects here
app.get("/oauth2/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    if (!code) return res.status(400).send("Missing code.");

    const { tokens } = await oauth2Client.getToken(code);
    res.type("text/plain").send(
      `TOKENS RECEIVED:\n\n${JSON.stringify(tokens, null, 2)}\n\n` +
      `Copy tokens.refresh_token into GOOGLE_OAUTH_REFRESH_TOKEN in your .env, then restart.`
    );
  } catch (e) {
    res.status(500).send(e.message || "OAuth error");
  }
});

// ---------- Helpers ----------
const pad = (n) => String(n).padStart(2, "0");
const isoKey = (dt) => `${dt.year}-${pad(dt.month)}-${pad(dt.day)}`;

function overlapsAny(slotInterval, busyIntervals) {
  return busyIntervals.some((b) => slotInterval.overlaps(b));
}

function parseHostEmails() {
  return env.HOST_EMAILS.split(",").map((s) => s.trim()).filter(Boolean);
}

async function freeBusyBetween(calendarApi, timeMinISO, timeMaxISO) {
  const fb = await calendarApi.freebusy.query({
    requestBody: {
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      items: [{ id: env.GOOGLE_CALENDAR_ID }],
    },
  });

  const busy = fb.data.calendars?.[env.GOOGLE_CALENDAR_ID]?.busy || [];
  return busy.map((b) => Interval.fromDateTimes(DateTime.fromISO(b.start), DateTime.fromISO(b.end)));
}

function computeSlotsForDay({ dayStart, dayEnd, durationMin, slotIntervalMin, busyIntervals, leadMinutes }) {
  const slots = [];
  const now = DateTime.now().setZone(dayStart.zoneName).plus({ minutes: leadMinutes });

  for (let t = dayStart; t.plus({ minutes: durationMin }) <= dayEnd; t = t.plus({ minutes: slotIntervalMin })) {
    if (t < now) continue;
    const end = t.plus({ minutes: durationMin });
    const slotI = Interval.fromDateTimes(t.toUTC(), end.toUTC());
    if (overlapsAny(slotI, busyIntervals)) continue;

    slots.push({ time: t.toFormat("HH:mm"), startISO: t.toISO(), endISO: end.toISO() });
  }
  return slots;
}

// ---------- API: Month availability ----------
app.get("/api/month-availability", async (req, res) => {
  try {
    const calendarApi = ensureGoogleAuth();

    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const durationMin = Number(req.query.duration || env.DEFAULT_DURATION_MIN);

    if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ ok: false, message: "Invalid year" });
    if (!Number.isInteger(month) || month < 1 || month > 12) return res.status(400).json({ ok: false, message: "Invalid month" });

    const zone = env.BOOKING_TIMEZONE;
    const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone }).set({
      hour: env.BOOKING_START_HOUR, minute: 0, second: 0, millisecond: 0
    });
    const monthEnd = monthStart.plus({ months: 1 }).set({
      hour: env.BOOKING_END_HOUR, minute: 0, second: 0, millisecond: 0
    });

    const busyUTC = await freeBusyBetween(calendarApi, monthStart.toUTC().toISO(), monthEnd.toUTC().toISO());
    const now = DateTime.now().setZone(zone);

    const days = [];
    for (let d = 1; d <= monthStart.daysInMonth; d++) {
      const dayStart = DateTime.fromObject({ year, month, day: d }, { zone }).set({
        hour: env.BOOKING_START_HOUR, minute: 0, second: 0, millisecond: 0
      });
      const dayEnd = DateTime.fromObject({ year, month, day: d }, { zone }).set({
        hour: env.BOOKING_END_HOUR, minute: 0, second: 0, millisecond: 0
      });

      if (dayEnd <= now) {
        days.push({ date: isoKey(dayStart), availableSlots: 0, status: "past" });
        continue;
      }

      const dayWindowUTC = Interval.fromDateTimes(dayStart.toUTC(), dayEnd.toUTC());
      const dayBusy = busyUTC.filter((b) => b.overlaps(dayWindowUTC));

      const leadMinutes = dayStart.hasSame(now, "day") ? env.LEAD_MINUTES : 0;
      const slots = computeSlotsForDay({
        dayStart,
        dayEnd,
        durationMin,
        slotIntervalMin: env.SLOT_INTERVAL_MIN,
        busyIntervals: dayBusy,
        leadMinutes,
      });

      days.push({
        date: isoKey(dayStart),
        availableSlots: slots.length,
        status: slots.length > 0 ? "available" : "booked",
      });
    }

    res.json({ ok: true, timezone: zone, year, month, durationMin, days });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || "Server error" });
  }
});

// ---------- API: Day availability ----------
app.get("/api/availability", async (req, res) => {
  try {
    const calendarApi = ensureGoogleAuth();

    const dateStr = String(req.query.date || "");
    const durationMin = Number(req.query.duration || env.DEFAULT_DURATION_MIN);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ ok: false, message: "Invalid date format" });

    const zone = env.BOOKING_TIMEZONE;
    const dayStart = DateTime.fromISO(dateStr, { zone }).set({
      hour: env.BOOKING_START_HOUR, minute: 0, second: 0, millisecond: 0
    });
    const dayEnd = DateTime.fromISO(dateStr, { zone }).set({
      hour: env.BOOKING_END_HOUR, minute: 0, second: 0, millisecond: 0
    });

    if (dayEnd <= DateTime.now().setZone(zone)) {
      return res.json({ ok: true, timezone: zone, date: dateStr, durationMin, slots: [] });
    }

    const busyUTC = await freeBusyBetween(calendarApi, dayStart.toUTC().toISO(), dayEnd.toUTC().toISO());

    const slots = computeSlotsForDay({
      dayStart,
      dayEnd,
      durationMin,
      slotIntervalMin: env.SLOT_INTERVAL_MIN,
      busyIntervals: busyUTC,
      leadMinutes: env.LEAD_MINUTES,
    });

    res.json({ ok: true, timezone: zone, date: dateStr, durationMin, slots });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || "Server error" });
  }
});

// ---------- Zoom token cache ----------
let zoomTokenCache = { token: null, exp: 0 };

async function getZoomAccessToken() {
  const now = Date.now();
  if (zoomTokenCache.token && zoomTokenCache.exp - now > 60_000) return zoomTokenCache.token;

  const basic = Buffer.from(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`).toString("base64");
  const url = new URL("https://zoom.us/oauth/token");
  url.searchParams.set("grant_type", "account_credentials");
  url.searchParams.set("account_id", env.ZOOM_ACCOUNT_ID);

  const r = await fetch(url.toString(), { method: "POST", headers: { Authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`Zoom token error: ${r.status} ${await r.text()}`);

  const data = await r.json();
  zoomTokenCache = { token: data.access_token, exp: now + data.expires_in * 1000 };
  return zoomTokenCache.token;
}

// ---------- API: Book ----------
const BookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(15).max(180),

  product: z.enum(["Classic Academy", "Classic Campus", "Both"]),
  purpose: z.enum(["Demo", "Onboarding", "Support"]),

  company: z.string().max(200).optional().default(""),
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(60).optional().default(""),
  notes: z.string().max(2000).optional().default(""),

  hp: z.string().optional().default(""),
});

app.post("/api/book", async (req, res) => {
  try {
    const calendarApi = ensureGoogleAuth();

    const parsed = BookingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid payload", issues: parsed.error.issues });

    const b = parsed.data;
    if (b.hp) return res.status(400).json({ ok: false, message: "Bot rejected" });

    const zone = env.BOOKING_TIMEZONE;
    const start = DateTime.fromISO(`${b.date}T${b.time}`, { zone });
    const end = start.plus({ minutes: b.durationMin });

    const busyNow = await freeBusyBetween(calendarApi, start.toUTC().toISO(), end.toUTC().toISO());
    if (busyNow.length > 0) return res.status(409).json({ ok: false, message: "That slot was just taken. Choose another." });

    // 1) Create Zoom meeting
    const zoomToken = await getZoomAccessToken();
    const zoomResp = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(env.ZOOM_HOST_USER_ID)}/meetings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${zoomToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: `${b.product} — ${b.purpose} (${b.name})`,
        type: 2,
        start_time: start.toUTC().toISO(),
        timezone: zone,
        duration: b.durationMin,
        agenda: b.notes ? b.notes.slice(0, 1800) : "",
        settings: { waiting_room: true, mute_upon_entry: true },
      }),
    });

    if (!zoomResp.ok) {
      return res.status(502).json({ ok: false, message: `Zoom create meeting failed: ${zoomResp.status} ${await zoomResp.text()}` });
    }
    const zoom = await zoomResp.json();

    // 2) Create Calendar event + invite attendees
    const hostEmails = env.HOST_EMAILS.split(",").map(s => s.trim()).filter(Boolean);
    const attendees = [{ email: b.email, displayName: b.name }, ...hostEmails.map(email => ({ email }))];

    const description = [
      `Zoom: ${zoom.join_url}`,
      "",
      `Product: ${b.product}`,
      `Purpose: ${b.purpose}`,
      "",
      `Name: ${b.name}`,
      `Email: ${b.email}`,
      b.phone ? `Phone: ${b.phone}` : null,
      b.company ? `Institution: ${b.company}` : null,
      "",
      "Notes:",
      b.notes || "-",
    ].filter(Boolean).join("\n");

    const event = await calendarApi.events.insert({
      calendarId: env.GOOGLE_CALENDAR_ID,
      sendUpdates: "all",
      requestBody: {
        summary: `${b.product} — ${b.purpose}`,
        description,
        location: zoom.join_url,
        start: { dateTime: start.toISO(), timeZone: zone },
        end: { dateTime: end.toISO(), timeZone: zone },
        attendees,
        reminders: { useDefault: true },
      },
    });

    res.json({
      ok: true,
      zoom: { join_url: zoom.join_url, start_url: zoom.start_url },
      calendar: { htmlLink: event.data.htmlLink, eventId: event.data.id },
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || "Server error" });
  }
});

// 404 (optional) — if you have views/pages/404.ejs
app.use((req, res) => {
  try {
    return res.status(404).render("pages/404", { pageUrl: req.originalUrl });
  } catch {
    return res.status(404).send("404 — Not Found");
  }
});

app.listen(env.PORT, () => console.log(`Server running on http://localhost:${env.PORT}/`));
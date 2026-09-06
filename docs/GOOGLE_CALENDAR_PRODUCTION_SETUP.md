# Classic Academy — Durable Google Calendar Booking Setup

Classic Academy supports two explicit production authentication modes for the public booking calendar:

1. **Workspace service account (`service_account`)** — preferred when the booking calendar belongs to a Google Workspace organization that can grant domain-wide delegation. No user refresh token is stored or refreshed.
2. **OAuth 2.0 (`oauth`)** — use this for ordinary Google accounts or Workspace deployments where domain-wide delegation is not appropriate. The OAuth consent app must be In Production/Internal and the refresh credential is encrypted at rest.

Set exactly one mode with `GOOGLE_CALENDAR_AUTH_MODE`.

## Recommended mode: Workspace service account

This is the most durable option for an organizational booking calendar because there is no end-user refresh token that can expire, be replaced, or be revoked by repeated consent grants.

### Google Cloud / Workspace setup

1. Use a dedicated production Google Cloud project and enable **Google Calendar API**.
2. Create a dedicated service account for Classic Academy booking.
3. Enable **domain-wide delegation** for that service account.
4. In Google Workspace Admin → Security → API controls → Domain-wide delegation, authorize the service account client ID for only:

   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.events.freebusy`

5. Choose the Workspace user that owns/organizes the production booking calendar. Classic Academy impersonates this account with `GOOGLE_SERVICE_ACCOUNT_SUBJECT` so Calendar invitations retain normal organizer/attendee behavior.
6. Create/rotate a service-account private key using Google Cloud's credential controls. Store it only in the deployment secret manager; never commit the JSON key file or PEM to the repository.
7. Base64-encode only the PEM private-key value and configure:

   - `GOOGLE_CALENDAR_AUTH_MODE=service_account`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account>@<project>.iam.gserviceaccount.com`
   - `GOOGLE_SERVICE_ACCOUNT_SUBJECT=<workspace-booking-owner@example.com>`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64=<base64 PEM>`
   - `GOOGLE_CALENDAR_ID=primary` when the delegated subject's primary calendar is the booking calendar, otherwise the exact target calendar ID

8. Do **not** configure `GOOGLE_OAUTH_REFRESH_TOKEN` or `GOOGLE_OAUTH_ALLOW_LEGACY_BOOTSTRAP` in this mode.
9. Deploy, open **Super Admin → Settings → Google Calendar Booking**, and run **Test Connection**.
10. Confirm the card reports **Workspace service account**, `Connected`, and a recent healthy-check timestamp.

The application uses Google's official Node client to sign service-account assertions. The private key is never written into `PlatformIntegrationCredential`; that row stores only non-secret health/status metadata.

### Why domain-wide delegation is required here

The booking lifecycle creates Calendar events with the visitor and configured hosts as attendees. Google Calendar requires a service account to use domain-wide delegation to populate an event attendee list. Classic Academy therefore fails production readiness if the delegated Workspace subject is missing.

## OAuth 2.0 mode

Use OAuth when the production calendar is owned by a normal Google account or when Workspace domain-wide delegation is unavailable.

### Why old manually copied tokens failed

Google access tokens are intentionally short-lived and must be refreshed automatically. A refresh credential can also be invalidated by user revocation, account/security policy, too many replacement grants, or other authorization changes. An External OAuth app left in **Testing** also receives time-limited refresh credentials. Repeatedly generating and pasting refresh tokens is not a durable production design.

### Google Cloud OAuth production setup

1. Use a dedicated production Google Cloud project and enable **Google Calendar API**.
2. Configure the OAuth consent/branding screen with the real production domain, support contact, privacy policy, and requested data use.
3. Set publishing status to **In Production** for an external app, or **Internal** only when the deployment legitimately qualifies inside one Google Workspace organization.
4. Complete Google's required verification when the account/scopes require it.
5. Create an OAuth 2.0 **Web application** client.
6. Register exactly:

   `https://YOUR-PRODUCTION-HOST/super-admin/settings/google-calendar/callback`

7. Classic Academy requests only:

   - `https://www.googleapis.com/auth/calendar.events.owned`
   - `https://www.googleapis.com/auth/calendar.events.freebusy`

8. Configure:

   - `GOOGLE_CALENDAR_AUTH_MODE=oauth`
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REDIRECT_URI`
   - `GOOGLE_OAUTH_CONSENT_STATUS=production` (or `internal` when appropriate)
   - `GOOGLE_CALENDAR_ID=primary` unless a dedicated owned calendar is used

9. Do **not** keep `GOOGLE_OAUTH_REFRESH_TOKEN` as a normal runtime credential.
10. Log in as Super Admin and use **Settings → Google Calendar Booking → Connect** once.
11. Complete Google consent with the account that owns the booking calendar.
12. Return to Settings and run **Test Connection**.

## One-time migration from the old environment token

This applies only to OAuth mode. The legacy token importer is disabled by default.

1. Set `GOOGLE_CALENDAR_AUTH_MODE=oauth`.
2. Temporarily set `GOOGLE_OAUTH_ALLOW_LEGACY_BOOTSTRAP=true` and retain the old `GOOGLE_OAUTH_REFRESH_TOKEN`.
3. Start the application once so the refresh token is encrypted into the platform integration record.
4. Immediately reconnect from **Super Admin → Settings → Google Calendar Booking → Connect**.
5. Remove both legacy variables and redeploy.

Do not repeatedly create new refresh tokens.

## Runtime behavior

In OAuth mode Classic Academy:

- encrypts the refresh credential at rest;
- excludes encrypted fields from normal model queries;
- refreshes short-lived access tokens automatically;
- persists Google refresh-token rotation;
- validates granted Calendar scopes before accepting a new connection;
- revokes a superseded refresh credential only after the replacement is durable and tested;
- detects `invalid_grant` and changes the integration to `reconnect_required`;
- provides Super Admin Connect/Test/Disconnect lifecycle controls.

In service-account mode Classic Academy:

- keeps the service-account private key only in the deployment secret environment;
- uses the official Google JWT client with the delegated Workspace organizer;
- stores no user refresh token;
- uses `calendar.events` plus `calendar.events.freebusy` only;
- records non-secret connection health in the platform integration row;
- exposes Test Connection but intentionally disables browser Connect/Disconnect because key rotation belongs in the deployment secret manager.

In both modes Classic Academy:

- never exposes Google provider response bodies to public booking visitors;
- fails booking closed when Calendar authorization/configuration is unhealthy;
- probes Calendar health from the scheduler before visitors discover a problem;
- records validation/success/failure timestamps for Super Admin diagnosis;
- uses the authenticated client's actual configured calendar ID for free/busy, event creation, and compensation deletion.

## Production health check

Default health interval is six hours. Optional tuning:

- `GOOGLE_CALENDAR_HEALTH_INTERVAL_MS` — 15 minutes to 24 hours.
- `GOOGLE_CALENDAR_HEALTH_INITIAL_DELAY_MS` — stagger the first worker check.

Use the default unless monitoring demonstrates a reason to change it.

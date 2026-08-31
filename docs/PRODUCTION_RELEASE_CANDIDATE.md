# Classic Academy — Production Release Candidate Runbook

This document is part of the release package. Do not bypass a failed gate.

## 1. Runtime and install

1. Use **Node 24.11.1** exactly.
2. Start from a clean extraction of the cumulative release ZIP.
3. Run:

```bash
npm ci
npm audit --omit=dev --audit-level=high
```

Do not deploy if either command fails for a dependency/security reason. A transient registry/network failure must be resolved and the commands repeated.

## 2. Production configuration

Configure secrets in the deployment platform; do not place them in the repository or ZIP.

Required categories are enforced by `npm run release:readiness`:

- Platform and tenant MongoDB connection URIs.
- `SESSION_SECRET`, `JWT_SECRET`, `INVITE_TOKEN_SECRET`.
- Dedicated transcript and official-document signing secrets.
- Integration credential encryption key.
- Dedicated platform-audit and public-review privacy HMAC secrets.
- 32-byte tenant backup encryption key.
- `BASE_DOMAIN` and HTTPS public/platform/application URLs.
- SMTP host/port/user/password/from address.
- Cloudinary cloud name/API key/API secret.
- Explicit Google Calendar auth mode: Workspace service-account delegation (preferred for organizational booking calendars) or production OAuth with encrypted durable credential; a pasted refresh token is never a normal production credential.
- Zoom account/client/client-secret configuration.

Production debug/insecure modes and localhost-tenant routing must remain disabled. Configure a specific trusted proxy hop/range rather than `TRUST_PROXY=true`.

Run:

```bash
npm run release:readiness
```

This must report `PASS` before any migration or application start.

## 3. Database safety and migrations

Before modifying production data:

1. Take provider-level snapshots of the platform database and every tenant database.
2. Restore those snapshots into a staging clone.
3. Run the unified migration/index command against staging first:

```bash
npm run indexes
```

The command runs platform and tenant compatibility migrations before synchronizing declared indexes. It must finish with zero failed indexes.

4. Run the complete regression suite on the migrated staging environment:

```bash
npm test
npm run check
```

5. Re-run `npm run indexes` on the same staging copy. Migrations are required to be idempotent; the second run must not corrupt or reactivate quarantined records.

## 4. Backup and restore rehearsal

On staging, create a real **Full System** backup through the Admin Backup interface and download/verify the artifact. Then rehearse a restore using the exact `RESTORE <backup name>` confirmation.

A successful rehearsal must prove:

- CAKB1 AES-256-GCM artifact decryption and SHA-256 verification.
- Tenant identity mismatch protection.
- Automatic pre-restore Full System safety backup.
- Transactional collection replacement.
- Completed restore history entry.

Never perform the first restore test against live production data.

## 5. Start and infrastructure probes

Start the application only after migration gates pass:

```bash
npm start
```

Infrastructure probes:

```text
GET /healthz  -> 200 {"status":"ok"}
GET /readyz   -> 200 {"status":"ready"}
```

`/readyz` must return 503 until the platform database connection is ready. Neither endpoint exposes tenant/database details.

Verify graceful SIGTERM/SIGINT handling in staging and confirm a restart does not duplicate scheduled jobs or subscription processing. Set `RUN_SCHEDULERS_IN_WEB=false` only when the dedicated `node src/scheduler.js` worker is deployed; otherwise explicitly set it to `true`.

## 6. Required staging smoke journeys

Use separate test accounts and at least two independent tenant databases.

### Platform / Super Admin

- Login, email verification when enabled, logout and session revocation.
- Create/provision a test school, assign a plan and confirm subscription state.
- Record a test payment and verify tenant access follows the current subscription.
- Suspend and reactivate the school; access must change immediately.
- Platform Support, Settings, Reports, Audit and public directory checks.
- Public demo booking creates one Calendar event/Zoom meeting and never exposes Zoom host `start_url`.

### Tenant Admin

- Login and dashboard KPIs.
- Create/edit Student, Parent and Staff records within plan capacity.
- Admissions Intake -> application -> offer flow.
- Finance invoice/payment/statement/report reconciliation.
- Exam -> Result -> Transcript visibility.
- Announcement/message/event scheduler smoke.
- Backup creation and restore rehearsal as described above.

### Student

- Login/dashboard.
- Results/transcript/official-letter visibility.
- Finance balance and receipts.
- Assignments/calendar/notifications.

### Parent

- Linked-child dashboard.
- Fees/receipts and child academic visibility.
- Confirm one child's credit never offsets another child's debt.

### Staff

- Login/profile without unauthorized Department reassignment.
- Authorized Staff functions only; verify denied navigation/actions for missing permissions.

## 7. Multi-tenant isolation

With two staging tenants A and B:

- A hostname/custom domain must resolve only A's `dbName` and model set.
- B hostname/custom domain must resolve only B's database.
- A authenticated session must not authorize B tenant data/actions.
- Change or remove a custom domain and confirm the old domain stops resolving immediately.
- Suspend one tenant and confirm the other is unaffected.
- Restore a backup from A into B must be rejected by tenant identity validation.

## 8. External integrations

For Google Calendar, follow `docs/GOOGLE_CALENDAR_PRODUCTION_SETUP.md`. Production must explicitly choose `GOOGLE_CALENDAR_AUTH_MODE=service_account` or `oauth`. Service-account mode requires Workspace domain-wide delegation to the configured organizer. OAuth mode requires the consent project to actually be In Production/Internal; `GOOGLE_OAUTH_CONSENT_STATUS` is an operator assertion checked by the application, not a Google API lookup.

### Integration smoke checks

Before launch, exercise real staging credentials for:

- SMTP send and verification email.
- Cloudinary image/raw authenticated upload, fetch and delete compensation.
- Google Calendar free/busy + event create/delete.
- Zoom meeting create/delete compensation.
- Any configured tenant API integration probe with SSRF controls enabled.

## 9. Final traffic switch

Immediately before enabling production traffic:

```bash
npm run release:readiness
npm test
npm run check
```

Confirm `/readyz` is 200, review startup logs for scheduler/database errors, then enable traffic. Monitor logs, database load, failed jobs, email delivery, bookings, backups and subscription expiry processing during the initial launch window.


## Redis is mandatory in production

Classic Academy now requires `REDIS_URL` in production. Redis is used for Platform and tenant sessions, shared tenant/subscription access caching, Platform guard caching, and distributed rate limiting. The application startup pings Redis and `/readyz` remains `503` until both the Platform database and Redis are ready.

Recommended deployment properties:
- use a managed Redis endpoint in the same region as the application;
- prefer TLS (`rediss://`) when the provider supports it;
- do not expose Redis directly to the public internet;
- keep `TENANT_ACCESS_CACHE_TTL_SECONDS` at the default 30 seconds unless profiling proves another value is needed;
- lifecycle and billing actions explicitly invalidate tenant access cache entries, so suspension/cancellation/payment/manual activation do not wait for TTL expiry.

## Existing migrated schools: manual activation

A billing-authorized Platform operator can activate a migrated suspended/expired school from **Super Admin → Schools → School Details → Manual Activate**. Manual activation requires the current tenant/subscription revisions, an explicit future period end, and an audit reason. It records a `manual_activation_override` subscription history entry and does not fabricate a payment record. Normal paid activation should still use the Billing flow.

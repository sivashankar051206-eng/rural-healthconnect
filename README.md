# Rural HealthConnect — Centralized EHR & Tele-Healthcare Platform

A secure, multilingual, voice-assisted telehealth platform for rural and remote communities.
Three separate applications — **Patient**, **Doctor**, **Admin** — share one hardened API.

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript (Vite), no UI framework (small bundle), per-role lazy-loaded bundles |
| Backend | Node.js 20 + Express + TypeScript (routes → controllers → services → repositories) |
| Database | PostgreSQL 16 (constraints, triggers, exclusion constraints, migrations) |
| Cache | Redis 7 (rate limits, slot cache, idempotency keys, one-time codes, locks — never medical data) |
| Deployment | Docker + Docker Compose (dev and production overrides), unprivileged nginx |

---

## Quick start (Docker)

```bash
./scripts/generate-secrets.sh          # creates .env with strong random secrets
docker compose up --build              # http://localhost:8080
```

Create the first administrator (there are **no demo or default accounts**):

```bash
docker compose exec backend node dist/scripts/createAdmin.js              # all admin permissions except break-glass
docker compose exec backend node dist/scripts/createAdmin.js --breakglass # also grants audited emergency clinical access
```

The script prints an `otpauth://` URI — add it to an authenticator app (Google Authenticator, Aegis, etc.). Admin login always requires the TOTP code.

Then:

1. Doctors self-register at `/doctor/register` → an admin verifies them at `/admin/doctors`.
2. Doctors set weekly availability at `/doctor/availability`.
3. Patients register at `/patient/register` (language is chosen first) and book.

### Production

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

* Put an HTTPS terminator (load balancer / Caddy / Traefik) in front of the `frontend` service, then enable the HSTS line in `client/nginx.conf`.
* Set `CORS_ORIGIN=https://your-domain` and keep `COOKIE_SECURE=true`.
* PostgreSQL and Redis are not published; the backend network is internal; containers run read-only, non-root, with all capabilities dropped.
* Use encrypted volumes / disks for `pgdata` and `uploads` (encryption at rest), and back them up.
* Optional malware scanning: `--profile clamav` and `CLAMAV_HOST=clamav`.

### Local development without Docker

```bash
# PostgreSQL 14+ and Redis running locally; .env with DATABASE_URL / REDIS_URL set
cd server && npm install && npm run migrate && npm run dev      # API on :4000
cd client && npm install && npm run dev                         # UI on :5173 (proxies /api)
```

Set `CORS_ORIGIN=http://localhost:5173`. For local testing without an SMS provider you may set `NODE_ENV=development` and `DEV_PRINT_OTP=true` to print password-reset codes to the server console (refused in production).

### Tests

The suite exercises the real API against a **disposable** database (tables are truncated between tests):

```bash
cd server
TEST_DATABASE_URL=postgres://rhc:pw@localhost:5432/rhc_test \
TEST_REDIS_URL=redis://localhost:6379/15 npm test
```

Covered: authentication, lockout, generic errors, CSRF/origin checks, session revocation, RBAC,
IDOR (patient → other patient, doctor → unassigned patient = 404), patient → admin (403),
unauthenticated → 401, patient modifying a prescription (403), concurrent double-booking (exactly one wins),
idempotent retries, prescription signing/immutability/versioning, record corrections, upload signature
validation (disguised executables rejected), rate limiting, security headers, append-only audit logs.

---

## Project structure

```
server/
  migrations/001_init.sql     schema, constraints, immutability triggers, seed config (no demo data)
  src/config/                 validated env, constants (roles, session policy, permissions)
  src/middleware/             authenticate (+CSRF), requireRole/Permission/Mfa/ActiveDoctor/RecentReauth,
                              rate limits, validation, security headers, error handler
  src/routes → controllers → services → repositories → db
  src/security/               argon2id, AES-GCM, HMAC, file signatures, ClamAV client, access checks
  src/audit/                  audit logger (best-effort + strict mode for clinical reads)
  src/scripts/createAdmin.ts  CLI admin bootstrap with TOTP
  tests/                      security + integration tests (vitest + supertest)
client/
  src/patient/  src/doctor/  src/admin/     three separate apps (lazy-loaded)
  src/layouts/                             three separate shells / design systems
  src/i18n/locales/{en,ta,hi,te,ml,kn}.json  every patient string + voice phrases
  src/voice/                               speech wrappers, intent detection, assistant UI
  src/components/                          watermark viewer, chat, report viewer, emergency dialog…
  nginx.conf                               CSP and security headers, /api proxy
```

---

## Security design (summary)

**Authentication & sessions**
* Argon2id password hashing (19 MiB, t=2); constant-time handling of unknown accounts.
* Opaque, random session tokens in `HttpOnly; Secure; SameSite=Strict` cookies; only HMACs are stored server-side, so sessions are revocable (logout, "log out other devices", password reset, account disable).
* Per-role idle/absolute timeouts (admin 15 min / 4 h). New token on every login (no fixation).
* CSRF: double-submit token (`X-CSRF-Token`) validated against the session, plus Origin / `Sec-Fetch-Site` checks.
* Account lockout after 5 failures (15 min), Redis-backed per-IP rate limits, generic error messages, non-enumerating password reset with hashed, attempt-limited, 10-minute codes.
* Admins: separate portal, TOTP MFA with replay protection, re-authentication (password + TOTP) for settings, permission changes and break-glass.

**Authorization (RBAC + resource ownership)** — identity always comes from the server session; client-sent `role`, `userId`, `patientId` are stripped by validation.
* Patients: only their own data (IDs derived from the session).
* Doctors: must be `VERIFIED` and active; may access a patient only if they have a confirmed / in-progress / completed appointment with that patient. Unauthorized access returns **404** (no existence leak) and is audited.
* Admins: no clinical access by default. Individual permissions (least privilege). `clinical.breakglass` requires explicit grant + re-auth + written reason, is strictly audited *before* data is returned, and the patient is notified.

**Prescriptions**
* Stored as structured rows — there are no prescription files and no public URLs.
* Draft → review → **signed with the doctor's password** → `ACTIVE` with a content hash. PostgreSQL triggers make finalized prescriptions and their items immutable; corrections create a new version and mark the old one `SUPERSEDED`.
* Patient view: authenticated, audited (strict), `Cache-Control: no-store`, privacy prompt before display, dynamic watermark (name, patient ID, date/time, "Confidential Medical Document"), no download button, printing/copying/context menu disabled on the document. *Screenshots and photos cannot be prevented by any web app — the goal is preventing unauthorized access, which is enforced server-side.*

**Medical records** are append-only: content columns are immutable at the database level; corrections insert a new entry and a correction row (who, why, when, previous value, new value).

**Uploads**: extension allowlist + declared MIME + magic-byte signature, 5 MB limit, random UUID filenames, stored outside any web root with `0600` permissions, path-traversal guard, optional ClamAV (fails closed), streamed only via authorized endpoints with `no-store`, `nosniff` and a sandbox CSP. Photos are compressed on the phone before upload.

**Platform**: Helmet (strict CSP for the API, HSTS in production, frame denial, no-referrer), explicit CORS allowlist, 100 kB JSON limit, parameterized SQL only (LIKE wildcards escaped), centralized error handling (no stack traces or DB errors reach clients), structured logs with credential redaction, append-only audit log (DB trigger), notifications and SMS contain no clinical details, secrets only from environment.

**Double booking** is prevented in three layers: idempotency keys (duplicate taps on weak networks), a row lock + re-validation inside a transaction, and PostgreSQL **exclusion constraints** on overlapping time ranges per doctor and per patient.

---

## Patient experience

* Six big actions on the home screen: **Talk to a Doctor, Book Appointment, My Medical Records, My Medicines, My Appointments, Help** — plus a persistent emergency button, bottom navigation, and a large microphone button.
* **Languages**: English, தமிழ், हिन्दी, తెలుగు, മലയാളം, ಕನ್ನಡ — chosen before login; affects all UI text, errors, notifications, voice recognition and spoken responses. Every key is translated in every language (225 keys each). Add a language by adding one JSON file and one entry in `LANGUAGES`.
* **Voice assistant** (Web Speech API): Speech-to-text → intent detection → action through the *same authenticated API* → confirmation → text-to-speech. Understands native script and romanized phrases (e.g. *"Doctor kitta pesanum"*). Destructive actions (booking tomorrow's first slot, cancelling) always ask for yes/no confirmation by voice or button. It never diagnoses, never recommends medicines, never reads medical details aloud, and refuses requests about other patients. Emergency phrases ("my chest hurts", "I cannot breathe", …) immediately show call-108/112 guidance and state the app is not for emergencies. If the microphone is unavailable or denied, the app says "You can continue using the buttons below."
* **Low bandwidth**: per-role code splitting, per-language locale chunks, no UI library, gzip + immutable asset caching, paginated lightweight APIs, documents loaded only on demand, polling paused when the tab is hidden, "Internet connection is weak" banner on slow/failed requests, double-submit protection, no local caching of medical data.

## Teleconsultation

Appointment `SCHEDULED → CONFIRMED` (doctor accepts) → doctor **starts** (`IN_PROGRESS`, patient notified) → chat + optional video/voice link → doctor writes notes / prescription → **complete**.
Chat is built in (works on very poor connections). For video, set `VIDEO_BASE_URL` to a **self-hosted** Jitsi Meet (or compatible) server; room names are 192-bit random tokens given only to the two participants while the consultation is in progress.

## Before going live — checklist

- [ ] Integrate an SMS gateway (e.g. a DLT-registered Indian provider) in `server/src/services/messagingService.ts` — needed for password-reset codes.
- [ ] Host your own video service and set `VIDEO_BASE_URL`.
- [ ] HTTPS in front, HSTS enabled, `COOKIE_SECURE=true`, correct `CORS_ORIGIN` and `TRUST_PROXY`.
- [ ] Encrypted storage for database and upload volumes; tested backups; key management for `DATA_ENCRYPTION_KEY`.
- [ ] Separate PostgreSQL roles for migrations (owner) and the app (DML only).
- [ ] Enable ClamAV scanning.
- [ ] Review legal/regulatory obligations (e.g. India's Telemedicine Practice Guidelines 2020 and DPDP Act 2023) with qualified counsel.
- [ ] Independent penetration test.

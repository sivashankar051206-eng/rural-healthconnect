-- Rural HealthConnect - initial schema
-- PostgreSQL 14+ required (uses pgcrypto, citext, btree_gist)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION forbid_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Roles & permissions
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  code        TEXT PRIMARY KEY CHECK (code IN ('ADMIN', 'DOCTOR', 'PATIENT')),
  description TEXT NOT NULL
);

INSERT INTO roles (code, description) VALUES
  ('ADMIN',   'Platform administrator (no clinical access by default)'),
  ('DOCTOR',  'Verified healthcare professional'),
  ('PATIENT', 'Patient');

CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

INSERT INTO permissions (code, description) VALUES
  ('admin.doctors.manage',      'Review, verify, activate and deactivate doctors'),
  ('admin.patients.manage',     'View patient accounts (non-clinical) and enable/disable them'),
  ('admin.appointments.manage', 'View appointment metadata and cancel appointments'),
  ('admin.audit.view',          'View audit logs'),
  ('admin.facilities.manage',   'Manage healthcare facilities'),
  ('admin.issues.manage',       'Manage reported issues'),
  ('admin.settings.manage',     'Manage system configuration'),
  ('admin.permissions.manage',  'Grant and revoke administrator permissions'),
  ('clinical.breakglass',       'Emergency, audited access to a patient''s clinical record');

-- ---------------------------------------------------------------------------
-- Facilities
-- ---------------------------------------------------------------------------
CREATE TABLE facilities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
  type        TEXT NOT NULL CHECK (type IN ('PHC', 'CHC', 'DISTRICT_HOSPITAL', 'PRIVATE_HOSPITAL', 'CLINIC', 'OTHER')),
  district    TEXT NOT NULL CHECK (char_length(district) BETWEEN 2 AND 80),
  state       TEXT NOT NULL CHECK (char_length(state) BETWEEN 2 AND 80),
  address     TEXT CHECK (char_length(address) <= 300),
  phone       TEXT CHECK (phone ~ '^\+?[0-9]{6,15}$'),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  updated_by  UUID
);
CREATE INDEX idx_facilities_district ON facilities (state, district) WHERE is_active;
CREATE TRIGGER facilities_updated_at BEFORE UPDATE ON facilities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role                TEXT NOT NULL REFERENCES roles(code),
  email               CITEXT UNIQUE CHECK (email IS NULL OR char_length(email) <= 254),
  mobile              TEXT UNIQUE CHECK (mobile IS NULL OR mobile ~ '^\+[0-9]{10,15}$'),
  password_hash       TEXT NOT NULL,
  full_name           TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 120),
  preferred_language  TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'ta', 'hi', 'te', 'ml', 'kn')),
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  mfa_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_enc      TEXT,
  failed_login_count  INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until        TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR mobile IS NOT NULL),
  CHECK (role <> 'ADMIN' OR (email IS NOT NULL)),
  CHECK (NOT mfa_enabled OR mfa_secret_enc IS NOT NULL)
);
CREATE INDEX idx_users_role ON users (role);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE facilities ADD CONSTRAINT facilities_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE facilities ADD CONSTRAINT facilities_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id);

CREATE TABLE user_permissions (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code),
  granted_by      UUID REFERENCES users(id),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_code)
);

-- Only administrators may hold administrative permissions.
CREATE OR REPLACE FUNCTION guard_user_permissions() RETURNS trigger AS $$
DECLARE r TEXT;
BEGIN
  SELECT role INTO r FROM users WHERE id = NEW.user_id;
  IF r IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'permissions can only be granted to administrators' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER user_permissions_guard BEFORE INSERT OR UPDATE ON user_permissions FOR EACH ROW EXECUTE FUNCTION guard_user_permissions();

-- ---------------------------------------------------------------------------
-- Sessions (opaque, server-side, revocable). Only HMACs of tokens are stored.
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  csrf_hash     TEXT NOT NULL,
  mfa_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  reauth_at     TIMESTAMPTZ,
  ip            TEXT,
  user_agent    TEXT CHECK (char_length(user_agent) <= 255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Patients & doctors
-- ---------------------------------------------------------------------------
CREATE TABLE patients (
  user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  patient_code            TEXT NOT NULL UNIQUE CHECK (patient_code ~ '^RHC-[A-Z0-9]{8}$'),
  date_of_birth           DATE NOT NULL CHECK (date_of_birth > DATE '1900-01-01'),
  gender                  TEXT CHECK (gender IN ('FEMALE', 'MALE', 'OTHER')),
  village                 TEXT CHECK (char_length(village) <= 120),
  emergency_contact_name  TEXT CHECK (char_length(emergency_contact_name) <= 120),
  emergency_contact_phone TEXT CHECK (emergency_contact_phone ~ '^\+[0-9]{10,15}$'),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE doctors (
  user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  registration_number   TEXT NOT NULL UNIQUE CHECK (char_length(registration_number) BETWEEN 3 AND 40),
  specialization        TEXT NOT NULL CHECK (char_length(specialization) BETWEEN 2 AND 80),
  qualification         TEXT NOT NULL CHECK (char_length(qualification) BETWEEN 2 AND 120),
  facility_id           UUID REFERENCES facilities(id),
  bio                   TEXT CHECK (char_length(bio) <= 500),
  verification_status   TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  is_active             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT is_active OR verification_status = 'VERIFIED')
);
CREATE INDEX idx_doctors_bookable ON doctors (specialization) WHERE verification_status = 'VERIFIED' AND is_active;
CREATE TRIGGER doctors_updated_at BEFORE UPDATE ON doctors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE doctor_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id     UUID NOT NULL REFERENCES doctors(user_id),
  action        TEXT NOT NULL CHECK (action IN ('VERIFIED', 'REJECTED', 'ACTIVATED', 'DEACTIVATED')),
  notes         TEXT CHECK (char_length(notes) <= 500),
  performed_by  UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_doctor_verifications_doctor ON doctor_verifications (doctor_id, created_at DESC);
CREATE TRIGGER doctor_verifications_immutable BEFORE UPDATE OR DELETE ON doctor_verifications FOR EACH ROW EXECUTE FUNCTION forbid_modification();

CREATE TABLE doctor_availability (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id     UUID NOT NULL REFERENCES doctors(user_id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  slot_minutes  SMALLINT NOT NULL DEFAULT 15 CHECK (slot_minutes BETWEEN 10 AND 60),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_time < end_time),
  EXCLUDE USING gist (
    doctor_id WITH =,
    day_of_week WITH =,
    tsrange(DATE '2000-01-01' + start_time, DATE '2000-01-01' + end_time, '[)') WITH &&
  )
);

-- ---------------------------------------------------------------------------
-- Appointments. Double booking is prevented by exclusion constraints.
-- ---------------------------------------------------------------------------
CREATE TABLE appointments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID NOT NULL REFERENCES patients(user_id),
  doctor_id         UUID NOT NULL REFERENCES doctors(user_id),
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  mode              TEXT NOT NULL DEFAULT 'VIDEO' CHECK (mode IN ('VIDEO', 'AUDIO', 'CHAT')),
  status            TEXT NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED')),
  reason            TEXT CHECK (char_length(reason) <= 500),
  cancelled_by      UUID REFERENCES users(id),
  cancel_reason     TEXT CHECK (char_length(cancel_reason) <= 300),
  reminder_sent_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  CONSTRAINT appointments_no_doctor_overlap EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED')),
  CONSTRAINT appointments_no_patient_overlap EXCLUDE USING gist (
    patient_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'))
);
CREATE INDEX idx_appointments_patient ON appointments (patient_id, starts_at DESC);
CREATE INDEX idx_appointments_doctor ON appointments (doctor_id, starts_at);
CREATE INDEX idx_appointments_status_time ON appointments (status, starts_at);
CREATE INDEX idx_appointments_access ON appointments (doctor_id, patient_id, status);
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Consultations & messages
-- ---------------------------------------------------------------------------
CREATE TABLE consultations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  UUID NOT NULL UNIQUE REFERENCES appointments(id),
  patient_id      UUID NOT NULL REFERENCES patients(user_id),
  doctor_id       UUID NOT NULL REFERENCES doctors(user_id),
  status          TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  room_token      TEXT NOT NULL UNIQUE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_consultations_patient ON consultations (patient_id, started_at DESC);
CREATE INDEX idx_consultations_doctor ON consultations (doctor_id, started_at DESC);
CREATE TRIGGER consultations_updated_at BEFORE UPDATE ON consultations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  UUID NOT NULL REFERENCES consultations(id),
  sender_id        UUID NOT NULL REFERENCES users(id),
  body             TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_messages_consultation ON messages (consultation_id, created_at);
CREATE TRIGGER messages_immutable BEFORE UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- ---------------------------------------------------------------------------
-- Medical records (append-oriented). Only status may change, via corrections.
-- ---------------------------------------------------------------------------
CREATE TABLE medical_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID NOT NULL REFERENCES patients(user_id),
  entry_type          TEXT NOT NULL CHECK (entry_type IN ('ALLERGY', 'DIAGNOSIS', 'MEDICATION', 'NOTE')),
  title               TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  details             TEXT CHECK (char_length(details) <= 4000),
  consultation_id     UUID REFERENCES consultations(id),
  visible_to_patient  BOOLEAN NOT NULL DEFAULT TRUE,
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CORRECTED', 'ENTERED_IN_ERROR')),
  created_by          UUID NOT NULL REFERENCES users(id),
  updated_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_medical_records_patient ON medical_records (patient_id, entry_type, created_at DESC);

CREATE OR REPLACE FUNCTION guard_medical_records() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'medical records cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.entry_type IS DISTINCT FROM OLD.entry_type
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.details IS DISTINCT FROM OLD.details
     OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id
     OR NEW.visible_to_patient IS DISTINCT FROM OLD.visible_to_patient
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'medical record content is immutable; create a correction' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'only active records can be corrected' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER medical_records_guard BEFORE UPDATE OR DELETE ON medical_records FOR EACH ROW EXECUTE FUNCTION guard_medical_records();

CREATE TABLE record_corrections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id       UUID NOT NULL REFERENCES medical_records(id),
  new_record_id   UUID REFERENCES medical_records(id),
  reason          TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  previous_value  JSONB NOT NULL,
  new_value       JSONB,
  corrected_by    UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_record_corrections_record ON record_corrections (record_id);
CREATE TRIGGER record_corrections_immutable BEFORE UPDATE OR DELETE ON record_corrections FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- ---------------------------------------------------------------------------
-- Medical reports (files stored outside any public directory, random keys)
-- ---------------------------------------------------------------------------
CREATE TABLE medical_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES patients(user_id),
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  storage_key   TEXT NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f-]{36}\.(pdf|png|jpg)$'),
  mime_type     TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256        TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status   TEXT NOT NULL CHECK (scan_status IN ('CLEAN', 'NOT_SCANNED')),
  created_by    UUID NOT NULL REFERENCES users(id),
  updated_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_medical_reports_patient ON medical_reports (patient_id, created_at DESC);
CREATE TRIGGER medical_reports_updated_at BEFORE UPDATE ON medical_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Prescriptions (versioned, immutable once finalized)
-- ---------------------------------------------------------------------------
CREATE TABLE prescriptions (
  id                   UUID PRIMARY KEY,
  root_id              UUID NOT NULL,
  version              INTEGER NOT NULL CHECK (version >= 1),
  previous_version_id  UUID REFERENCES prescriptions(id),
  patient_id           UUID NOT NULL REFERENCES patients(user_id),
  doctor_id            UUID NOT NULL REFERENCES doctors(user_id),
  consultation_id      UUID REFERENCES consultations(id),
  status               TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'CANCELLED')),
  notes                TEXT CHECK (char_length(notes) <= 1000),
  content_hash         TEXT CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  finalized_at         TIMESTAMPTZ,
  cancel_reason        TEXT CHECK (char_length(cancel_reason) <= 300),
  created_by           UUID NOT NULL REFERENCES users(id),
  updated_by           UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root_id, version),
  CHECK ((version = 1) = (previous_version_id IS NULL)),
  CHECK (status = 'DRAFT' OR status = 'CANCELLED' OR (finalized_at IS NOT NULL AND content_hash IS NOT NULL))
);
CREATE UNIQUE INDEX uq_prescriptions_one_draft_per_root ON prescriptions (root_id) WHERE status = 'DRAFT';
CREATE INDEX idx_prescriptions_patient ON prescriptions (patient_id, created_at DESC);
CREATE INDEX idx_prescriptions_doctor ON prescriptions (doctor_id, created_at DESC);

CREATE OR REPLACE FUNCTION guard_prescriptions() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prescriptions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.root_id IS DISTINCT FROM OLD.root_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.previous_version_id IS DISTINCT FROM OLD.previous_version_id
     OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'prescription identity fields are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    IF NEW.status NOT IN ('DRAFT', 'ACTIVE', 'CANCELLED') THEN
      RAISE EXCEPTION 'invalid prescription status transition' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  -- Finalized: content is frozen; only ACTIVE -> SUPERSEDED/CANCELLED allowed.
  IF NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN
    RAISE EXCEPTION 'finalized prescriptions are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (OLD.status = 'ACTIVE' AND NEW.status IN ('SUPERSEDED', 'CANCELLED')) THEN
    RAISE EXCEPTION 'invalid prescription status transition' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER prescriptions_guard BEFORE UPDATE OR DELETE ON prescriptions FOR EACH ROW EXECUTE FUNCTION guard_prescriptions();

CREATE TABLE prescription_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id  UUID NOT NULL REFERENCES prescriptions(id),
  position         SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 30),
  medicine_name    TEXT NOT NULL CHECK (char_length(medicine_name) BETWEEN 1 AND 160),
  dosage           TEXT NOT NULL CHECK (char_length(dosage) BETWEEN 1 AND 80),
  frequency        TEXT NOT NULL CHECK (char_length(frequency) BETWEEN 1 AND 80),
  duration         TEXT NOT NULL CHECK (char_length(duration) BETWEEN 1 AND 80),
  instructions     TEXT CHECK (char_length(instructions) <= 300),
  UNIQUE (prescription_id, position)
);

CREATE OR REPLACE FUNCTION guard_prescription_items() RETURNS trigger AS $$
DECLARE
  pid UUID;
  s   TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN pid := OLD.prescription_id; ELSE pid := NEW.prescription_id; END IF;
  SELECT status INTO s FROM prescriptions WHERE id = pid;
  IF s IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'items of a finalized prescription are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.prescription_id IS DISTINCT FROM OLD.prescription_id THEN
    RAISE EXCEPTION 'items cannot move between prescriptions' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER prescription_items_guard BEFORE INSERT OR UPDATE OR DELETE ON prescription_items FOR EACH ROW EXECUTE FUNCTION guard_prescription_items();

-- ---------------------------------------------------------------------------
-- Notifications (store message keys + non-sensitive params only)
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type ~ '^[a-z_]+\.[a-z_]+$'),
  params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  link        TEXT CHECK (link ~ '^/[a-z0-9/_-]*$'),
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------
-- Issues reported by users
-- ---------------------------------------------------------------------------
CREATE TABLE issues (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_by  UUID NOT NULL REFERENCES users(id),
  category     TEXT NOT NULL CHECK (category IN ('TECHNICAL', 'ACCOUNT', 'APPOINTMENT', 'OTHER')),
  description  TEXT NOT NULL CHECK (char_length(description) BETWEEN 3 AND 1000),
  status       TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  admin_notes  TEXT CHECK (char_length(admin_notes) <= 1000),
  updated_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_issues_status ON issues (status, created_at DESC);
CREATE TRIGGER issues_updated_at BEFORE UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- System settings (allowlisted keys validated in the application)
-- ---------------------------------------------------------------------------
CREATE TABLE system_settings (
  key         TEXT PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value) VALUES
  ('cancellation_window_hours', '2'::jsonb),
  ('max_booking_days_ahead', '30'::jsonb),
  ('consultation_join_early_minutes', '15'::jsonb),
  ('patient_self_upload_enabled', 'true'::jsonb);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id             BIGSERIAL PRIMARY KEY,
  actor_id       UUID REFERENCES users(id),
  actor_role     TEXT,
  action         TEXT NOT NULL CHECK (action ~ '^[A-Z_]+$'),
  resource_type  TEXT,
  resource_id    TEXT,
  result         TEXT NOT NULL CHECK (result IN ('SUCCESS', 'DENIED', 'FAILURE')),
  ip             TEXT,
  request_id     TEXT,
  session_id     UUID,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs (action, created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id);
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_modification();

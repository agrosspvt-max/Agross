-- Phase 1: admin sign-in, enquiries and email notification jobs.

CREATE TABLE admin_users (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username             text NOT NULL,
    password_hash        text NOT NULL,
    display_name         text NOT NULL,
    email                text,
    permissions          text[] NOT NULL DEFAULT '{}',
    active               boolean NOT NULL DEFAULT true,
    must_change_password boolean NOT NULL DEFAULT false,
    created_at           timestamptz NOT NULL DEFAULT now(),
    last_login_at        timestamptz
);
CREATE UNIQUE INDEX admin_users_username_key ON admin_users (lower(username));

CREATE TABLE admin_sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
    token_hash   text NOT NULL UNIQUE,
    csrf_token   text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    ip_hash      text,
    user_agent   text
);
CREATE INDEX admin_sessions_user_idx ON admin_sessions (user_id);

-- Counters for login throttling and the public enquiry endpoint. Keys hold salted hashes, never raw IPs.
CREATE TABLE rate_limits (
    key          text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    count        integer NOT NULL
);

CREATE TABLE enquiries (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_key    text NOT NULL UNIQUE,
    form_type         text NOT NULL CHECK (form_type IN ('contact', 'dealership', 'farming', 'recruitment')),
    display_name      text NOT NULL,
    company           text,
    email             text NOT NULL,
    phone             text,
    fields            jsonb NOT NULL,
    search_text       text NOT NULL,
    source_page       text,
    status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
    status_changed_by uuid REFERENCES admin_users (id),
    status_changed_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enquiries_created_idx ON enquiries (created_at DESC);
CREATE INDEX enquiries_form_idx ON enquiries (form_type, created_at DESC);
CREATE INDEX enquiries_status_idx ON enquiries (status, created_at DESC);

CREATE TABLE notification_jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enquiry_id          uuid NOT NULL UNIQUE REFERENCES enquiries (id) ON DELETE CASCADE,
    state               text NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending', 'sending', 'accepted', 'delivered', 'failed', 'unconfirmed')),
    attempts            integer NOT NULL DEFAULT 0,
    locked_until        timestamptz,
    provider_message_id text,
    last_error_code     text,
    accepted_at         timestamptz,
    delivered_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_jobs_state_idx ON notification_jobs (state);
CREATE INDEX notification_jobs_message_idx ON notification_jobs (provider_message_id);

-- History of each attempt, so staff can see what happened to a notification.
CREATE TABLE notification_events (
    id         bigserial PRIMARY KEY,
    job_id     uuid NOT NULL REFERENCES notification_jobs (id) ON DELETE CASCADE,
    at         timestamptz NOT NULL DEFAULT now(),
    event      text NOT NULL,
    detail     text
);
CREATE INDEX notification_events_job_idx ON notification_events (job_id, at);

-- Meaningful actions only. Never copies enquiry text.
CREATE TABLE audit_log (
    id          bigserial PRIMARY KEY,
    at          timestamptz NOT NULL DEFAULT now(),
    actor_id    uuid REFERENCES admin_users (id),
    action      text NOT NULL,
    entity_type text,
    entity_id   text,
    metadata    jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

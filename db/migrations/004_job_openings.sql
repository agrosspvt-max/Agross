CREATE TABLE job_openings (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    designation text NOT NULL CHECK (char_length(designation) BETWEEN 1 AND 120),
    description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 5000),
    is_open     boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE enquiries
    ADD COLUMN job_opening_id uuid REFERENCES job_openings(id),
    ADD CONSTRAINT enquiries_job_opening_requires_recruitment
        CHECK (job_opening_id IS NULL OR form_type = 'recruitment');

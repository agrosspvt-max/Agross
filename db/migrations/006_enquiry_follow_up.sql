ALTER TABLE enquiries
    DROP CONSTRAINT enquiries_status_check,
    ADD CONSTRAINT enquiries_status_check CHECK (
        status IN ('new', 'in_progress', 'resolved')
        OR (form_type = 'recruitment' AND status IN ('shortlisted', 'rejected'))
    ),
    ADD COLUMN status_notes jsonb NOT NULL DEFAULT '{}'::jsonb;

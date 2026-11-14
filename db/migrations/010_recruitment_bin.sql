-- Recruitment Bin: a rejected application leaves the active lists and is kept for 30 days, then the scheduled
-- cleanup deletes it permanently (api/recruitment-bin-cleanup.js).
--
-- bin_rejected_at   when it was rejected (the date shown in the Bin)
-- bin_expires_at    when it stops being available and becomes due for deletion; null means the application is active
-- bin_previous_status  the status to return to on Restore (In progress is used when it is not known)
--
-- A rejected application is exactly one that is in the Bin: the constraint below keeps the two in step.

ALTER TABLE enquiries
    ADD COLUMN bin_rejected_at timestamptz,
    ADD COLUMN bin_expires_at timestamptz,
    ADD COLUMN bin_previous_status text CHECK (bin_previous_status IN ('new', 'in_progress', 'resolved', 'shortlisted'));

-- Applications that are already rejected when this is applied get a fresh 30 days from now. The rejection date
-- shown is the original one; the status they had before is not recorded, so Restore returns them to In progress.
UPDATE enquiries
SET bin_rejected_at = coalesce(status_changed_at, created_at), bin_expires_at = now() + interval '30 days'
WHERE status = 'rejected';

ALTER TABLE enquiries
    ADD CONSTRAINT enquiries_bin_matches_status CHECK (
        (status = 'rejected') = (bin_expires_at IS NOT NULL)
        AND (bin_expires_at IS NULL) = (bin_rejected_at IS NULL)
        AND (bin_previous_status IS NULL OR bin_expires_at IS NOT NULL)
    );

CREATE INDEX enquiries_bin_expires_idx ON enquiries (bin_expires_at) WHERE bin_expires_at IS NOT NULL;

-- Applications deleted from the Bin still count as submissions received. This keeps only a count per day and form type
-- (the day is the India date the application was submitted), never any applicant data.
CREATE TABLE enquiry_purge_tally (
    day       date    NOT NULL,
    form_type text    NOT NULL CHECK (form_type IN ('contact', 'dealership', 'farming', 'recruitment')),
    purged    integer NOT NULL CHECK (purged > 0),
    PRIMARY KEY (day, form_type)
);

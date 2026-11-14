-- Undoes migration 010 (Recruitment Bin). Deploy the previous version of the code afterwards.
--
-- Applications in the Bin keep status "rejected" and go back to the old behaviour: they show in the Enquiries
-- list as Rejected and nothing deletes them. Deletion deadlines and the "previous status" are dropped. Only the
-- per-day counts of applications already deleted are lost (they contain no applicant data).
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/rollback/010_recruitment_bin_down.sql

\set ON_ERROR_STOP on
BEGIN;

DO $guard$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '010_recruitment_bin.sql') THEN
        RAISE EXCEPTION 'Migration 010 is not recorded in this database, so there is nothing to roll back.';
    END IF;
END
$guard$;

SELECT 'Applications in the Bin that will return to the Rejected list' AS note, count(*) AS applications
FROM enquiries WHERE bin_expires_at IS NOT NULL;

ALTER TABLE enquiries DROP CONSTRAINT enquiries_bin_matches_status;
DROP INDEX enquiries_bin_expires_idx;
ALTER TABLE enquiries DROP COLUMN bin_previous_status, DROP COLUMN bin_expires_at, DROP COLUMN bin_rejected_at;
DROP TABLE enquiry_purge_tally;

DELETE FROM schema_migrations WHERE name = '010_recruitment_bin.sql';
INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
VALUES (NULL, 'recruitment_bin_rolled_back', 'enquiries', NULL, '{"migration": "010_recruitment_bin"}');

COMMIT;

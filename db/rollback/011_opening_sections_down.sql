-- Undoes migration 011 (formatted openings with sections). Deploy the previous version of the code afterwards.
--
-- Every opening keeps its designation, area, status and its plain-text description. Bold and italic formatting and the
-- custom sections are removed, so the sections' text is listed below first in case it needs saving elsewhere.
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/rollback/011_opening_sections_down.sql

\set ON_ERROR_STOP on
BEGIN;

DO $guard$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '011_opening_sections.sql') THEN
        RAISE EXCEPTION 'Migration 011 is not recorded in this database, so there is nothing to roll back.';
    END IF;
END
$guard$;

SELECT designation, jsonb_array_length(sections) AS sections_that_will_be_removed
FROM job_openings WHERE jsonb_array_length(sections) > 0 ORDER BY designation;

ALTER TABLE job_openings DROP COLUMN sections, DROP COLUMN intro;

DELETE FROM schema_migrations WHERE name = '011_opening_sections.sql';
INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
VALUES (NULL, 'opening_sections_rolled_back', 'job_openings', NULL, '{"migration": "011_opening_sections"}');

COMMIT;

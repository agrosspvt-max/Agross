-- Job openings with formatted text and as many named sections as needed.
--
-- intro     the main description as formatted paragraphs (see lib/rich-text.js). The plain-text `description`
--           column stays and always holds the plain version of it, so older openings and the list preview keep working.
--           It is null for openings saved before formatting existed; they are shown from `description`.
-- sections  the custom sections in the order they were added: [{ "heading": runs, "body": paragraphs }].
--
-- Nothing else changes, so the previous version of the application keeps reading and saving openings
-- (it ignores these columns) and no existing opening needs converting.

ALTER TABLE job_openings
    ADD COLUMN intro jsonb CHECK (intro IS NULL OR jsonb_typeof(intro) = 'array'),
    ADD COLUMN sections jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sections) = 'array');

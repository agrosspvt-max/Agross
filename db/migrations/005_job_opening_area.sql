ALTER TABLE job_openings
    ADD COLUMN area text CHECK (char_length(area) BETWEEN 1 AND 120);

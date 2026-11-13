-- Saved Google Analytics reports and the one shared refresh lease.
-- Rows 7 and 30 hold the last successful report for each date range.
-- Row 0 holds the refresh state shared by both ranges: only the holder of the current,
-- unexpired lease may save a report, start a cooldown or release the lease.
-- Adds a new table only; rolling back means dropping it.
CREATE TABLE analytics_cache (
    range_days smallint PRIMARY KEY CHECK (range_days IN (0, 7, 30)),
    report jsonb,
    fetched_at timestamptz,
    lease_id uuid,
    lease_until timestamptz,
    refreshing_days smallint CHECK (refreshing_days IN (7, 30)),
    cooldown_until timestamptz,
    cooldown_reason text CHECK (cooldown_reason IN ('timeout', 'rate_limit')),
    CHECK ((lease_id IS NULL) = (lease_until IS NULL)),
    CHECK (range_days = 0 OR (lease_id IS NULL AND refreshing_days IS NULL AND cooldown_until IS NULL)),
    CHECK (range_days <> 0 OR (report IS NULL AND fetched_at IS NULL))
);

INSERT INTO analytics_cache (range_days) VALUES (0), (7), (30);

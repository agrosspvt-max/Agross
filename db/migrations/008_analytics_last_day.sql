ALTER TABLE analytics_cache
    DROP CONSTRAINT analytics_cache_range_days_check,
    DROP CONSTRAINT analytics_cache_refreshing_days_check,
    ADD CHECK (range_days IN (0, 1, 7, 30)),
    ADD CHECK (refreshing_days IN (1, 7, 30));

INSERT INTO analytics_cache (range_days) VALUES (1);

-- Rolls the database back from migration 009 to the shape the previous version of the application expects.
-- It changes only the products table, the catalogue cache version and the migration record, in one transaction.
-- Enquiries, applications, résumés, notification history, admin accounts and sessions, the audit log, product
-- history and images are not touched, so nothing created while 009 was in place is lost.
--
-- Run it with the managed catalogue switched OFF, then deploy the previous version of the code, then switch ON:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/rollback/009_catalogue_positions_down.sql
--
-- What it restores
--   * display_order in every product's published content: the product's position x 10 (10, 20, 30 ...), so the old
--     page shows exactly the order the grids have now. Products with no position get an empty sort value.
--   * display_order in every draft. A draft keeps its edits; its sort value is the published one.
-- What it cannot restore
--   * The original sort values (for example ties or blanks) that 009 replaced with positions. The order is the same.
--   * The exact meaning of a pending position request. The old model has no swap; a request for place N is saved
--     as sort value N x 10 - 5 in the draft, which puts the product just before whatever is at N now. The requests
--     are listed below when the script runs, so they can be checked and re-entered.

\set ON_ERROR_STOP on
BEGIN;

-- The lock the application takes for every change to positions.
SELECT pg_advisory_xact_lock(724031);

DO $guard$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '009_catalogue_positions.js') THEN
        RAISE EXCEPTION 'Migration 009 is not recorded in this database, so there is nothing to roll back.';
    END IF;
    IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'catalogue_live' AND value = 'true'::jsonb) THEN
        RAISE EXCEPTION 'The managed catalogue is switched on. Switch it off first so visitors see the original pages: UPDATE app_settings SET value = ''false'', updated_at = now() WHERE key = ''catalogue_live'';';
    END IF;
END
$guard$;

-- Position requests that will become draft sort values.
SELECT 'Pending position request' AS note, catalogue, product_id, status,
       coalesce(draft, published)->>'name' AS name, coalesce(draft, published)->>'listing_page' AS grid,
       grid_position AS live_position, requested_position AS requested
FROM products WHERE requested_position IS NOT NULL ORDER BY catalogue, product_id;

ALTER TABLE products
    DROP CONSTRAINT products_grid_position_unique,
    DROP CONSTRAINT products_grid_position_matches_grid;

UPDATE products SET
    published = CASE WHEN published IS NOT NULL THEN
        published || jsonb_build_object('display_order', CASE WHEN grid_position IS NOT NULL THEN to_jsonb(grid_position * 10) ELSE 'null'::jsonb END)
    END,
    draft = CASE WHEN draft IS NOT NULL OR requested_position IS NOT NULL THEN
        coalesce(draft, published) || jsonb_build_object('display_order',
            CASE WHEN requested_position IS NOT NULL THEN to_jsonb(requested_position * 10 - 5)
                 WHEN grid_position IS NOT NULL AND coalesce(draft, published)->>'listing_page' = grid_page THEN to_jsonb(grid_position * 10)
                 ELSE 'null'::jsonb END)
    END,
    version = version + 1
WHERE published IS NOT NULL OR draft IS NOT NULL;

ALTER TABLE products DROP COLUMN requested_position, DROP COLUMN grid_position, DROP COLUMN grid_page;

-- Visitors' caches and open editors pick up the change.
UPDATE app_settings SET value = to_jsonb((value #>> '{}')::int + 1), updated_at = now() WHERE key = 'catalogue_version';

-- The record must match the schema: 009 is no longer applied, so the next migration run applies it again.
DELETE FROM schema_migrations WHERE name = '009_catalogue_positions.js';

INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
VALUES (NULL, 'catalogue_positions_rolled_back', 'catalogue', 'public', '{"migration": "009_catalogue_positions"}');

SELECT 'Rolled back' AS result,
       (SELECT count(*) FROM products WHERE published->>'listing_page' IS NOT NULL AND status = 'published') AS products_in_grids,
       (SELECT count(*) FROM schema_migrations WHERE name LIKE '009%') AS migration_009_records;

COMMIT;

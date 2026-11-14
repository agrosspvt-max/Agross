'use strict';

// Database access for the managed product catalogue. Callers check permissions before using these.

const crypto = require('node:crypto');
const { query, withTransaction } = require('./db');
const catalogue = require('./catalogue');
const positions = require('./catalogue-positions');
const { inspectImage } = require('./images');

const STATUS_FILTERS = ['draft', 'published', 'archived', 'changes', 'decision'];
const MAX_PAGE_SIZE = 100;

class StoreError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

// ---- settings --------------------------------------------------------------------

async function isLive() {
    const { rows } = await query("SELECT value FROM app_settings WHERE key = 'catalogue_live'");
    return Boolean(rows[0] && rows[0].value === true);
}

async function currentVersion() {
    const { rows } = await query("SELECT value FROM app_settings WHERE key = 'catalogue_version'");
    return rows[0] ? Number(rows[0].value) : 0;
}

async function bumpVersion(client) {
    await client.query("UPDATE app_settings SET value = to_jsonb((value #>> '{}')::int + 1), updated_at = now() WHERE key = 'catalogue_version'");
}

async function setLive(value, user) {
    await withTransaction(async client => {
        await client.query("UPDATE app_settings SET value = $1::jsonb, updated_at = now(), updated_by = $2 WHERE key = 'catalogue_live'", [JSON.stringify(Boolean(value)), user.id]);
        await bumpVersion(client);
    });
}

async function listingTabs() {
    const { rows } = await query('SELECT listing_page, key, label, display_order FROM listing_tabs ORDER BY listing_page, display_order');
    return rows;
}

// ---- reading for the admin ------------------------------------------------------------

// A published product has unpublished changes when its draft differs or it has a requested move.
const HAS_CHANGES = '(p.published IS NOT NULL AND ((p.draft IS NOT NULL AND p.draft <> p.published) OR p.requested_position IS NOT NULL))';

const LIST_SELECT = `
    SELECT p.id, p.catalogue, p.product_id, p.status, p.version, p.updated_at, p.needs_decision,
           ${HAS_CHANGES} AS has_changes,
           coalesce(p.draft, p.published) AS content,
           u.display_name AS updated_by_name
    FROM products p LEFT JOIN admin_users u ON u.id = p.updated_by`;

function listItem(row) {
    const content = row.content || {};
    return {
        id: row.id, catalogue: row.catalogue, productId: row.product_id, status: row.status, version: row.version,
        updatedAt: row.updated_at, updatedBy: row.updated_by_name, hasChanges: row.has_changes, needsDecision: row.needs_decision,
        name: content.name || '', category: content.category || '', listingPage: content.listing_page || null, listingTab: content.listing_tab || null,
        image: catalogue.imageUrl({ image: content.image, image_id: content.image_id }) ? true : false
    };
}

function listFilters(filters) {
    const where = [];
    const params = [];
    const add = value => { params.push(value); return '$' + params.length; };
    if (filters.catalogue) where.push('p.catalogue = ' + add(filters.catalogue));
    if (filters.category) where.push("coalesce(p.draft, p.published)->>'category' = " + add(filters.category));
    if (filters.tab) where.push("coalesce(p.draft, p.published)->>'listing_tab' = " + add(filters.tab));
    if (filters.status === 'changes') where.push(HAS_CHANGES);
    else if (filters.status === 'decision') where.push('p.needs_decision');
    else if (filters.status) where.push('p.status = ' + add(filters.status));
    if (filters.q) {
        const escaped = filters.q.toLowerCase().replace(/[\\%_]/g, match => '\\' + match);
        const pattern = add('%' + escaped + '%');
        where.push("(lower(coalesce(p.draft, p.published)->>'name') LIKE " + pattern + ' OR p.product_id LIKE ' + pattern + ')');
    }
    return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function parseListFilters(input) {
    const filters = {};
    if (input.catalogue) {
        if (!Object.hasOwn(catalogue.CATALOGUES, input.catalogue)) return { error: 'Unknown catalogue.' };
        filters.catalogue = input.catalogue;
    }
    if (input.status) {
        if (!STATUS_FILTERS.includes(input.status)) return { error: 'Unknown status.' };
        filters.status = input.status;
    }
    if (input.category) filters.category = String(input.category).slice(0, 120);
    if (input.tab) filters.tab = String(input.tab).slice(0, 60);
    if (input.q) filters.q = String(input.q).trim().slice(0, 100);
    return { filters };
}

async function listProducts(filters, page = 1, pageSize = 25) {
    pageSize = Math.min(Math.max(Number(pageSize) || 25, 1), MAX_PAGE_SIZE);
    page = Math.max(Number(page) || 1, 1);
    const where = listFilters(filters);
    const [count, rows] = await Promise.all([
        query('SELECT count(*)::int AS total FROM products p ' + where.sql, where.params),
        query(LIST_SELECT + ' ' + where.sql + " ORDER BY lower(coalesce(p.draft, p.published)->>'name'), p.product_id LIMIT " + pageSize + ' OFFSET ' + (page - 1) * pageSize, where.params)
    ]);
    return { total: count.rows[0].total, page, pageSize, items: rows.rows.map(listItem) };
}

async function facets() {
    const [categories, counts] = await Promise.all([
        query(`SELECT p.catalogue, coalesce(p.draft, p.published)->>'category' AS category, count(*)::int AS n
               FROM products p GROUP BY 1, 2 HAVING coalesce(p.draft, p.published)->>'category' <> '' ORDER BY 1, 2`),
        query(`SELECT count(*) FILTER (WHERE status = 'draft')::int AS draft,
                      count(*) FILTER (WHERE status = 'published')::int AS published,
                      count(*) FILTER (WHERE status = 'archived')::int AS archived,
                      count(*) FILTER (WHERE ${HAS_CHANGES})::int AS changes,
                      count(*) FILTER (WHERE needs_decision)::int AS decision FROM products p`)
    ]);
    return { categories: categories.rows, counts: counts.rows[0], tabs: await listingTabs(), gridCounts: gridCounts(await gridMembers({ query })) };
}

async function getProduct(id) {
    if (!catalogue.UUID_PATTERN.test(String(id))) return null;
    const { rows } = await query(
        `SELECT p.*, cu.display_name AS created_by_name, uu.display_name AS updated_by_name, pu.display_name AS published_by_name
         FROM products p LEFT JOIN admin_users cu ON cu.id = p.created_by LEFT JOIN admin_users uu ON uu.id = p.updated_by
         LEFT JOIN admin_users pu ON pu.id = p.published_by WHERE p.id = $1`, [id]);
    const row = rows[0];
    if (!row) return null;
    const revisions = await query(
        `SELECT r.revision_no, r.action, r.at, u.display_name AS actor FROM product_revisions r
         LEFT JOIN admin_users u ON u.id = r.actor_id WHERE r.product_id = $1 ORDER BY r.revision_no DESC LIMIT 50`, [id]);
    const hasChanges = Boolean(row.published && ((row.draft && JSON.stringify(sorted(row.draft)) !== JSON.stringify(sorted(row.published))) ||
        row.requested_position !== null));
    const [members, live] = await Promise.all([gridMembers({ query }), isLive()]);
    return {
        id: row.id, catalogue: row.catalogue, productId: row.product_id, status: row.status, version: row.version,
        draft: row.draft, published: row.published, content: row.draft || row.published, hasChanges,
        createdAt: row.created_at, createdBy: row.created_by_name, updatedAt: row.updated_at, updatedBy: row.updated_by_name,
        publishedAt: row.published_at, publishedBy: row.published_by_name, archivedAt: row.archived_at,
        needsDecision: row.needs_decision, importNotes: row.import_notes, importAlternate: row.import_alternate,
        // Where it is live now, the move saved in its draft, and how many products each grid holds.
        positions: {
            grid: row.grid_page, current: row.grid_position, requested: row.requested_position, live,
            counts: Object.fromEntries(Object.entries(members).map(([grid, list]) => [grid, list.length]))
        },
        revisions: revisions.rows.map(r => ({ number: r.revision_no, action: r.action, at: r.at, actor: r.actor }))
    };
}

function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
    return value;
}

async function validationContext(client, content, productCatalogue) {
    const tabs = (await client.query('SELECT listing_page, key, label, display_order FROM listing_tabs')).rows;
    const known = (await client.query(
        "SELECT DISTINCT coalesce(draft, published)->>'category' AS category FROM products WHERE catalogue = $1", [productCatalogue])).rows
        .map(row => row.category).filter(Boolean);
    return { tabs, knownCategories: known };
}

// ---- positions in the grids ---------------------------------------------------------------
// Everything that adds a product to a grid, removes it or moves it takes this lock first, so two
// admins can never hand out the same position. Locks are released when the transaction ends.
const POSITIONS_LOCK = 724031;

async function lockPositions(client) {
    await client.query('SELECT pg_advisory_xact_lock($1)', [POSITIONS_LOCK]);
}

// The products live in each grid, in order: { chemicals: [{ id, name, position }], nonchemical: [...] }.
async function gridMembers(client) {
    const members = Object.fromEntries(Object.keys(catalogue.LISTING_PAGES).map(grid => [grid, []]));
    const { rows } = await client.query(
        "SELECT id, grid_page, grid_position, published->>'name' AS name FROM products WHERE grid_page IS NOT NULL ORDER BY grid_page, grid_position");
    for (const row of rows) if (members[row.grid_page]) members[row.grid_page].push({ id: row.id, name: row.name, position: row.grid_position });
    return members;
}

function gridCounts(members) {
    return Object.fromEntries(Object.entries(members).map(([grid, list]) => [grid, list.length]));
}

// Checks a position asked for in the editor. Returns the request to store: null when there is none,
// when the product is not listed, or when it asks for the place it already has.
async function requestedPosition(client, input, listingPage, row) {
    const parsed = positions.parsePosition(input);
    if (parsed.error) throw new StoreError(400, parsed.error, { errors: { position: parsed.error } });
    if (parsed.value === null || !listingPage) return null;
    const current = { grid: row ? row.grid_page : null, position: row ? row.grid_position : null };
    const range = positions.rangeFor(listingPage, current, gridCounts(await gridMembers(client)));
    if (parsed.value > range.max) {
        const message = positions.rangeError(listingPage, range);
        throw new StoreError(400, message, { errors: { position: message } });
    }
    return current.grid === listingPage && parsed.value === current.position ? null : parsed.value;
}

// Moves every product in a grid after a position by one place (delta -1 closes a gap, +1 opens one).
// Their drafts are untouched; a draft's move to the place it now has is dropped as already done.
async function shiftAfter(client, grid, after, delta) {
    await client.query(
        `UPDATE products SET grid_position = grid_position + $3, version = version + 1,
             requested_position = CASE WHEN requested_position = grid_position + $3
                 AND coalesce(draft, published)->>'listing_page' = grid_page THEN NULL ELSE requested_position END
         WHERE grid_page = $1 AND grid_position > $2`, [grid, after, delta]);
}

async function planForRow(client, row) {
    const content = catalogue.cleanContent(row.draft || row.published);
    return positions.planPublish({
        product: { id: row.id, name: content.name, grid: row.grid_page, position: row.grid_position },
        target: content.listing_page, requested: row.requested_position, members: await gridMembers(client)
    });
}

function movedAction(change) {
    if (change.fromGrid === change.toGrid) return 'moved_from_' + change.from + '_to_' + change.to;
    if (!change.toGrid) return 'left_grid_from_' + change.from;
    return 'added_to_grid_at_' + change.to;
}

// What publishing this product would change in the grids, for the editor to show before it publishes.
async function publishPreview(id) {
    if (!catalogue.UUID_PATTERN.test(String(id))) throw new StoreError(404, 'Product not found.');
    const { rows: [row] } = await query('SELECT * FROM products WHERE id = $1', [id]);
    if (!row) throw new StoreError(404, 'Product not found.');
    if (row.status === 'archived') throw new StoreError(409, 'Restore the product before publishing it.');
    const plan = await planForRow({ query }, row);
    if (plan.error) return { error: plan.error };
    return { token: plan.token, othersAffected: plan.othersAffected, final: plan.final, lines: positions.describe(plan) };
}

// ---- changes -----------------------------------------------------------------------------

async function addRevision(client, productId, action, content, actorId) {
    await client.query(
        `INSERT INTO product_revisions (product_id, revision_no, action, content, actor_id)
         SELECT $1, coalesce(max(revision_no), 0) + 1, $2, $3, $4 FROM product_revisions WHERE product_id = $1`,
        [productId, action, JSON.stringify(content), actorId]);
}

async function recordAudit(client, actorId, action, productRow, metadata = {}) {
    await client.query(
        'INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)',
        [actorId, action, 'product', productRow.id, JSON.stringify({ catalogue: productRow.catalogue, productId: productRow.product_id, ...metadata })]);
}

async function lockProduct(client, id) {
    if (!catalogue.UUID_PATTERN.test(String(id))) throw new StoreError(404, 'Product not found.');
    const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new StoreError(404, 'Product not found.');
    return rows[0];
}

async function createProduct({ catalogue: productCatalogue, productId, content, position }, user) {
    if (!Object.hasOwn(catalogue.CATALOGUES, productCatalogue)) throw new StoreError(400, 'Choose a catalogue.');
    if (typeof productId !== 'string' || !catalogue.PRODUCT_ID_PATTERN.test(productId)) {
        throw new StoreError(400, 'The product ID may use lower-case letters, numbers, spaces and hyphens (up to 80 characters).');
    }
    const clean = catalogue.cleanContent(content);
    if (!clean.name) throw new StoreError(400, 'Enter a name.');
    return withTransaction(async client => {
        const requested = await requestedPosition(client, position, clean.listing_page, null);
        const inserted = await client.query(
            `INSERT INTO products (catalogue, product_id, status, draft, created_by, updated_by, requested_position)
             VALUES ($1, $2, 'draft', $3, $4, $4, $5) ON CONFLICT (catalogue, product_id) DO NOTHING RETURNING *`,
            [productCatalogue, productId, JSON.stringify(clean), user.id, requested]);
        if (!inserted.rows[0]) throw new StoreError(409, 'A product with this ID already exists in this catalogue.');
        await addRevision(client, inserted.rows[0].id, 'created', clean, user.id);
        await recordAudit(client, user.id, 'product_created', inserted.rows[0]);
        return inserted.rows[0].id;
    });
}

// position: the place asked for in the grid (stored privately until publishing); undefined keeps the current request.
async function saveDraft(id, content, expectedVersion, user, position) {
    const clean = catalogue.cleanContent(content);
    return withTransaction(async client => {
        const row = await lockProduct(client, id);
        if (Number(expectedVersion) !== row.version) {
            throw new StoreError(409, 'Someone else changed this product. Reload the page to see the latest version.', { code: 'version_conflict' });
        }
        if (!clean.name) throw new StoreError(400, 'Enter a name.');
        const requested = position === undefined
            ? (clean.listing_page ? row.requested_position : null)
            : await requestedPosition(client, position, clean.listing_page, row);
        const same = row.published && JSON.stringify(sorted(clean)) === JSON.stringify(sorted(row.published));
        await client.query('UPDATE products SET draft = $2, requested_position = $4, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1',
            [id, same ? null : JSON.stringify(clean), user.id, requested]);
        await addRevision(client, id, 'draft_saved', clean, user.id);
        await recordAudit(client, user.id, 'product_draft_saved', row, requested !== row.requested_position ? { requestedPosition: requested } : {});
        return { version: row.version + 1 };
    });
}

/*
 * Publishes the draft and applies its position in the grid, all in one transaction.
 * positionToken is the one returned by publishPreview: when the move affects other products, publishing is
 * refused if the positions have changed since the admin was shown them.
 */
async function publish(id, user, { positionToken } = {}) {
    return withTransaction(async client => {
        await lockPositions(client);
        const row = await lockProduct(client, id);
        if (row.status === 'archived') throw new StoreError(409, 'Restore the product before publishing it.');
        if (!row.draft && row.requested_position === null) throw new StoreError(409, 'There are no unpublished changes to publish.');
        const clean = catalogue.cleanContent(row.draft || row.published);
        const checked = catalogue.validateContent(clean, await validationContext(client, clean, row.catalogue));
        if (Object.keys(checked.errors).length) throw new StoreError(422, 'Fix the highlighted fields before publishing.', { errors: checked.errors });
        if (clean.image_id) {
            const image = await client.query('SELECT 1 FROM product_images WHERE id = $1', [clean.image_id]);
            if (!image.rows[0]) throw new StoreError(422, 'The uploaded image is missing. Upload it again.', { errors: { image: 'The uploaded image is missing.' } });
        }

        // Work the positions out again here, on the locked data.
        const plan = await planForRow(client, row);
        if (plan.error) throw new StoreError(422, plan.error, { errors: { position: plan.error } });
        const tokenGiven = typeof positionToken === 'string' && positionToken !== '';
        if ((plan.othersAffected && !tokenGiven) || (tokenGiven && positionToken !== plan.token)) {
            throw new StoreError(409, 'The order of the grid changed after the positions were shown. Review the updated positions before publishing.', {
                code: 'positions_changed', positions: { token: plan.token, othersAffected: plan.othersAffected, lines: positions.describe(plan) }
            });
        }

        const self = plan.changes.find(change => change.self);
        const others = plan.changes.filter(change => !change.self);
        const swappedWith = others.length === 1 && self && self.fromGrid === self.toGrid ? others[0] : null;
        for (const change of others) {
            // Only the published position of another product changes. Its unpublished edits are kept;
            // a requested move to the place it now has is dropped as done. Open editors are asked to reload.
            await client.query(
                `UPDATE products SET grid_position = $2, version = version + 1,
                     requested_position = CASE WHEN requested_position = $2
                         AND coalesce(draft, published)->>'listing_page' = grid_page THEN NULL ELSE requested_position END
                 WHERE id = $1`, [change.id, change.to]);
        }
        await client.query(
            `UPDATE products SET published = $2, draft = NULL, requested_position = NULL, grid_position = $4, status = 'published',
             version = version + 1, updated_at = now(), updated_by = $3, published_at = now(), published_by = $3, needs_decision = false
             WHERE id = $1`, [id, JSON.stringify(clean), user.id, plan.final]);

        if (row.draft) await addRevision(client, id, 'published', clean, user.id);
        if (self) {
            await addRevision(client, id, movedAction(self), clean, user.id);
            await recordAudit(client, user.id, 'product_position_changed', row, {
                fromGrid: self.fromGrid, from: self.from, toGrid: self.toGrid, to: self.to,
                ...(swappedWith ? { swappedWith: swappedWith.id } : {}),
                ...(others.length && !swappedWith ? { othersMoved: others.length } : {})
            });
        }
        if (swappedWith) {
            await client.query(
                `INSERT INTO product_revisions (product_id, revision_no, action, content, actor_id)
                 SELECT p.id, (SELECT coalesce(max(revision_no), 0) + 1 FROM product_revisions WHERE product_id = p.id), $2, p.published, $3
                 FROM products p WHERE p.id = $1`, [swappedWith.id, movedAction(swappedWith), user.id]);
            await client.query(
                `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
                 SELECT $1, 'product_position_changed', 'product', p.id,
                        jsonb_build_object('catalogue', p.catalogue, 'productId', p.product_id, 'fromGrid', $3::text, 'from', $4::int,
                                           'toGrid', $3::text, 'to', $5::int, 'swappedWith', $6::text)
                 FROM products p WHERE p.id = $2`, [user.id, swappedWith.id, swappedWith.toGrid, swappedWith.from, swappedWith.to, id]);
        }
        if (row.draft || !row.published) await recordAudit(client, user.id, 'product_published', row);
        await bumpVersion(client);
        return { warnings: checked.warnings, positions: { grid: clean.listing_page, final: plan.final, lines: positions.describe(plan, true) } };
    });
}

async function publishImportedBaseline() {
    return withTransaction(async client => {
        await lockPositions(client);
        const { rows: [setting] } = await client.query(
            "SELECT value FROM app_settings WHERE key = 'catalogue_live' FOR UPDATE");
        if (setting?.value !== false) {
            throw new StoreError(409, 'Keep the managed catalogue switched off while preparing the original products.');
        }
        // Lock the products before reading their revision numbers, as the editor does.
        const { rows } = await client.query(
            `SELECT p.id FROM products p
             JOIN product_revisions r ON r.product_id = p.id AND r.revision_no = 1 AND r.action = 'imported'
             WHERE p.status = 'draft' AND p.published IS NULL
             ORDER BY p.id FOR UPDATE OF p`);
        if (!rows.length) return 0;
        // The imported version keeps the order of the original pages (display_order in the import record):
        // each grid continues after any product already live there, in that order.
        const { rowCount } = await client.query(
            `WITH original AS (
                 SELECT p.id, r.content - 'display_order' AS content,
                        CASE WHEN r.content->>'listing_page' IS NOT NULL THEN
                            (SELECT count(*) FROM products e WHERE e.grid_page = r.content->>'listing_page') + row_number() OVER (
                                PARTITION BY r.content->>'listing_page'
                                ORDER BY (r.content->>'display_order')::numeric NULLS LAST, lower(r.content->>'name'), p.product_id)
                        END AS position
                 FROM products p JOIN product_revisions r ON r.product_id = p.id AND r.revision_no = 1
                 WHERE p.id = ANY($1::uuid[])
             ), adopted AS (
                 UPDATE products p
                 SET published = o.content,
                     draft = CASE WHEN p.draft - 'display_order' = o.content THEN NULL ELSE p.draft END,
                     status = 'published', version = p.version + 1, published_at = now(), grid_position = o.position
                 FROM original o
                 WHERE p.id = o.id
                 RETURNING p.id, p.published
             )
             INSERT INTO product_revisions (product_id, revision_no, action, content)
             SELECT a.id, (SELECT max(revision_no) FROM product_revisions WHERE product_id = a.id) + 1,
                    'original_version_published', a.published
             FROM adopted a`, [rows.map(row => row.id)]);
        // This runs only while the public site shows the original pages, so every imported product, including
        // any published one by one beforehand, is put back in its original page order. Products added in the
        // editor follow, in their current order.
        await client.query(
            `WITH ordered AS (
                 SELECT p.id, row_number() OVER (
                     PARTITION BY p.grid_page
                     ORDER BY (r.action = 'imported') IS NOT TRUE,
                              CASE WHEN r.action = 'imported' THEN (r.content->>'display_order')::numeric END NULLS LAST,
                              CASE WHEN r.action = 'imported' THEN NULL ELSE p.grid_position END,
                              lower(p.published->>'name'), p.product_id) AS n
                 FROM products p LEFT JOIN product_revisions r ON r.product_id = p.id AND r.revision_no = 1
                 WHERE p.grid_page IS NOT NULL
             )
             UPDATE products p SET grid_position = o.n FROM ordered o WHERE o.id = p.id AND p.grid_position <> o.n`);
        await bumpVersion(client);
        return rowCount;
    });
}

async function archive(id, user) {
    return withTransaction(async client => {
        await lockPositions(client);
        const row = await lockProduct(client, id);
        if (row.status === 'archived') throw new StoreError(409, 'This product is already archived.');
        // Leaving its grid: the products after it move up one place.
        if (row.grid_page) await shiftAfter(client, row.grid_page, row.grid_position, -1);
        await client.query("UPDATE products SET status = 'archived', grid_position = NULL, version = version + 1, updated_at = now(), updated_by = $2, archived_at = now(), archived_by = $2 WHERE id = $1", [id, user.id]);
        await addRevision(client, id, 'archived', row.published || row.draft, user.id);
        await recordAudit(client, user.id, 'product_archived', row, { wasPublished: row.status === 'published', ...(row.grid_page ? { leftGrid: row.grid_page, from: row.grid_position } : {}) });
        await bumpVersion(client);
    });
}

// A restored published product comes back at the end of its grid.
async function restore(id, user) {
    return withTransaction(async client => {
        await lockPositions(client);
        const row = await lockProduct(client, id);
        if (row.status !== 'archived') throw new StoreError(409, 'Only archived products can be restored.');
        const status = row.published ? 'published' : 'draft';
        const grid = status === 'published' && row.published.listing_page ? row.published.listing_page : null;
        const position = grid ? (await client.query('SELECT count(*)::int + 1 AS n FROM products WHERE grid_page = $1', [grid])).rows[0].n : null;
        await client.query('UPDATE products SET status = $2, grid_position = $4, version = version + 1, updated_at = now(), updated_by = $3, archived_at = NULL, archived_by = NULL WHERE id = $1', [id, status, user.id, position]);
        await addRevision(client, id, 'restored', row.published || row.draft, user.id);
        await recordAudit(client, user.id, 'product_restored', row, { status, ...(grid ? { grid, position } : {}) });
        await bumpVersion(client);
        return { status, position: grid ? { grid, position } : null };
    });
}

async function discardDraft(id, user) {
    return withTransaction(async client => {
        const row = await lockProduct(client, id);
        if (!row.published) throw new StoreError(409, 'This product has never been published, so there is nothing to go back to.');
        if (!row.draft && row.requested_position === null) throw new StoreError(409, 'There are no unpublished changes.');
        await client.query('UPDATE products SET draft = NULL, requested_position = NULL, version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1', [id, user.id]);
        await addRevision(client, id, 'draft_discarded', row.published, user.id);
        await recordAudit(client, user.id, 'product_draft_discarded', row);
    });
}

async function restoreRevision(id, number, user) {
    return withTransaction(async client => {
        const row = await lockProduct(client, id);
        const revision = await client.query('SELECT content FROM product_revisions WHERE product_id = $1 AND revision_no = $2', [id, Number(number)]);
        if (!revision.rows[0]) throw new StoreError(404, 'That version was not found.');
        const clean = catalogue.cleanContent(revision.rows[0].content);
        const same = row.published && JSON.stringify(sorted(clean)) === JSON.stringify(sorted(row.published));
        await client.query('UPDATE products SET draft = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1', [id, same ? null : JSON.stringify(clean), user.id]);
        await addRevision(client, id, 'restored_from_revision_' + Number(number), clean, user.id);
        await recordAudit(client, user.id, 'product_revision_restored', row, { revision: Number(number) });
    });
}

// Permanent deletion is only for archived products or drafts that were never published, and needs the ID typed back.
async function deleteProduct(id, confirmProductId, user) {
    return withTransaction(async client => {
        const row = await lockProduct(client, id);
        const allowed = row.status === 'archived' || (row.status === 'draft' && !row.published);
        if (!allowed) throw new StoreError(409, 'Archive the product first. Only archived products can be deleted.');
        if (confirmProductId !== row.product_id) throw new StoreError(400, 'Type the product ID exactly to confirm the deletion.');
        await client.query('DELETE FROM products WHERE id = $1', [id]);
        await recordAudit(client, user.id, 'product_deleted', row);
        await bumpVersion(client);
    });
}

async function clearNeedsDecision(id, user) {
    return withTransaction(async client => {
        const row = await lockProduct(client, id);
        await client.query('UPDATE products SET needs_decision = false, updated_at = now(), updated_by = $2 WHERE id = $1', [id, user.id]);
        await recordAudit(client, user.id, 'product_decision_cleared', row);
    });
}

// ---- images ------------------------------------------------------------------------------------

async function saveImage(buffer, originalName, user) {
    const info = inspectImage(buffer);
    if (info.error) throw new StoreError(400, info.error);
    const { rows } = await query(
        `INSERT INTO product_images (content_type, data, bytes, width, height, sha256, original_name, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [info.type, buffer, buffer.length, info.width, info.height, crypto.createHash('sha256').update(buffer).digest('hex'),
            String(originalName || '').slice(0, 200), user.id]);
    return { id: rows[0].id, width: info.width, height: info.height, bytes: buffer.length };
}

async function getImage(id) {
    if (!catalogue.UUID_PATTERN.test(String(id))) return null;
    const { rows } = await query('SELECT content_type, data FROM product_images WHERE id = $1', [id]);
    return rows[0] || null;
}

// Visitors only receive images that belong to a published product.
async function getPublicImage(id) {
    if (!catalogue.UUID_PATTERN.test(String(id))) return null;
    const { rows } = await query(
        `SELECT i.content_type, i.data FROM product_images i
         WHERE i.id = $1 AND EXISTS (SELECT 1 FROM products p WHERE p.status = 'published' AND p.published->>'image_id' = $1::text)`, [id]);
    return rows[0] || null;
}

// ---- reading for visitors --------------------------------------------------------------------------

async function publicCatalogue(productCatalogue) {
    const { rows } = await query(
        `SELECT product_id, published FROM products WHERE catalogue = $1 AND status = 'published'
         ORDER BY grid_page NULLS LAST, grid_position, lower(published->>'name'), product_id`, [productCatalogue]);
    return rows.map(row => catalogue.toPublic(productCatalogue, row.product_id, row.published));
}

async function publicProduct(productCatalogue, productId) {
    const { rows } = await query('SELECT status, published FROM products WHERE catalogue = $1 AND product_id = $2', [productCatalogue, productId]);
    const row = rows[0];
    if (!row) return { state: 'missing' };
    if (row.status === 'published') return { state: 'ok', product: catalogue.toPublic(productCatalogue, productId, row.published) };
    // Never expose drafts. A product that was published and then archived is "unavailable"; a draft is simply unknown.
    return { state: row.status === 'archived' && row.published ? 'unavailable' : 'missing' };
}

// The products live in one grid, in position order.
async function listingProducts(pageKey) {
    const { rows } = await query(
        'SELECT catalogue, product_id, published, grid_position FROM products WHERE grid_page = $1 ORDER BY grid_position', [pageKey]);
    return rows.map(row => ({ catalogue: row.catalogue, productId: row.product_id, content: row.published, position: row.grid_position }));
}

module.exports = {
    StoreError, isLive, currentVersion, setLive, listingTabs, parseListFilters, listProducts, facets, getProduct,
    createProduct, saveDraft, publish, publishPreview, publishImportedBaseline, archive, restore, discardDraft, restoreRevision, deleteProduct, clearNeedsDecision,
    saveImage, getImage, getPublicImage, publicCatalogue, publicProduct, listingProducts, validationContext
};

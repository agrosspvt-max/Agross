'use strict';

// Database access for the managed product catalogue. Callers check permissions before using these.

const crypto = require('node:crypto');
const { query, withTransaction } = require('./db');
const catalogue = require('./catalogue');
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

const LIST_SELECT = `
    SELECT p.id, p.catalogue, p.product_id, p.status, p.version, p.updated_at, p.needs_decision,
           (p.draft IS NOT NULL AND p.published IS NOT NULL AND p.draft <> p.published) AS has_changes,
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
    if (filters.status === 'changes') where.push('p.draft IS NOT NULL AND p.published IS NOT NULL AND p.draft <> p.published');
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
                      count(*) FILTER (WHERE draft IS NOT NULL AND published IS NOT NULL AND draft <> published)::int AS changes,
                      count(*) FILTER (WHERE needs_decision)::int AS decision FROM products`)
    ]);
    return { categories: categories.rows, counts: counts.rows[0], tabs: await listingTabs() };
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
    const hasChanges = Boolean(row.draft && row.published && JSON.stringify(sorted(row.draft)) !== JSON.stringify(sorted(row.published)));
    return {
        id: row.id, catalogue: row.catalogue, productId: row.product_id, status: row.status, version: row.version,
        draft: row.draft, published: row.published, content: row.draft || row.published, hasChanges,
        createdAt: row.created_at, createdBy: row.created_by_name, updatedAt: row.updated_at, updatedBy: row.updated_by_name,
        publishedAt: row.published_at, publishedBy: row.published_by_name, archivedAt: row.archived_at,
        needsDecision: row.needs_decision, importNotes: row.import_notes, importAlternate: row.import_alternate,
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

async function createProduct({ catalogue: productCatalogue, productId, content }, user) {
    if (!Object.hasOwn(catalogue.CATALOGUES, productCatalogue)) throw new StoreError(400, 'Choose a catalogue.');
    if (typeof productId !== 'string' || !catalogue.PRODUCT_ID_PATTERN.test(productId)) {
        throw new StoreError(400, 'The product ID may use lower-case letters, numbers, spaces and hyphens (up to 80 characters).');
    }
    const clean = catalogue.cleanContent(content);
    if (!clean.name) throw new StoreError(400, 'Enter a name.');
    return withTransaction(async client => {
        const inserted = await client.query(
            `INSERT INTO products (catalogue, product_id, status, draft, created_by, updated_by)
             VALUES ($1, $2, 'draft', $3, $4, $4) ON CONFLICT (catalogue, product_id) DO NOTHING RETURNING *`,
            [productCatalogue, productId, JSON.stringify(clean), user.id]);
        if (!inserted.rows[0]) throw new StoreError(409, 'A product with this ID already exists in this catalogue.');
        await addRevision(client, inserted.rows[0].id, 'created', clean, user.id);
        await recordAudit(client, user.id, 'product_created', inserted.rows[0]);
        return inserted.rows[0].id;
    });
}

async function saveDraft(id, content, expectedVersion, user) {
    const clean = catalogue.cleanContent(content);
    return withTransaction(async client => {
        const row = await lockProduct(client, id);
        if (Number(expectedVersion) !== row.version) {
            throw new StoreError(409, 'Someone else changed this product. Reload the page to see the latest version.', { code: 'version_conflict' });
        }
        if (!clean.name) throw new StoreError(400, 'Enter a name.');
        const same = row.published && JSON.stringify(sorted(clean)) === JSON.stringify(sorted(row.published));
        await client.query('UPDATE products SET draft = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1',
            [id, same ? null : JSON.stringify(clean), user.id]);
        await addRevision(client, id, 'draft_saved', clean, user.id);
        await recordAudit(client, user.id, 'product_draft_saved', row);
        return { version: row.version + 1 };
    });
}

async function publish(id, user) {
    return withTransaction(async client => {
        const row = await lockProduct(client, id);
        if (row.status === 'archived') throw new StoreError(409, 'Restore the product before publishing it.');
        if (!row.draft) throw new StoreError(409, 'There are no unpublished changes to publish.');
        const clean = catalogue.cleanContent(row.draft);
        const checked = catalogue.validateContent(clean, await validationContext(client, clean, row.catalogue));
        if (Object.keys(checked.errors).length) throw new StoreError(422, 'Fix the highlighted fields before publishing.', { errors: checked.errors });
        if (clean.image_id) {
            const image = await client.query('SELECT 1 FROM product_images WHERE id = $1', [clean.image_id]);
            if (!image.rows[0]) throw new StoreError(422, 'The uploaded image is missing. Upload it again.', { errors: { image: 'The uploaded image is missing.' } });
        }
        await client.query(
            `UPDATE products SET published = $2, draft = NULL, status = 'published', version = version + 1, updated_at = now(), updated_by = $3,
             published_at = now(), published_by = $3, needs_decision = false WHERE id = $1`, [id, JSON.stringify(clean), user.id]);
        await addRevision(client, id, 'published', clean, user.id);
        await recordAudit(client, user.id, 'product_published', row);
        await bumpVersion(client);
        return { warnings: checked.warnings };
    });
}

async function archive(id, user) {
    return withTransaction(async client => {
        const row = await lockProduct(client, id);
        if (row.status === 'archived') throw new StoreError(409, 'This product is already archived.');
        await client.query("UPDATE products SET status = 'archived', version = version + 1, updated_at = now(), updated_by = $2, archived_at = now(), archived_by = $2 WHERE id = $1", [id, user.id]);
        await addRevision(client, id, 'archived', row.published || row.draft, user.id);
        await recordAudit(client, user.id, 'product_archived', row, { wasPublished: row.status === 'published' });
        await bumpVersion(client);
    });
}

async function restore(id, user) {
    return withTransaction(async client => {
        const row = await lockProduct(client, id);
        if (row.status !== 'archived') throw new StoreError(409, 'Only archived products can be restored.');
        const status = row.published ? 'published' : 'draft';
        await client.query('UPDATE products SET status = $2, version = version + 1, updated_at = now(), updated_by = $3, archived_at = NULL, archived_by = NULL WHERE id = $1', [id, status, user.id]);
        await addRevision(client, id, 'restored', row.published || row.draft, user.id);
        await recordAudit(client, user.id, 'product_restored', row, { status });
        await bumpVersion(client);
        return { status };
    });
}

async function discardDraft(id, user) {
    return withTransaction(async client => {
        const row = await lockProduct(client, id);
        if (!row.published) throw new StoreError(409, 'This product has never been published, so there is nothing to go back to.');
        if (!row.draft) throw new StoreError(409, 'There are no unpublished changes.');
        await client.query('UPDATE products SET draft = NULL, version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1', [id, user.id]);
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
         ORDER BY (published->>'display_order')::int NULLS LAST, lower(published->>'name'), product_id`, [productCatalogue]);
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

async function listingProducts(pageKey) {
    const { rows } = await query(
        `SELECT catalogue, product_id, published FROM products WHERE status = 'published' AND published->>'listing_page' = $1`, [pageKey]);
    return rows.map(row => ({ catalogue: row.catalogue, productId: row.product_id, content: row.published }));
}

module.exports = {
    StoreError, isLive, currentVersion, setLive, listingTabs, parseListFilters, listProducts, facets, getProduct,
    createProduct, saveDraft, publish, archive, restore, discardDraft, restoreRevision, deleteProduct, clearNeedsDecision,
    saveImage, getImage, getPublicImage, publicCatalogue, publicProduct, listingProducts, validationContext
};

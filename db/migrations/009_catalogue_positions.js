'use strict';

// Exact positions in the public product grids (see lib/catalogue-positions.js).
//
// grid_position: where a published product appears in the "All" tab of its grid (1, 2, 3 ... with no gaps).
//   Each grid (chemicals, nonchemical) has its own sequence. Category tabs show the same order, filtered.
// requested_position: a move saved in a draft. It stays private until the product is published.
// grid_page: the grid a product is live in (its published Listing), worked out by the database.
//
// The positions are the order visitors see today. That order is worked out here, in JavaScript, exactly as the
// old listing page did it, and not in SQL: the old page broke ties with JavaScript's localeCompare, and a database
// orders text by its own collation, which places tied names differently (case, accents, punctuation). display_order
// is then removed from product content. db/rollback/009_catalogue_positions_down.sql undoes all of this.

const LOCALE = 'en-US';

// A sort value, or null when there is none.
function orderValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

// The old listing page's order: sort value first (none last), then name, then product ID.
// Product catalogue is a last tie-break so the result never depends on how rows are stored.
function compareOldOrder(a, b) {
    const left = a.order === null ? Infinity : a.order;
    const right = b.order === null ? Infinity : b.order;
    return (left - right)
        || a.name.localeCompare(b.name, LOCALE)
        || a.productId.localeCompare(b.productId, LOCALE)
        || a.catalogue.localeCompare(b.catalogue, LOCALE);
}

// products: [{ id, grid, order, name, productId, catalogue }] live in grids.
// Returns { byGrid: Map(grid -> products in order), position: Map(id -> 1..N) }.
function positionsFor(products) {
    const byGrid = new Map();
    for (const product of products) {
        if (!byGrid.has(product.grid)) byGrid.set(product.grid, []);
        byGrid.get(product.grid).push(product);
    }
    const position = new Map();
    for (const list of byGrid.values()) {
        list.sort(compareOldOrder);
        list.forEach((product, index) => position.set(product.id, index + 1));
    }
    return { byGrid, position };
}

// Where a draft would sit among the other live products of its grid: one more than the products ahead of it.
function requestedFor(draft, byGrid) {
    const others = (byGrid.get(draft.grid) || []).filter(other => other.id !== draft.id);
    return others.filter(other => compareOldOrder(other, draft) < 0).length + 1;
}

async function setIntegers(client, column, entries) {
    if (!entries.length) return;
    await client.query(
        `UPDATE products p SET ${column} = v.value FROM unnest($1::uuid[], $2::int[]) AS v(id, value) WHERE p.id = v.id`,
        [entries.map(entry => entry[0]), entries.map(entry => entry[1])]);
}

async function up(client) {
    await client.query(`
        ALTER TABLE products
            ADD COLUMN grid_page text GENERATED ALWAYS AS (CASE WHEN status = 'published' THEN published->>'listing_page' END) STORED,
            ADD COLUMN grid_position integer CHECK (grid_position >= 1),
            ADD COLUMN requested_position integer CHECK (requested_position >= 1)`);

    // 1. Live positions: the order visitors see today.
    const live = (await client.query(
        `SELECT id, catalogue, product_id AS "productId", published->>'listing_page' AS grid,
                published->'display_order' AS "order", coalesce(published->>'name', '') AS name
         FROM products WHERE status = 'published' AND published->>'listing_page' IS NOT NULL`)).rows
        .map(row => ({ ...row, order: orderValue(row.order) }));
    const { byGrid, position } = positionsFor(live);
    await setIntegers(client, 'grid_position', [...position]);

    // 2. A move saved in a draft keeps its meaning: the place the draft would take among the live products.
    //    That covers a published product whose draft has another sort value or grid, and a product that was never
    //    published and asked for a place in a grid. A product that would stay where it is has no request.
    const drafts = (await client.query(
        `SELECT id, catalogue, product_id AS "productId", status, draft->>'listing_page' AS grid,
                draft->'display_order' AS "order", coalesce(draft->>'name', '') AS name,
                published->'display_order' AS "liveOrder", published->>'listing_page' AS "liveGrid"
         FROM products
         WHERE status IN ('draft', 'published') AND draft IS NOT NULL AND draft->>'listing_page' IS NOT NULL`)).rows
        .map(row => ({ ...row, order: orderValue(row.order), liveOrder: orderValue(row.liveOrder) }));
    const requests = [];
    for (const draft of drafts) {
        const moved = draft.status === 'published' ? (draft.grid !== draft.liveGrid || draft.order !== draft.liveOrder) : draft.order !== null;
        if (!moved) continue;
        const wanted = requestedFor(draft, byGrid);
        if (draft.status === 'published' && draft.grid === draft.liveGrid && wanted === position.get(draft.id)) continue;
        requests.push([draft.id, wanted]);
    }
    await setIntegers(client, 'requested_position', requests);

    // 3. display_order leaves the content. A draft that differed only by its sort value is now just the request above.
    //    Open editors are asked to reload (version + 1).
    await client.query(`
        UPDATE products SET
            published = published - 'display_order',
            draft = CASE WHEN draft - 'display_order' = published - 'display_order' THEN NULL ELSE draft - 'display_order' END,
            version = version + 1
        WHERE published ? 'display_order' OR draft ? 'display_order'`);

    // 4. Every product live in a grid has exactly one position there, and nothing else has one.
    //    Uniqueness is checked at commit, so a swap can pass through a moment where two products share a number.
    await client.query(`
        ALTER TABLE products
            ADD CONSTRAINT products_grid_position_matches_grid CHECK ((grid_position IS NULL) = (grid_page IS NULL)),
            ADD CONSTRAINT products_grid_position_unique
                EXCLUDE USING btree (grid_page WITH =, grid_position WITH =) WHERE (grid_page IS NOT NULL)
                DEFERRABLE INITIALLY DEFERRED`);
}

module.exports = { up, compareOldOrder, positionsFor, requestedFor, orderValue };

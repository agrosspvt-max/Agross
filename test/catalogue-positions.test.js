'use strict';

// Exact positions in the public grids: the swap on publish, the order of every tab, first publication,
// leaving a grid, invalid positions and a swap made stale by another admin. Uses the local test database.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, databaseAvailable, cleanDatabase, response } = require('./helpers');
const auth = require('../lib/auth');
const positions = require('../lib/catalogue-positions');
const { parseListing } = require('../lib/catalogue-import');
const admin = require('../api/admin');
const listingApi = require('../api/listing');

let available = false;
before(async () => { available = await databaseAvailable(); });
beforeEach(async () => { if (available) await cleanDatabase(); });
after(() => db.closePool());

// ---- the plan on its own ------------------------------------------------------------------------

const grid = (page, n) => Array.from({ length: n }, (_, i) => ({ id: page + (i + 1), name: page.toUpperCase() + (i + 1), position: i + 1 }));
const members = () => ({ chemicals: grid('c', 6), nonchemical: grid('n', 4) });

test('a move inside a grid swaps exactly two products', () => {
    const plan = positions.planPublish({ product: { id: 'c5', name: 'ROTOMAX', grid: 'chemicals', position: 5 }, target: 'chemicals', requested: 3, members: members() });
    assert.equal(plan.final, 3);
    assert.deepEqual(plan.changes.map(c => [c.id, c.from, c.to]), [['c5', 5, 3], ['c3', 3, 5]]);
    assert.deepEqual(positions.describe(plan), [
        'ROTOMAX will move from #5 to #3 in the Chemical grid.', 'C3 will move from #3 to #5.', 'Every other product keeps its position.'
    ]);
    assert.deepEqual(positions.describe(plan, true), ['ROTOMAX moved from #5 to #3 in the Chemical grid.', 'C3 moved from #3 to #5.']);
    const same = positions.planPublish({ product: { id: 'c5', name: 'X', grid: 'chemicals', position: 5 }, target: 'chemicals', requested: 5, members: members() });
    assert.deepEqual(same.changes, [], 'asking for the current position changes nothing');
    assert.match(positions.planPublish({ product: { id: 'c5', grid: 'chemicals', position: 5 }, target: 'chemicals', requested: 7, members: members() }).error, /from 1 to 6/);
});

test('joining a grid inserts or appends; leaving closes the gap', () => {
    const insert = positions.planPublish({ product: { id: 'x', name: 'NEW', grid: null, position: null }, target: 'chemicals', requested: 2, members: members() });
    assert.equal(insert.final, 2);
    assert.deepEqual(insert.changes.filter(c => !c.self).map(c => [c.id, c.from, c.to]), [['c2', 2, 3], ['c3', 3, 4], ['c4', 4, 5], ['c5', 5, 6], ['c6', 6, 7]]);
    const append = positions.planPublish({ product: { id: 'x', grid: null, position: null }, target: 'nonchemical', requested: null, members: members() });
    assert.equal(append.final, 5);
    assert.equal(append.othersAffected, false);
    assert.match(positions.planPublish({ product: { id: 'x', grid: null }, target: 'chemicals', requested: 8, members: members() }).error, /from 1 to 7/);
    const leave = positions.planPublish({ product: { id: 'c2', name: 'C2', grid: 'chemicals', position: 2 }, target: null, requested: null, members: members() });
    assert.equal(leave.final, null);
    assert.deepEqual(leave.changes.filter(c => !c.self).map(c => [c.id, c.to]), [['c3', 2], ['c4', 3], ['c5', 4], ['c6', 5]]);
    const across = positions.planPublish({ product: { id: 'c2', name: 'C2', grid: 'chemicals', position: 2 }, target: 'nonchemical', requested: 1, members: members() });
    assert.deepEqual(positions.describe(across), [
        'C2 will leave the Chemical grid (it was #2). 4 products after it move up one place.',
        'C2 will be added at #1 in the Non-chemical grid. 4 products from there on move down one place.'
    ]);
});

test('positions must be whole numbers from 1', () => {
    for (const bad of [0, -1, 2.5, 'abc', '3a', true, {}, positions.MAX_POSITION + 1]) assert.ok(positions.parsePosition(bad).error, String(bad));
    assert.deepEqual(positions.parsePosition(' 4 '), { value: 4 });
    assert.deepEqual(positions.parsePosition(''), { value: null });
    assert.deepEqual(positions.parsePosition(null), { value: null });
});

// ---- against the database --------------------------------------------------------------------

const PASSWORD = 'correct horse battery';
const ORIGIN = { host: 'admin.test', origin: 'http://admin.test' };

async function call(handler, { method = 'GET', route, query = {}, body, cookie, csrf } = {}) {
    const res = response();
    const headers = { ...ORIGIN, 'content-type': 'application/json', 'user-agent': 'test' };
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;
    if (method === 'GET') delete headers.origin;
    await handler({ method, headers, query: { ...(route ? { route } : {}), ...query }, body, url: '/', socket: { remoteAddress: '203.0.113.9' } }, res);
    return res;
}

async function admins(...names) {
    const out = [];
    for (const name of names) {
        await db.query('INSERT INTO admin_users (username, password_hash, display_name, permissions) VALUES ($1, $2, $1, $3)',
            [name, await auth.hashPassword(PASSWORD), auth.ALL_PERMISSIONS]);
        const login = await call(admin, { method: 'POST', route: 'login', body: { username: name, password: PASSWORD } });
        const cookie = login.headers['set-cookie'].split(';')[0];
        const csrf = (await call(admin, { route: 'me', cookie })).body.csrfToken;
        out.push({
            post: (route, body) => call(admin, { method: 'POST', route, body, cookie, csrf }),
            get: (route, query) => call(admin, { route, query, cookie })
        });
    }
    return out;
}

const content = (name, page, tab) => ({
    name, category: 'Sample', technical: 'Details', listing_page: page, listing_tab: tab, image: 'products/Janta.png', image_alt: name
});

// Publishes products one by one, so each joins the end of its grid. Returns { productId: id }.
async function seed(o, page, specs) {
    const ids = {};
    for (const [productId, tab] of specs) {
        const created = await o.post('product-create', { catalogue: page === 'chemicals' ? 'chemical' : 'nonchemical', productId, content: content(productId.toUpperCase(), page, tab) });
        assert.equal(created.statusCode, 200, JSON.stringify(created.body));
        ids[productId] = created.body.id;
        const published = await o.post('product-publish', { id: created.body.id });
        assert.equal(published.statusCode, 200, JSON.stringify(published.body));
    }
    return ids;
}

async function order(page) {
    const { rows } = await db.query('SELECT product_id, grid_position FROM products WHERE grid_page = $1 ORDER BY grid_position', [page]);
    assert.deepEqual(rows.map(row => row.grid_position), rows.map((_, i) => i + 1), page + ' positions run 1..N with no gaps');
    return rows.map(row => row.product_id);
}

// The public page: All in position order, and every tab equal to All filtered to that tab.
async function checkPage(page, expectedAll) {
    await db.query("UPDATE app_settings SET value = 'true' WHERE key = 'catalogue_live'");
    const res = await call(listingApi, { query: { page } });
    assert.equal(res.headers['x-catalogue'], 'managed');
    const cards = parseListing(res.body, page).cards;
    const all = cards.filter(card => card.tabLabel === 'All').map(card => card.productId);
    assert.deepEqual(all, expectedAll, page + ' All tab');
    const tabOf = Object.fromEntries((await db.query("SELECT product_id, published->>'listing_tab' AS tab FROM products WHERE grid_page = $1", [page])).rows.map(r => [r.product_id, r.tab]));
    const labels = Object.fromEntries((await db.query('SELECT key, label FROM listing_tabs WHERE listing_page = $1', [page])).rows.map(r => [r.label, r.key]));
    for (const label of Object.keys(labels)) {
        const shown = cards.filter(card => card.tabLabel === label).map(card => card.productId);
        assert.deepEqual(shown, all.filter(id => tabOf[id] === labels[label]), page + ' / ' + label + ' is All filtered to the tab');
    }
}

async function draftMove(o, id, position, edit = {}) {
    const view = (await o.get('product', { id })).body;
    return o.post('product-save', { id, version: view.version, content: { ...view.content, ...edit }, position });
}

for (const [page, specs] of [
    ['chemicals', [['alpha', 'herbicide'], ['veera', 'insecticide'], ['third', 'herbicide'], ['fourth', 'fungicide'], ['rotomax', 'herbicide'], ['sixth', 'insecticide']]],
    ['nonchemical', [['n-alpha', 'pgpr'], ['n-veera', 'biofertilizer'], ['n-third', 'pgpr'], ['n-fourth', 'pgpr'], ['n-rotomax', 'pgpr'], ['n-sixth', 'biofertilizer']]]
]) {
    test(page + ': #5 to #3 swaps two products across category tabs and nothing else moves', async t => {
        if (!available) return t.skip('no test database');
        const [o] = await admins('owner');
        const ids = await seed(o, page, specs);
        const [first, second, third, fourth, fifth, sixth] = specs.map(spec => spec[0]);
        assert.deepEqual(await order(page), [first, second, third, fourth, fifth, sixth]);
        await checkPage(page, [first, second, third, fourth, fifth, sixth]);

        // The product now at #3 has unpublished edits of its own; they must survive the swap.
        const displacedDraft = await draftMove(o, ids[third], undefined, { name: 'THIRD EDITED' });
        assert.equal(displacedDraft.statusCode, 200);

        // Save draft: the request is private.
        const saved = await draftMove(o, ids[fifth], 3);
        assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
        const pending = (await o.get('product', { id: ids[fifth] })).body;
        assert.deepEqual([pending.positions.current, pending.positions.requested, pending.hasChanges], [5, 3, true]);
        assert.equal(pending.positions.counts[page], 6);
        assert.deepEqual(await order(page), [first, second, third, fourth, fifth, sixth], 'nothing moves on Save draft');
        await checkPage(page, [first, second, third, fourth, fifth, sixth]);

        // Publish changes: shown first, then applied together.
        const preview = (await o.get('product-publish-preview', { id: ids[fifth] })).body;
        assert.deepEqual(preview.lines.slice(0, 2), [
            fifth.toUpperCase() + ' will move from #5 to #3 in the ' + positions.gridTitle(page) + '.',
            third.toUpperCase() + ' will move from #3 to #5.'
        ]);
        assert.equal((await o.post('product-publish', { id: ids[fifth] })).statusCode, 409, 'a swap needs the confirmed positions');
        const published = await o.post('product-publish', { id: ids[fifth], positionToken: preview.token });
        assert.equal(published.statusCode, 200, JSON.stringify(published.body));
        assert.deepEqual(published.body.positions.lines, [
            fifth.toUpperCase() + ' moved from #5 to #3 in the ' + positions.gridTitle(page) + '.', third.toUpperCase() + ' moved from #3 to #5.'
        ]);

        assert.deepEqual(await order(page), [first, second, fifth, fourth, third, sixth], '#4 and the rest keep their places');
        await checkPage(page, [first, second, fifth, fourth, third, sixth]);

        // Both editors show the new positions after a reload.
        const moved = (await o.get('product', { id: ids[fifth] })).body;
        const displaced = (await o.get('product', { id: ids[third] })).body;
        assert.deepEqual([moved.positions.current, moved.positions.requested, moved.hasChanges], [3, null, false]);
        assert.deepEqual([displaced.positions.current, displaced.positions.requested], [5, null]);
        assert.equal(displaced.draft.name, 'THIRD EDITED', 'the displaced product keeps its unpublished edits');
        assert.equal(displaced.published.name, third.toUpperCase(), '... which stay unpublished');
        assert.equal(displaced.published.listing_tab, specs[2][1], 'tab assignments stay the same');
        assert.equal(moved.published.listing_tab, specs[4][1]);
        assert.match(displaced.revisions[0].action, /^moved_from_3_to_5$/);
        assert.match(moved.revisions[0].action, /^moved_from_5_to_3$/);
        const audit = (await db.query(`SELECT entity_id, metadata FROM audit_log WHERE action = 'product_position_changed'
            AND metadata->>'fromGrid' = metadata->>'toGrid' ORDER BY id`)).rows;
        assert.deepEqual(audit.map(row => [row.entity_id, row.metadata.from, row.metadata.to]), [[ids[fifth], 5, 3], [ids[third], 3, 5]]);
    });
}

test('entering the current position, or nothing, leaves the order as it is', async t => {
    if (!available) return t.skip('no test database');
    const [o] = await admins('owner');
    const ids = await seed(o, 'chemicals', [['a', 'herbicide'], ['b', 'herbicide'], ['c', 'herbicide']]);
    assert.equal((await draftMove(o, ids.b, 2)).statusCode, 200);
    assert.equal((await o.get('product', { id: ids.b })).body.positions.requested, null);
    assert.equal((await o.get('product', { id: ids.b })).body.hasChanges, false);
    assert.equal((await draftMove(o, ids.b, '', { name: 'B EDITED' })).statusCode, 200);
    const plan = (await o.get('product-publish-preview', { id: ids.b })).body;
    assert.deepEqual(plan.lines, []);
    assert.equal((await o.post('product-publish', { id: ids.b })).statusCode, 200);
    assert.deepEqual(await order('chemicals'), ['a', 'b', 'c']);
});

test('changing only the category tab keeps the All position', async t => {
    if (!available) return t.skip('no test database');
    const [o] = await admins('owner');
    const ids = await seed(o, 'chemicals', [['a', 'herbicide'], ['b', 'herbicide'], ['c', 'herbicide']]);
    await draftMove(o, ids.b, undefined, { listing_tab: 'fungicide' });
    assert.equal((await o.post('product-publish', { id: ids.b })).statusCode, 200);
    assert.deepEqual(await order('chemicals'), ['a', 'b', 'c']);
    await checkPage('chemicals', ['a', 'b', 'c']);
});

test('a first publication inserts at the requested position, or at the end', async t => {
    if (!available) return t.skip('no test database');
    const [o] = await admins('owner');
    await seed(o, 'chemicals', [['a', 'herbicide'], ['b', 'insecticide'], ['c', 'herbicide']]);
    const created = await o.post('product-create', { catalogue: 'chemical', productId: 'new', content: content('NEW', 'chemicals', 'insecticide'), position: 2 });
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    const preview = (await o.get('product-publish-preview', { id: created.body.id })).body;
    assert.deepEqual(preview.lines, ['NEW will be added at #2 in the Chemical grid. 2 products from there on move down one place.']);
    assert.equal((await o.post('product-publish', { id: created.body.id, positionToken: preview.token })).statusCode, 200);
    assert.deepEqual(await order('chemicals'), ['a', 'new', 'b', 'c']);
    await checkPage('chemicals', ['a', 'new', 'b', 'c']);

    // A requested position beyond the end of the grid is refused; blank means the end.
    assert.equal((await o.post('product-create', { catalogue: 'chemical', productId: 'late', content: content('LATE', 'chemicals', null), position: 6 })).statusCode, 400);
    const late = await o.post('product-create', { catalogue: 'chemical', productId: 'late', content: content('LATE', 'chemicals', null) });
    assert.equal((await o.post('product-publish', { id: late.body.id })).statusCode, 200, 'appending moves nobody else, so no confirmation is needed');
    assert.deepEqual(await order('chemicals'), ['a', 'new', 'b', 'c', 'late']);
});

test('leaving a grid closes the gap; moving to the other grid inserts there', async t => {
    if (!available) return t.skip('no test database');
    const [o] = await admins('owner');
    const chem = await seed(o, 'chemicals', [['a', 'herbicide'], ['b', 'herbicide'], ['c', 'insecticide'], ['d', 'herbicide']]);
    await seed(o, 'nonchemical', [['x', 'pgpr'], ['y', 'pgpr']]);

    // b moves to the Non-chemical grid at #1.
    assert.equal((await draftMove(o, chem.b, 1, { listing_page: 'nonchemical', listing_tab: 'pgpr' })).statusCode, 200);
    const across = (await o.get('product-publish-preview', { id: chem.b })).body;
    assert.equal((await o.post('product-publish', { id: chem.b, positionToken: across.token })).statusCode, 200);
    assert.deepEqual(await order('chemicals'), ['a', 'c', 'd']);
    assert.deepEqual(await order('nonchemical'), ['b', 'x', 'y']);
    await checkPage('chemicals', ['a', 'c', 'd']);
    await checkPage('nonchemical', ['b', 'x', 'y']);

    // c is taken out of the grids (Not listed): the gap closes and its position request is dropped.
    assert.equal((await draftMove(o, chem.c, 1, { listing_page: null, listing_tab: null })).statusCode, 200);
    assert.equal((await o.get('product', { id: chem.c })).body.positions.requested, null);
    const out = (await o.get('product-publish-preview', { id: chem.c })).body;
    assert.equal((await o.post('product-publish', { id: chem.c, positionToken: out.token })).statusCode, 200);
    assert.deepEqual(await order('chemicals'), ['a', 'd']);

    // Archiving also closes the gap; restoring puts it back at the end.
    assert.equal((await o.post('product-archive', { id: chem.a })).statusCode, 200);
    assert.deepEqual(await order('chemicals'), ['d']);
    assert.equal((await o.post('product-restore', { id: chem.a })).statusCode, 200);
    assert.deepEqual(await order('chemicals'), ['d', 'a']);
    await checkPage('chemicals', ['d', 'a']);
});

test('invalid positions are refused on save and checked again on publish', async t => {
    if (!available) return t.skip('no test database');
    const [o] = await admins('owner');
    const ids = await seed(o, 'chemicals', [['a', 'herbicide'], ['b', 'herbicide'], ['c', 'herbicide']]);
    for (const bad of [0, -2, 2.5, 'two', '1e1', 4]) {
        const res = await draftMove(o, ids.c, bad);
        assert.equal(res.statusCode, 400, JSON.stringify(bad));
        assert.ok(res.body.errors.position, JSON.stringify(bad));
    }
    assert.match((await draftMove(o, ids.c, 4)).body.message, /from 1 to 3/);
    // A request that was valid when saved but no longer fits (the grid got shorter) stops the publish.
    assert.equal((await draftMove(o, ids.c, 3)).statusCode, 200);
    assert.equal((await draftMove(o, ids.a, 1)).statusCode, 200);
    await draftMove(o, ids.b, 3);
    assert.equal((await o.post('product-archive', { id: ids.a })).statusCode, 200);
    const refused = await o.post('product-publish', { id: ids.b });
    assert.equal(refused.statusCode, 422);
    assert.match(refused.body.errors.position, /from 1 to 2/);
    assert.deepEqual(await order('chemicals'), ['b', 'c']);
});

test('a swap made stale by another admin is not published until the new positions are reviewed', async t => {
    if (!available) return t.skip('no test database');
    const [first, second] = await admins('first', 'second');
    const ids = await seed(first, 'chemicals', [['a', 'herbicide'], ['b', 'herbicide'], ['veera', 'herbicide'], ['d', 'herbicide'], ['rotomax', 'herbicide'], ['other', 'herbicide']]);

    // The first admin is shown "ROTOMAX #5 -> #3, VEERA #3 -> #5".
    await draftMove(first, ids.rotomax, 3);
    const shown = (await first.get('product-publish-preview', { id: ids.rotomax })).body;
    assert.match(shown.lines[1], /^VEERA will move from #3 to #5/);

    // Meanwhile the second admin moves OTHER to #3.
    await draftMove(second, ids.other, 3);
    const theirs = (await second.get('product-publish-preview', { id: ids.other })).body;
    assert.equal((await second.post('product-publish', { id: ids.other, positionToken: theirs.token })).statusCode, 200);
    assert.deepEqual(await order('chemicals'), ['a', 'b', 'other', 'd', 'rotomax', 'veera']);

    // The first admin's publish is refused with the updated moves to review.
    const stale = await first.post('product-publish', { id: ids.rotomax, positionToken: shown.token });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.body.code, 'positions_changed');
    assert.match(stale.body.positions.lines[1], /^OTHER will move from #3 to #5/);
    assert.deepEqual(await order('chemicals'), ['a', 'b', 'other', 'd', 'rotomax', 'veera'], 'nothing was applied');
    const confirmed = await first.post('product-publish', { id: ids.rotomax, positionToken: stale.body.positions.token });
    assert.equal(confirmed.statusCode, 200);
    assert.deepEqual(await order('chemicals'), ['a', 'b', 'rotomax', 'd', 'other', 'veera']);
});

test('the database refuses two products at one position, or a listed product without one', async t => {
    if (!available) return t.skip('no test database');
    const [o] = await admins('owner');
    const ids = await seed(o, 'chemicals', [['a', 'herbicide'], ['b', 'herbicide']]);
    await assert.rejects(db.query('UPDATE products SET grid_position = 1 WHERE id = $1', [ids.b]), /products_grid_position_unique/);
    await assert.rejects(db.query('UPDATE products SET grid_position = NULL WHERE id = $1', [ids.b]), /products_grid_position_matches_grid/);
    assert.deepEqual(await order('chemicals'), ['a', 'b']);
});

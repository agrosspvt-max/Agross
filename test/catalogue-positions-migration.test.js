'use strict';

// Migration 009 gives every live product the position it has on the public page today. The old page ordered
// with JavaScript's localeCompare, so the migration must too: a database's own text ordering differs for tied names.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../db/migrations/009_catalogue_positions');

// The sort the listing renderer used before positions existed, kept here as the reference.
function oldPageOrder(items) {
    return [...items].sort((a, b) => {
        const left = a.order === null ? Infinity : a.order;
        const right = b.order === null ? Infinity : b.order;
        return (left - right) || a.name.localeCompare(b.name) || a.productId.localeCompare(b.productId);
    }).map(item => item.id);
}

// A small deterministic shuffle, so the result is shown not to depend on the order rows are read in.
function shuffled(list, seed) {
    const out = [...list];
    let state = seed;
    for (let i = out.length - 1; i > 0; i--) {
        state = (state * 1103515245 + 12345) % 2147483648;
        const j = state % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

const NAMES = ['Alpha-1', 'alpha-1', 'alpha_1', 'ALPHA 1', 'alpha 1', 'alpha1', 'Alpha.1', 'Ålpha', 'alpha', 'Alpha', 'Éclair', 'éclair', 'Eclair',
    "O'Neil", 'oneil', 'O-Neil', '#1 pack', '1 pack', '10 pack', '2 pack', '_x', '-x', 'x', 'X', 'Straße', 'strasse', 'Ωmega', 'omega', 'Zed', 'zed', 'ZED', 'Tie & Co', 'Tie "Q"'];

function products(grid) {
    // IDs run opposite to the name order, and several products share a sort value or have none.
    return NAMES.map((name, i) => ({
        id: grid + i, grid, catalogue: i % 2 ? 'chemical' : 'nonchemical', productId: 'p' + String(99 - i).padStart(2, '0') + ' ' + grid, name,
        order: i % 3 === 0 ? null : (i % 3) * 10
    }));
}

test('positions follow the old page order, including tied and missing sort values', () => {
    const items = [...products('chemicals'), ...products('nonchemical')];
    for (const seed of [1, 7, 42]) {
        const { byGrid, position } = migration.positionsFor(shuffled(items, seed));
        for (const grid of ['chemicals', 'nonchemical']) {
            const expected = oldPageOrder(items.filter(item => item.grid === grid));
            assert.deepEqual(byGrid.get(grid).map(item => item.id), expected, grid + ' order, seed ' + seed);
            assert.deepEqual(expected.map(id => position.get(id)), expected.map((id, index) => index + 1), 'positions run 1 to N');
        }
    }
});

test('a name that sorts differently in a database still keeps its old place', () => {
    // localeCompare puts lower case first and treats "_" before "-"; lower() plus a byte-order database would not.
    const items = [
        { id: 'a', grid: 'g', catalogue: 'chemical', productId: 'zz', name: 'Tie-A', order: 30 },
        { id: 'b', grid: 'g', catalogue: 'chemical', productId: 'yy', name: 'tie-a', order: 30 },
        { id: 'c', grid: 'g', catalogue: 'chemical', productId: 'xx', name: 'tie_a', order: 30 }
    ];
    assert.deepEqual(migration.positionsFor(items).byGrid.get('g').map(item => item.id), ['c', 'b', 'a']);
});

test('a saved move becomes the place the draft would take among the other live products', () => {
    const live = [10, 20, 30, 40, 50].map((order, index) => ({ id: 'p' + index, grid: 'g', catalogue: 'chemical', productId: 'p' + index, name: 'P' + index, order }));
    const { byGrid } = migration.positionsFor(live);
    const draft = (order, grid = 'g') => ({ id: 'p0', grid, catalogue: 'chemical', productId: 'p0', name: 'P0', order });
    assert.equal(migration.requestedFor(draft(35), byGrid), 3, 'p0 leaves #1; 35 falls after 20 and 30 of the others');
    assert.equal(migration.requestedFor(draft(5), byGrid), 1);
    assert.equal(migration.requestedFor(draft(null), byGrid), 5, 'no sort value goes last');
    assert.equal(migration.requestedFor({ ...draft(25), id: 'new', productId: 'new', grid: 'g' }, byGrid), 3, 'a product joining the grid');
    assert.equal(migration.requestedFor(draft(25, 'other'), byGrid), 1, 'an empty grid');
    assert.equal(migration.orderValue('40'), 40);
    assert.equal(migration.orderValue(undefined), null);
    assert.equal(migration.orderValue('x'), null);
});

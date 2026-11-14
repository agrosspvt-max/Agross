'use strict';

// Positions in the public product grids. Pure functions only; catalogue-store.js reads and writes them.
//
// Each grid (the chemicals and nonchemical listing pages) has one sequence, 1..N with no gaps, of the
// published products listed there. "All" shows that sequence and each category tab shows it filtered.
//
// Publishing works out every position that changes:
//   - same grid, new position:   swap with the product now at that position (nothing else moves)
//   - entering a grid:           insert at the requested position, later products move down one place;
//                                no requested position means the end of the grid
//   - leaving a grid:            later products move up one place to close the gap

const crypto = require('node:crypto');
const { LISTING_PAGES } = require('./catalogue');

const MAX_POSITION = 100000;

function gridTitle(grid) {
    return LISTING_PAGES[grid] ? LISTING_PAGES[grid].title : grid;
}

// A whole number from 1 up, or null for "no position given". Anything else is invalid.
function parsePosition(value) {
    if (value === null || value === undefined || value === '') return { value: null };
    const number = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
    if (!Number.isInteger(number) || number < 1 || number > MAX_POSITION) return { error: 'Enter the position as a whole number from 1 up.' };
    return { value: number };
}

// The positions a product may ask for in a grid: 1..N if it is already live there, 1..N+1 if it would join it.
function rangeFor(grid, current, counts) {
    const count = counts[grid] || 0;
    return current.grid === grid ? { min: 1, max: count } : { min: 1, max: count + 1 };
}

function rangeError(grid, range) {
    return range.max <= 1
        ? 'The only position available in the ' + gridTitle(grid) + ' is 1.'
        : 'Choose a position from 1 to ' + range.max + ' in the ' + gridTitle(grid) + '.';
}

/*
 * Works out the positions that change when a product is published.
 *   product:   { id, name, grid, position }  where it is live now (grid null if not live in a grid)
 *   target:    the grid its published version will be listed in, or null
 *   requested: the position asked for, or null
 *   members:   { [grid]: [{ id, name, position }] } every product live in each grid, the product included
 * Returns { error } or { final, changes, token } where changes lists every product whose grid or
 * position changes: { id, name, fromGrid, from, toGrid, to, self }.
 */
function planPublish({ product, target, requested, members }) {
    const changes = [];
    const own = { id: product.id, name: product.name, fromGrid: product.grid, from: product.position, self: true };
    const list = grid => (members[grid] || []).filter(member => member.id !== product.id);

    if (product.grid && product.grid === target) {
        const count = (members[target] || []).length;
        if (requested === null || requested === product.position) return finish({ final: product.position, changes });
        if (requested < 1 || requested > count) return { error: rangeError(target, { max: count }) };
        const other = list(target).find(member => member.position === requested);
        changes.push({ ...own, toGrid: target, to: requested });
        if (other) changes.push({ id: other.id, name: other.name, fromGrid: target, from: requested, toGrid: target, to: product.position });
        return finish({ final: requested, changes });
    }

    let final = null;
    if (target) {
        const others = list(target);
        const position = requested === null ? others.length + 1 : requested;
        if (position < 1 || position > others.length + 1) return { error: rangeError(target, { max: others.length + 1 }) };
        for (const member of others) {
            if (member.position >= position) changes.push({ id: member.id, name: member.name, fromGrid: target, from: member.position, toGrid: target, to: member.position + 1 });
        }
        final = position;
    }
    if (product.grid) {
        for (const member of list(product.grid)) {
            if (member.position > product.position) changes.push({ id: member.id, name: member.name, fromGrid: product.grid, from: member.position, toGrid: product.grid, to: member.position - 1 });
        }
    }
    if (product.grid || target) changes.unshift({ ...own, toGrid: target, to: final });
    return finish({ final, changes });
}

// The token identifies exactly these changes, so publishing can refuse if the order has changed since
// the admin was shown them.
function finish(plan) {
    const key = plan.changes.map(c => [c.id, c.fromGrid, c.from, c.toGrid, c.to].join(':')).sort().join('|');
    plan.token = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
    plan.othersAffected = plan.changes.some(change => !change.self);
    return plan;
}

// Plain sentences for the editor: before publishing ("will move") and after ("moved").
function describe(plan, done = false) {
    const lines = [];
    const self = plan.changes.find(change => change.self);
    if (!self) return lines;
    const others = plan.changes.filter(change => !change.self);
    const swap = others.length === 1 && self.fromGrid === self.toGrid ? others[0] : null;
    const name = text => text || 'This product';
    if (swap) {
        lines.push(name(self.name) + (done ? ' moved' : ' will move') + ' from #' + self.from + ' to #' + self.to + ' in the ' + gridTitle(self.toGrid) + '.');
        lines.push(name(swap.name) + (done ? ' moved' : ' will move') + ' from #' + swap.from + ' to #' + swap.to + '.');
        if (!done) lines.push('Every other product keeps its position.');
        return lines;
    }
    if (self.fromGrid && self.fromGrid !== self.toGrid) {
        const closing = others.filter(change => change.fromGrid === self.fromGrid).length;
        lines.push(name(self.name) + (done ? ' left' : ' will leave') + ' the ' + gridTitle(self.fromGrid) + ' (it was #' + self.from + ').' +
            (closing ? ' ' + closing + (closing === 1 ? ' product' : ' products') + ' after it ' + (done ? 'moved' : 'move') + ' up one place.' : ''));
    }
    if (self.toGrid && self.fromGrid !== self.toGrid) {
        const shifting = others.filter(change => change.toGrid === self.toGrid).length;
        lines.push(name(self.name) + (done ? ' was added' : ' will be added') + ' at #' + self.to + ' in the ' + gridTitle(self.toGrid) + '.' +
            (shifting ? ' ' + shifting + (shifting === 1 ? ' product' : ' products') + ' from there on ' + (done ? 'moved' : 'move') + ' down one place.' : ''));
    }
    return lines;
}

module.exports = { MAX_POSITION, gridTitle, parsePosition, rangeFor, rangeError, planPublish, describe };

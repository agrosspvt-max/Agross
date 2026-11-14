'use strict';

// Records the order of the product cards on the public listing pages, as the pages actually render them,
// and compares two recordings. It reads only the public pages, never a database.
//
//   node scripts/public-order.js capture <base-url> <file.json>   e.g. https://www.agross.in or http://localhost:3000
//   node scripts/public-order.js compare <before.json> <after.json>
//
// capture saves, for chemicals.html and nonchemical.html, the cards in All and in every category tab
// (link, name, picture) and whether the page was served from the managed catalogue or the original page.
// compare lists every card that moved or changed, with its position before and after, and exits with 1
// if anything differs. Both recordings are also checked for the rule every tab follows: a tab is "All" filtered.

const fs = require('node:fs');
const { parseListing } = require('../lib/catalogue-import');

const PAGES = { chemicals: 'chemicals.html', nonchemical: 'nonchemical.html' };

const keyOf = card => card.link;

async function capturePage(base, pageKey) {
    const url = base.replace(/\/+$/, '') + '/' + PAGES[pageKey] + '?order-check=' + Date.now();
    const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(PAGES[pageKey] + ' answered ' + res.status + '.');
    const parsed = parseListing(await res.text(), pageKey);
    const tabs = {};
    for (const card of parsed.cards) {
        (tabs[card.tabLabel] ||= []).push({ link: card.page + '?productId=' + card.productId, name: card.label, image: card.image });
    }
    return { source: res.headers.get('x-catalogue') || 'unknown', buttons: parsed.buttonOrder, tabs };
}

async function capture(base, file) {
    if (!base || !file) throw new Error('Usage: capture <base-url> <file.json>');
    const result = { base, capturedAt: new Date().toISOString(), pages: {} };
    for (const pageKey of Object.keys(PAGES)) result.pages[pageKey] = await capturePage(base, pageKey);
    fs.writeFileSync(file, JSON.stringify(result, null, 1));
    for (const [pageKey, page] of Object.entries(result.pages)) {
        const counts = Object.entries(page.tabs).map(([tab, cards]) => tab + ' ' + cards.length).join(', ');
        console.log(PAGES[pageKey] + ': served from the ' + page.source + ' catalogue. ' + counts + '.');
    }
}

// Every tab must list its products in the same relative order as All.
function tabProblems(recording, label) {
    const problems = [];
    for (const [pageKey, page] of Object.entries(recording.pages)) {
        const all = (page.tabs.All || []).map(keyOf);
        for (const [tab, cards] of Object.entries(page.tabs)) {
            if (tab === 'All') continue;
            let from = 0;
            for (const card of cards) {
                const at = all.indexOf(keyOf(card), from);
                if (at === -1) { problems.push(label + ': ' + PAGES[pageKey] + ' / ' + tab + ': ' + card.name + ' is out of the All order or missing from All.'); break; }
                from = at + 1;
            }
        }
    }
    return problems;
}

function compare(beforeFile, afterFile) {
    if (!beforeFile || !afterFile) throw new Error('Usage: compare <before.json> <after.json>');
    const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
    const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));
    const problems = [...tabProblems(before, 'before'), ...tabProblems(after, 'after')];
    let cards = 0;
    for (const pageKey of Object.keys(PAGES)) {
        const was = before.pages[pageKey];
        const now = after.pages[pageKey];
        const page = PAGES[pageKey];
        if (was.source !== now.source) problems.push(page + ': served from the ' + was.source + ' catalogue before and the ' + now.source + ' catalogue after.');
        if (JSON.stringify(was.buttons) !== JSON.stringify(now.buttons)) problems.push(page + ': tab buttons changed from ' + was.buttons.join(', ') + ' to ' + now.buttons.join(', ') + '.');
        for (const tab of new Set([...Object.keys(was.tabs), ...Object.keys(now.tabs)])) {
            const left = was.tabs[tab] || [];
            const right = now.tabs[tab] || [];
            cards += left.length;
            const rightAt = new Map(right.map((card, index) => [keyOf(card), index]));
            const leftAt = new Map(left.map((card, index) => [keyOf(card), index]));
            left.forEach((card, index) => {
                if (!rightAt.has(keyOf(card))) { problems.push(page + ' / ' + tab + ': ' + card.name + ' (' + keyOf(card) + ') was #' + (index + 1) + ' and is no longer shown.'); return; }
                const moved = rightAt.get(keyOf(card));
                const target = right[moved];
                if (moved !== index) problems.push(page + ' / ' + tab + ': ' + card.name + ' (' + keyOf(card) + ') moved from #' + (index + 1) + ' to #' + (moved + 1) + '.');
                if (target.name !== card.name) problems.push(page + ' / ' + tab + ': ' + keyOf(card) + ' was named "' + card.name + '" and is now "' + target.name + '".');
                if (target.image !== card.image) problems.push(page + ' / ' + tab + ': ' + keyOf(card) + ' had picture ' + card.image + ' and now has ' + target.image + '.');
            });
            right.forEach((card, index) => {
                if (!leftAt.has(keyOf(card))) problems.push(page + ' / ' + tab + ': ' + card.name + ' (' + keyOf(card) + ') is new at #' + (index + 1) + '.');
            });
            if (left.length !== right.length) problems.push(page + ' / ' + tab + ': ' + left.length + ' cards before and ' + right.length + ' after.');
        }
    }
    if (problems.length) {
        console.log('DIFFERENT: ' + problems.length + ' difference' + (problems.length === 1 ? '' : 's') + '.');
        for (const problem of problems) console.log('- ' + problem);
        process.exitCode = 1;
    } else {
        console.log('IDENTICAL: ' + cards + ' cards compared item by item (order, link, name and picture) across All and every tab on both pages, and every tab is All filtered.');
    }
}

async function main() {
    const [command, first, second] = process.argv.slice(2);
    if (command === 'capture') await capture(first, second);
    else if (command === 'compare') compare(first, second);
    else throw new Error('Usage: node scripts/public-order.js capture <base-url> <file.json> | compare <before.json> <after.json>');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

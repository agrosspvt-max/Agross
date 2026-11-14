'use strict';

// Reads the existing catalogue (the two JSON files and the two hard-coded listing pages) and works out
// what the managed catalogue should start with, plus everything that needs the owner's decision.
// Nothing here touches a database; scripts/import-catalogue.js stores the result as drafts.

const catalogueLib = require('./catalogue');
const { decodeEntities, sanitizeRich, cleanContent, PRODUCT_ID_PATTERN } = catalogueLib;

const PAGE_CATALOGUE = { 'product.html': 'chemical', 'nonchemical-details.html': 'nonchemical' };
const DEFAULT_LISTING = { chemical: 'chemicals', nonchemical: 'nonchemical' };

const TAB_KEYS = {
    chemicals: { herbicide: 'Herbicide', insecticide: 'Insecticide', fungicide: 'Fungicide', fertilizer: 'Fertilizer' },
    nonchemical: { pgpr: 'PGPR', biofertilizer: 'Biofertilizer', biofungicide: 'Biofungicide', biolarvicide: 'Biolarvicide', bioinsecticide: 'Bioinsecticide' }
};

// Spellings the old search list recognised; kept as search aliases.
const KNOWN_ALIASES = {
    'nonchemical:rotomax': ['Rotomaxx'], 'chemical:taandab': ['Taanbad'], 'chemical:cuirass': ['Curiass'], 'chemical:camasa': ['Casama'],
    'chemical:max mad': ['Max Mad'], 'chemical:maxlone': ['Maxlone'], 'nonchemical:potaxx dm': ['Potaxx DM']
};

function normalizeName(text) {
    return String(text).toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
}

function tabKeyFor(pageKey, label) {
    const wanted = String(label).toLowerCase();
    const found = Object.entries(TAB_KEYS[pageKey]).find(([, name]) => name.toLowerCase() === wanted);
    return found ? found[0] : null;
}

// ---- reading a listing page ----------------------------------------------------------------

function parseListing(html, pageKey) {
    const labels = {};
    for (const match of html.matchAll(/data-tab="(tab-\d+)"[^>]*>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/g)) labels[match[1]] = match[2];
    const starts = [...html.matchAll(/<div id="(tab-\d+)" class="tab-content/g)].map(match => ({ at: match.index, id: match[1] }));
    const buttonOrder = Object.keys(labels);
    const cards = [];
    for (const match of html.matchAll(/<div class="relative background11">([\s\S]*?)<\/h3>/g)) {
        const href = /href="([^"]*productId=([^"]+))"/.exec(match[1]);
        if (!href) continue;
        const tab = [...starts].reverse().find(start => start.at <= match.index);
        const [page, query] = href[1].split('?');
        const label = />\s*([^<>]+?)\s*<\/a>\s*$/.exec(match[1].trim());
        const image = /<img src="([^"]+)"/.exec(match[1]);
        cards.push({
            pageKey, tabId: tab.id, tabLabel: labels[tab.id] || tab.id, catalogue: PAGE_CATALOGUE[page] || null, page,
            productId: decodeURIComponent(new URLSearchParams(query).get('productId')),
            label: label ? decodeEntities(label[1]) : '', image: image ? image[1] : ''
        });
    }
    return { pageKey, buttonOrder: buttonOrder.map(id => labels[id]), cards };
}

// ---- building the import -----------------------------------------------------------------------

function contentFromRecord(record, catalogueKey, imageExists) {
    const text = value => (typeof value === 'string' ? decodeEntities(value).trim() : '');
    const notes = [];
    let image = typeof record.image === 'string' ? record.image.trim() : '';
    if (image && !imageExists(image)) {
        notes.push('The image file "' + image + '" does not exist. The product shows the logo until an image is uploaded.');
        image = '';
    }
    const content = cleanContent({
        name: text(record.name), category: text(record.category), subcategory: text(record.subcategory), type: text(record.type),
        technical: record.technical || '', benefits: record.benefits || '', application: text(record.application), dose: text(record.dose),
        packing: text(record.packing), tags: text(record.tags),
        target_crops: text(record.targetcrops), target_pests: text(record.targetpests), target_diseases: text(record.targetdiseases),
        target_insects: text(record.targetinsects), target_weeds: text(record.targetweeds), target: text(record.target),
        image: image || null, image_alt: text(record.name),
        aliases: KNOWN_ALIASES[catalogueKey + ':' + record.productId] || []
    });
    return { content, notes };
}

function changedFields(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
}

/*
 * sources: { chemical: [...], nonchemical: [...], listings: { chemicals: html, nonchemical: html } }
 * options: { imageExists(path) }
 */
function buildImport(sources, options) {
    const imageExists = options.imageExists;
    const listings = { chemicals: parseListing(sources.listings.chemicals, 'chemicals'), nonchemical: parseListing(sources.listings.nonchemical, 'nonchemical') };
    const products = new Map();       // "catalogue:id" -> product
    const duplicates = [];
    const sourceCounts = {};

    for (const catalogueKey of ['chemical', 'nonchemical']) {
        const records = sources[catalogueKey];
        sourceCounts[catalogueKey] = { records: records.length, uniqueIds: new Set(records.map(r => r.productId)).size };
        for (const record of records) {
            const key = catalogueKey + ':' + record.productId;
            const built = contentFromRecord(record, catalogueKey, imageExists);
            if (products.has(key)) {
                const first = products.get(key);
                first.alternate = built.content;
                duplicates.push({ catalogue: catalogueKey, productId: record.productId, first: first.content, second: built.content, differing: changedFields(first.content, built.content) });
                first.flags.add('duplicate-id');
                first.notes.push('Another record with this ID exists in ' + catalogueKey + '.json. The first was imported; the second is kept for comparison.');
                continue;
            }
            const product = { catalogue: catalogueKey, productId: record.productId, content: built.content, notes: [...built.notes], flags: new Set(), alternate: null, listed: null, record };
            if (!PRODUCT_ID_PATTERN.test(record.productId)) { product.flags.add('bad-id'); product.notes.push('The ID "' + record.productId + '" is not a valid managed ID.'); }
            if (built.notes.length) product.flags.add('missing-image');
            if (!record.benefits) product.notes.push('No benefits text in the JSON record.');
            products.set(key, product);
        }
    }

    // Products that exist in both catalogues under one ID.
    for (const [key, product] of products) {
        const other = (product.catalogue === 'chemical' ? 'nonchemical:' : 'chemical:') + product.productId;
        if (products.has(other)) { product.flags.add('in-both-catalogues'); product.notes.push('The same ID also exists in the ' + (product.catalogue === 'chemical' ? 'non-chemical' : 'chemical') + ' catalogue as a separate record.'); }
    }

    // Placement from the grids.
    const gridIssues = [];
    const tabOrderIssues = [];
    const categoryTabCounts = {};     // "catalogue|category" -> { tabKey: count }
    for (const pageKey of ['chemicals', 'nonchemical']) {
        const listing = listings[pageKey];
        const all = listing.cards.filter(card => card.tabLabel === 'All');
        const orderIndex = new Map(all.map((card, index) => [card.catalogue + ':' + card.productId, index]));
        let overflowOrder = all.length;
        for (const card of listing.cards) {
            const key = card.catalogue + ':' + card.productId;
            const product = products.get(key);
            if (!product) {
                gridIssues.push({ page: pageKey, tab: card.tabLabel, productId: card.productId, issue: 'A card links to a record that does not exist in ' + card.catalogue + '.json' });
                continue;
            }
            // Every card (under "All" and under each tab) must agree with the record it links to.
            const cardNote = message => { if (!product.notes.includes(message)) product.notes.push(message); };
            if (product.record.image && card.image && card.image !== product.record.image) {
                product.flags.add('image-mismatch');
                cardNote('The grid card image "' + card.image + '" differs from the JSON image "' + product.record.image + '".');
            }
            if (normalizeName(card.label) !== normalizeName(product.record.name)) {
                product.flags.add('label-mismatch');
                cardNote('The ' + card.tabLabel + ' card says "' + card.label + '" but the JSON name is "' + product.content.name + '".');
            } else if (card.tabLabel === 'All' && card.label.trim() !== product.content.name) {
                cardNote('Card label "' + card.label + '" and name "' + product.content.name + '" differ only in spacing or hyphens.');
            }
            if (card.tabLabel === 'All') {
                if (product.listed && product.listed.pageKey !== pageKey) product.notes.push('Also listed on the ' + pageKey + ' page.');
                product.listed = product.listed || { pageKey, tabKey: null, order: orderIndex.get(key) * 10 };
                const expected = DEFAULT_LISTING[product.catalogue];
                if (pageKey !== expected) {
                    product.flags.add('cross-listed');
                    product.notes.push('Appears in the ' + (pageKey === 'chemicals' ? 'chemical' : 'non-chemical') + ' grid although its record is in ' + product.catalogue + '.json.');
                }
            } else {
                const tabKey = tabKeyFor(pageKey, card.tabLabel);
                const listed = product.listed || (product.listed = { pageKey, tabKey: null, order: null });
                listed.tabKey = tabKey;
                if (!orderIndex.has(key)) {
                    product.flags.add('tab-not-in-all');
                    product.notes.push('Appears under the "' + card.tabLabel + '" tab but not under "All" on the current page.');
                    listed.order = overflowOrder * 10;
                    overflowOrder++;
                }
                const bucket = categoryTabCounts[product.catalogue + '|' + product.content.category] ||= {};
                bucket[pageKey + ':' + tabKey] = (bucket[pageKey + ':' + tabKey] || 0) + 1;
            }
        }
        // Order inside each tab versus the order under "All".
        for (const tabLabel of listing.buttonOrder.filter(label => label !== 'All')) {
            const inTab = listing.cards.filter(card => card.tabLabel === tabLabel && orderIndex.has(card.catalogue + ':' + card.productId));
            const positions = inTab.map(card => orderIndex.get(card.catalogue + ':' + card.productId));
            if (positions.some((position, index) => index && position < positions[index - 1])) {
                tabOrderIssues.push({ page: pageKey, tab: tabLabel, products: inTab.map(card => card.productId) });
            }
        }
    }

    // Category to tab mapping.
    const mapping = [];
    for (const catalogueKey of ['chemical', 'nonchemical']) {
        const categories = new Map();
        for (const product of products.values()) {
            if (product.catalogue !== catalogueKey) continue;
            const entry = categories.get(product.content.category) || { products: 0, unlisted: 0 };
            entry.products++;
            if (!product.listed) entry.unlisted++;
            categories.set(product.content.category, entry);
        }
        for (const [category, info] of [...categories].sort((a, b) => a[0].localeCompare(b[0]))) {
            const tabs = categoryTabCounts[catalogueKey + '|' + category] || {};
            const ranked = Object.entries(tabs).sort((a, b) => b[1] - a[1]);
            mapping.push({
                catalogue: catalogueKey, category, products: info.products, unlisted: info.unlisted, tabs,
                proposed: ranked[0] ? ranked[0][0].split(':')[1] : null, ambiguous: ranked.length > 1 || (!ranked.length && info.products > 0)
            });
        }
    }

    // Apply placement and proposals to each product.
    for (const product of products.values()) {
        const content = product.content;
        if (product.listed) {
            content.listing_page = product.listed.pageKey;
            content.listing_tab = product.listed.tabKey;
            content.display_order = product.listed.order;
        } else {
            product.flags.add('unlisted');
            const proposal = mapping.find(row => row.catalogue === product.catalogue && row.category === content.category);
            const note = 'Not shown in any grid today. It is reachable by its link and in search.' +
                (proposal && proposal.proposed ? ' Proposed placement: the ' + DEFAULT_LISTING[product.catalogue] + ' grid, "' + TAB_KEYS[DEFAULT_LISTING[product.catalogue]][proposal.proposed] + '" tab.' : '');
            product.notes.push(note);
            product.proposedPlacement = proposal && proposal.proposed ? { listing_page: DEFAULT_LISTING[product.catalogue], listing_tab: proposal.proposed } : null;
        }
        const category = mapping.find(row => row.catalogue === product.catalogue && row.category === content.category);
        if (product.listed && category && category.ambiguous && Object.keys(category.tabs).length > 1) product.flags.add('ambiguous-category');
        product.needsDecision = ['duplicate-id', 'unlisted', 'cross-listed', 'tab-not-in-all', 'label-mismatch', 'image-mismatch', 'missing-image', 'in-both-catalogues', 'bad-id']
            .some(flag => product.flags.has(flag));
    }

    return { products: [...products.values()], duplicates, mapping, gridIssues, tabOrderIssues, sourceCounts, listings };
}

// ---- report -----------------------------------------------------------------------------------------

const FLAG_TEXT = {
    'duplicate-id': 'duplicate ID', 'unlisted': 'not in any grid', 'cross-listed': 'listed under the other catalogue\'s grid',
    'tab-not-in-all': 'in a tab but not under All', 'label-mismatch': 'card label differs from JSON name', 'image-mismatch': 'card image differs from JSON image',
    'missing-image': 'image file missing', 'in-both-catalogues': 'ID exists in both catalogues', 'bad-id': 'invalid ID', 'ambiguous-category': 'category appears under several tabs'
};

function row(cells) {
    return '| ' + cells.map(cell => String(cell === null || cell === undefined ? '' : cell).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |';
}

function renderReport(result, { generatedOn } = {}) {
    const out = [];
    const flagged = result.products.filter(product => product.needsDecision);
    out.push('# Catalogue reconciliation report');
    out.push('');
    out.push('Generated ' + (generatedOn || 'on import') + ' from `chemical.json`, `nonchemical.json`, `chemicals.html` and `nonchemical.html`.');
    out.push('**Nothing has been published.** Every product was imported as a draft. The public site is unchanged.');
    out.push('');
    out.push('## 1. Counts');
    out.push('');
    out.push(row(['Source', 'Records in file', 'Unique IDs', 'Imported as drafts', 'Products with a decision pending']));
    out.push(row(['---', '---', '---', '---', '---']));
    for (const key of ['chemical', 'nonchemical']) {
        const imported = result.products.filter(p => p.catalogue === key);
        out.push(row([key + '.json', result.sourceCounts[key].records, result.sourceCounts[key].uniqueIds, imported.length, imported.filter(p => p.needsDecision).length]));
    }
    const cardCounts = Object.fromEntries(Object.entries(result.listings).map(([page, listing]) => [page, listing.cards.filter(card => card.tabLabel === 'All').length]));
    out.push('');
    out.push('Grid cards under "All": chemical grid ' + cardCounts.chemicals + ', non-chemical grid ' + cardCounts.nonchemical + '. Total imported: ' + result.products.length + ' products; ' + flagged.length + ' need a decision.');

    out.push('');
    out.push('## 2. The two `veera` records');
    out.push('');
    const veera = result.duplicates.filter(d => d.productId === 'veera');
    const otherDuplicates = result.duplicates.filter(d => d.productId !== 'veera');
    if (!veera.length) out.push('No duplicate `veera` record was found.');
    for (const dup of veera) {
        out.push('`veera` appears twice in `' + dup.catalogue + '.json`. The first record was imported as the draft; the second is stored beside it as an alternate so you can choose.');
        out.push('');
        out.push(row(['Field', 'First record (imported)', 'Second record']));
        out.push(row(['---', '---', '---']));
        const fields = dup.differing.length ? dup.differing : ['name'];
        for (const field of fields) out.push(row([field, JSON.stringify(dup.first[field]), JSON.stringify(dup.second[field])]));
        out.push('');
        out.push(dup.differing.length ? 'Fields not listed are identical.' : 'The two records are identical in every managed field.');
        out.push('The grid shows `veera` under: ' + (result.products.find(p => p.productId === 'veera' && p.catalogue === dup.catalogue).listed ? result.products.find(p => p.productId === 'veera' && p.catalogue === dup.catalogue).listed.tabKey : 'no grid') + '. The second record\'s category (`' + dup.second.category + '`) would place it elsewhere.');
    }
    for (const dup of otherDuplicates) out.push('Also duplicated: `' + dup.productId + '` in ' + dup.catalogue + '.json (differs in: ' + dup.differing.join(', ') + ').');

    out.push('');
    out.push('## 3. Proposed category-to-tab mapping');
    out.push('');
    out.push('The grids group products by tab, but the JSON `category` text does not match the tabs one-to-one. This table shows where each category currently appears. "Proposed" is the most common current tab; "Decision" marks categories that appear under more than one tab or under none.');
    out.push('');
    out.push(row(['Catalogue', 'JSON category', 'Products', 'Currently shown under tab(s)', 'Not in any grid', 'Proposed tab', 'Decision']));
    out.push(row(['---', '---', '---', '---', '---', '---', '---']));
    for (const entry of result.mapping) {
        const tabs = Object.entries(entry.tabs).map(([key, n]) => key + ' x' + n).join(', ');
        out.push(row([entry.catalogue, entry.category, entry.products, tabs || 'none', entry.unlisted, entry.proposed || '(none)', entry.ambiguous ? 'needed' : 'ok']));
    }

    out.push('');
    out.push('## 4. Products whose listing and JSON disagree');
    out.push('');
    out.push('Each row is a product that needs your decision. "Kept as imported" is what the draft currently contains.');
    out.push('');
    out.push(row(['Product', 'Catalogue', 'Problem(s)', 'Kept as imported', 'Detail']));
    out.push(row(['---', '---', '---', '---', '---']));
    for (const product of flagged.sort((a, b) => a.productId.localeCompare(b.productId))) {
        const placement = product.listed ? product.listed.pageKey + ' grid / ' + (product.listed.tabKey || 'All only') : 'not listed';
        out.push(row([product.productId, product.catalogue, [...product.flags].map(flag => FLAG_TEXT[flag]).join('; '), placement, product.notes.join(' ')]));
    }

    out.push('');
    out.push('## 5. Order inside tabs');
    out.push('');
    out.push('The managed catalogue keeps one display order per product (the order under "All"). On the current pages these tabs list products in a different order from "All"; after publishing they will follow the "All" order unless you ask otherwise:');
    out.push('');
    if (!result.tabOrderIssues.length) out.push('None.');
    for (const issue of result.tabOrderIssues) out.push('- ' + issue.page + ' grid, "' + issue.tab + '" tab.');

    out.push('');
    out.push('## 6. Missing images and other gaps');
    out.push('');
    const missing = result.products.filter(p => p.flags.has('missing-image'));
    out.push('Missing image files: ' + (missing.length ? missing.map(p => '`' + p.productId + '` (' + p.catalogue + ')').join(', ') : 'none') + '.');
    const noBenefits = result.products.filter(p => !p.content.benefits);
    out.push('Products with no benefits text: ' + (noBenefits.length ? noBenefits.map(p => '`' + p.productId + '`').join(', ') : 'none') + '.');
    out.push('Grid cards that point to a record missing from the JSON: ' + (result.gridIssues.length ? result.gridIssues.map(i => '`' + i.productId + '`').join(', ') : 'none') + '.');

    out.push('');
    out.push('## 7. What the import changed in the text');
    out.push('');
    out.push('- Names, categories and similar text had `&amp;` style entities decoded to plain characters (for example `Selective Pre &amp; Post Emergence Herbicide` became `Selective Pre & Post Emergence Herbicide`). This field is not shown on public pages today.');
    out.push('- Technical details and benefits keep their `<br>` line breaks; any other markup is cleaned to a safe subset.');
    out.push('- Each product\'s image text defaults to its name. Existing images stay in `products/`.');
    out.push('- Search aliases were seeded from the spellings the old search list recognised (Rotomaxx, Taanbad, Curiass, Casama, Max Mad, Maxlone, Potaxx DM).');
    out.push('');
    return out.join('\n');
}

// The draft does not carry the original order: a product's place in a grid is set when it is published.
function withoutOrder(content) {
    const { display_order: ignored, ...rest } = content;
    return rest;
}

// Stores the result as drafts. Existing products are never touched, so running it again adds nothing new.
// The first revision keeps display_order, the product's place on the original page, so publishing the
// original versions can rebuild each grid in that order.
async function saveDrafts(result, { withTransaction }) {
    let created = 0;
    let existing = 0;
    for (const product of result.products) {
        await withTransaction(async client => {
            const inserted = await client.query(
                `INSERT INTO products (catalogue, product_id, status, draft, needs_decision, import_notes, import_alternate)
                 VALUES ($1, $2, 'draft', $3, $4, $5, $6) ON CONFLICT (catalogue, product_id) DO NOTHING RETURNING id`,
                [product.catalogue, product.productId, JSON.stringify(withoutOrder(product.content)), product.needsDecision,
                    JSON.stringify(product.notes), product.alternate ? JSON.stringify(product.alternate) : null]);
            if (!inserted.rows[0]) { existing++; return; }
            created++;
            await client.query("INSERT INTO product_revisions (product_id, revision_no, action, content) VALUES ($1, 1, 'imported', $2)",
                [inserted.rows[0].id, JSON.stringify(product.content)]);
        });
    }
    return { created, existing };
}

module.exports = { parseListing, buildImport, renderReport, saveDrafts, TAB_KEYS, DEFAULT_LISTING };

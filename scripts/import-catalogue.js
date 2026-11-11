'use strict';

// Imports the existing catalogue as DRAFTS and writes the reconciliation report.
// Nothing is published. Existing managed products are never overwritten, so it is safe to run again.
//   npm run catalogue:import                  imports into the local database and writes docs/catalogue-reconciliation.md
//   npm run catalogue:import -- --report-only only writes the report
const fs = require('node:fs');
const path = require('node:path');
const { buildImport, renderReport, saveDrafts } = require('../lib/catalogue-import');

const root = path.resolve(__dirname, '..');
const reportOnly = process.argv.includes('--report-only');
const reportPath = path.join(root, 'docs', 'catalogue-reconciliation.md');

function load() {
    const read = name => fs.readFileSync(path.join(root, name), 'utf8');
    return buildImport({
        chemical: JSON.parse(read('chemical.json')),
        nonchemical: JSON.parse(read('nonchemical.json')),
        listings: { chemicals: read('chemicals.html'), nonchemical: read('nonchemical.html') }
    }, { imageExists: file => fs.existsSync(path.join(root, file)) });
}

async function store(result) {
    const { query, withTransaction, closePool, assertLocalDatabase } = require('../lib/db');
    assertLocalDatabase();
    try {
        const { created, existing } = await saveDrafts(result, { withTransaction });
        const total = (await query('SELECT count(*)::int AS n FROM products')).rows[0].n;
        console.log('Imported ' + created + ' new drafts, skipped ' + existing + ' that already exist. Products in the database: ' + total + '.');
    } finally {
        await closePool();
    }
}

async function main() {
    const result = load();
    fs.writeFileSync(reportPath, renderReport(result, { generatedOn: new Date().toISOString().slice(0, 10) }));
    console.log('Report written to docs/catalogue-reconciliation.md (' + result.products.length + ' products, ' + result.products.filter(p => p.needsDecision).length + ' need a decision).');
    if (!reportOnly) await store(result);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

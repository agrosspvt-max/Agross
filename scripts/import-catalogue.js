'use strict';

// Imports the existing catalogue as drafts and writes the reconciliation report.
//   npm run catalogue:import                  imports into the local database and writes docs/catalogue-reconciliation.md
//   npm run catalogue:import -- --report-only only writes the report
//   npm run catalogue:import -- --neon        imports drafts into the Neon database specified by DATABASE_URL
//   npm run catalogue:import -- --neon --prepare-live
//     prepares already imported products using their original versions, with the public switch off
const fs = require('node:fs');
const path = require('node:path');
const { buildImport, renderReport, saveDrafts } = require('../lib/catalogue-import');

const root = path.resolve(__dirname, '..');
const reportOnly = process.argv.includes('--report-only');
const importToNeon = process.argv.includes('--neon');
const prepareLive = process.argv.includes('--prepare-live');
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
    if (importToNeon) {
        let target;
        try {
            target = new URL(process.env.DATABASE_URL || '');
        } catch {
            throw new Error('Set DATABASE_URL to the Neon connection string before using --neon.');
        }
        if (!['postgresql:', 'postgres:'].includes(target.protocol) || !target.hostname.endsWith('.neon.tech')) {
            throw new Error('With --neon, DATABASE_URL must point to a Neon PostgreSQL database.');
        }
        console.log((prepareLive ? 'Preparing imported products in ' : 'Importing drafts into ') + target.hostname + target.pathname + '.');
    } else {
        assertLocalDatabase();
    }
    try {
        if (prepareLive) {
            const { publishImportedBaseline } = require('../lib/catalogue-store');
            const prepared = await publishImportedBaseline();
            console.log('Prepared ' + prepared + ' imported products from their original versions. Review Products in the admin before switching on the managed catalogue.');
            return;
        }
        const { created, existing } = await saveDrafts(result, { withTransaction });
        const total = (await query('SELECT count(*)::int AS n FROM products')).rows[0].n;
        console.log('Imported ' + created + ' new drafts, skipped ' + existing + ' that already exist. Products in the database: ' + total + '.');
    } finally {
        await closePool();
    }
}

async function main() {
    if (prepareLive) {
        if (reportOnly) throw new Error('Choose either --prepare-live or --report-only.');
        await store();
        return;
    }
    const result = load();
    if (reportOnly || !importToNeon) {
        fs.writeFileSync(reportPath, renderReport(result, { generatedOn: new Date().toISOString().slice(0, 10) }));
        console.log('Report written to docs/catalogue-reconciliation.md (' + result.products.length + ' products, ' + result.products.filter(p => p.needsDecision).length + ' need a decision).');
    }
    if (!reportOnly) await store(result);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

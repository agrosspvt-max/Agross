'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
const measurementId = process.env.GA_MEASUREMENT_ID?.trim() || '';
if (measurementId && !/^G-[A-Z0-9]+$/.test(measurementId)) {
    throw new Error('GA_MEASUREMENT_ID must be the G-… ID from the Agross web data stream.');
}
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

// Only publish website assets. PHP, credentials, tests and server code stay private.
for (const name of fs.readdirSync(root)) {
    // The two listing pages are answered by api/listing.js (which reads the originals as its template).
    if (['chemicals.html', 'nonchemical.html'].includes(name)) continue;
    if (name.endsWith('.html') || ['chemical.json', 'nonchemical.json', 'allproducts.json'].includes(name)) {
        fs.copyFileSync(path.join(root, name), path.join(output, name));
    }
}
for (const name of ['assets', 'illustra', 'products']) {
    fs.cpSync(path.join(root, name), path.join(output, name), { recursive: true });
}
const tracker = path.join(output, 'assets', 'js', 'analytics.js');
const source = fs.readFileSync(tracker, 'utf8');
fs.writeFileSync(tracker, source.replace("'GA_MEASUREMENT_ID'", JSON.stringify(process.env.VERCEL_ENV === 'production' ? measurementId : '')));
// Admin styles and scripts are public files with no data; the admin pages themselves are served by a checked function.
fs.cpSync(path.join(root, 'admin', 'assets'), path.join(output, 'admin-assets'), { recursive: true });
console.log('Website assets prepared in public/.');

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

// Only publish website assets. PHP, credentials, tests and server code stay private.
for (const name of fs.readdirSync(root)) {
    if (name.endsWith('.html') || ['chemical.json', 'nonchemical.json', 'allproducts.json'].includes(name)) {
        fs.copyFileSync(path.join(root, name), path.join(output, name));
    }
}
for (const name of ['assets', 'illustra', 'products']) {
    fs.cpSync(path.join(root, name), path.join(output, name), { recursive: true });
}
console.log('Website assets prepared in public/.');

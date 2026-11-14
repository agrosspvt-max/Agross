'use strict';

// Local development server: the static site, the API functions and a mock Brevo, on http://localhost:3000.
// Mirrors the routing in vercel.json. Real email is switched off here.
//   npm run dev
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { assertLocalDatabase } = require('../lib/db');
const { createMockBrevo } = require('./mock-brevo');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 3000;
const mockPort = Number(process.env.MOCK_BREVO_PORT) || 4010;

assertLocalDatabase();
// Always the mock: a development computer must never send real enquiry emails.
delete process.env.ALLOW_REAL_EMAIL;
process.env.BREVO_API_URL = 'http://127.0.0.1:' + mockPort;
process.env.BREVO_API_KEY = 'mock-key';
process.env.FORM_FROM_EMAIL = 'mock-sender@agross.local';
process.env.BREVO_WEBHOOK_SECRET = process.env.BREVO_WEBHOOK_SECRET || 'local-dev-webhook-secret';

const handlers = {
    enquiry: require('../api/enquiry'),
    admin: require('../api/admin'),
    adminPage: require('../api/admin-page'),
    webhook: require('../api/brevo-webhook'),
    catalogue: require('../api/catalogue'),
    openings: require('../api/openings'),
    listing: require('../api/listing'),
    image: require('../api/image'),
    binCleanup: require('../api/recruitment-bin-cleanup')
};

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

// Same files the production build publishes, and nothing else.
function staticFile(pathname) {
    let relative = pathname.replace(/^\/+/, '');
    if (relative === '') relative = 'index.html';
    if (relative.startsWith('admin-assets/')) relative = path.join('admin', 'assets', relative.slice('admin-assets/'.length));
    else if (!/^(assets|illustra|products)\//.test(relative) && !/^[^/]+\.(html|json)$/.test(relative)) return null;
    if (relative === 'allproducts.json' || !relative) return null;
    const file = path.resolve(root, relative);
    return file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!raw) return undefined;
    try {
        if (type === 'application/json') return JSON.parse(raw);
        if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(raw));
    } catch { /* falls through */ }
    return raw;
}

function decorate(res) {
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); return res; };
    res.send = body => { res.end(body); return res; };
    return res;
}

const mock = createMockBrevo();

const server = http.createServer(async (req, res) => {
    decorate(res);
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
        let handler = null;
        if (pathname === '/api/enquiry') handler = handlers.enquiry;
        else if (pathname === '/api/brevo-webhook') handler = handlers.webhook;
        else if (pathname === '/api/catalogue') handler = handlers.catalogue;
        else if (pathname === '/api/openings') handler = handlers.openings;
        else if (pathname === '/api/image') handler = handlers.image;
        // Vercel's scheduler calls this once a day in production; locally nothing schedules it, so call it with the bearer secret.
        else if (pathname === '/api/recruitment-bin-cleanup') handler = handlers.binCleanup;
        else if (pathname === '/chemicals.html' || pathname === '/nonchemical.html') {
            handler = handlers.listing;
            url.searchParams.set('page', pathname === '/chemicals.html' ? 'chemicals' : 'nonchemical');
        }
        else if (/^\/api\/admin\/[a-z-]+$/.test(pathname)) {
            handler = handlers.admin;
            url.searchParams.set('route', pathname.split('/').pop());
        } else if (pathname === '/admin' || pathname.startsWith('/admin/')) {
            handler = handlers.adminPage;
            url.searchParams.set('p', pathname.replace(/^\/admin\/?/, ''));
        }

        if (handler) {
            req.query = Object.fromEntries(url.searchParams);
            req.body = await readBody(req);
            return await handler(req, res);
        }
        const file = staticFile(decodeURIComponent(pathname));
        if (file) {
            res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
            return fs.createReadStream(file).pipe(res);
        }
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(fs.readFileSync(path.join(root, '404.html')));
    } catch (error) {
        console.error('dev-server error:', error.message);
        res.statusCode = 500;
        return res.end('Server error');
    }
});

mock.listen(mockPort).then(() => {
    server.listen(port, '127.0.0.1', () => {
        console.log('Agross local site:  http://localhost:' + port);
        console.log('Admin sign-in:      http://localhost:' + port + '/admin');
        console.log('Mock Brevo:         http://127.0.0.1:' + mockPort + '/__mode?mode=ok|fail|timeout|unreadable');
        console.log('Webhook secret (local only): ' + process.env.BREVO_WEBHOOK_SECRET);
    });
});

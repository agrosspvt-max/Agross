'use strict';

// The published product catalogue, as JSON, for the detail pages and the site search.
//   /api/catalogue?catalogue=chemical|nonchemical               a list in the same shape as chemical.json / nonchemical.json
//   /api/catalogue?catalogue=...&productId=<id>                  one product, or "unavailable" if it was archived
// Until the owner switches the managed catalogue on, it answers { live: false } and pages keep using the static JSON files.

const crypto = require('node:crypto');
const store = require('../lib/catalogue-store');
const { CATALOGUES } = require('../lib/catalogue');

// Visitors' browsers always check for a newer copy; Vercel's edge keeps one for a short time. That window
// (30 s, plus up to 60 s while it refreshes) is how long a published change can take to appear.
const BROWSER_CACHE = 'public, max-age=0, must-revalidate';
const EDGE_CACHE = 's-maxage=30, stale-while-revalidate=60';

function cacheHeaders(res, edge = EDGE_CACHE) {
    res.setHeader('Cache-Control', BROWSER_CACHE);
    res.setHeader('Vercel-CDN-Cache-Control', edge);
}

function first(value) {
    return Array.isArray(value) ? value[0] : value;
}

function queryParams(req) {
    if (req.query && typeof req.query === 'object') return req.query;
    return Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
}

module.exports = async function catalogueApi(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).json({ message: 'GET only.' });
    }
    const params = queryParams(req);
    const catalogue = first(params.catalogue);
    const productId = first(params.productId);
    if (!Object.hasOwn(CATALOGUES, String(catalogue))) return res.status(400).json({ message: 'Unknown catalogue.' });

    try {
        if (!(await store.isLive())) {
            cacheHeaders(res);
            return res.status(404).json({ live: false });
        }
        cacheHeaders(res);
        if (productId !== undefined) {
            const result = await store.publicProduct(catalogue, String(productId));
            if (result.state === 'ok') return res.status(200).json({ state: 'ok', product: result.product });
            return res.status(result.state === 'unavailable' ? 410 : 404).json({ state: result.state });
        }
        const [version, products] = await Promise.all([store.currentVersion(), store.publicCatalogue(catalogue)]);
        const body = JSON.stringify(products);
        const etag = '"' + crypto.createHash('sha1').update(catalogue + ':' + version + ':' + body.length).digest('hex') + '"';
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(200).send(body);
    } catch (error) {
        console.error('Catalogue request failed', { code: error && error.code });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(503).json({ message: 'The catalogue is not available right now.' });
    }
};

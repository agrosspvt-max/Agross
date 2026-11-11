'use strict';

// Serves chemicals.html and nonchemical.html. The cards, tabs and grids come from the published catalogue
// and are written into the same page markup, so visitors and search engines still receive the cards in the HTML.
// If the managed catalogue is off, empty or unreachable, the original page is served unchanged.

const fs = require('node:fs');
const path = require('node:path');
const store = require('../lib/catalogue-store');
const { LISTING_PAGES, renderListing, fillTemplate } = require('../lib/catalogue');

// Visitors' browsers always check for a newer copy; Vercel's edge keeps one for a short time. That window
// (30 s, plus up to 60 s while it refreshes) is how long a published change can take to appear.
const BROWSER_CACHE = 'public, max-age=0, must-revalidate';
const EDGE_CACHE = 's-maxage=30, stale-while-revalidate=60';

function cacheHeaders(res, edge = EDGE_CACHE) {
    res.setHeader('Cache-Control', BROWSER_CACHE);
    res.setHeader('Vercel-CDN-Cache-Control', edge);
}

module.exports = async function listing(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).send('Method not allowed.');
    }
    const asked = req.query && typeof req.query.page === 'string' ? req.query.page : new URL(req.url || '/', 'http://localhost').searchParams.get('page');
    if (!Object.hasOwn(LISTING_PAGES, String(asked))) return res.status(404).send('Not found.');
    const template = fs.readFileSync(path.join(__dirname, '..', LISTING_PAGES[asked].template), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    try {
        if (await store.isLive()) {
            const [products, tabs] = await Promise.all([store.listingProducts(asked), store.listingTabs()]);
            if (products.length) {
                cacheHeaders(res);
                res.setHeader('X-Catalogue', 'managed');
                return res.status(200).send(fillTemplate(template, renderListing(asked, products, tabs.filter(tab => tab.listing_page === asked))));
            }
        }
        cacheHeaders(res);
        res.setHeader('X-Catalogue', 'original');
    } catch (error) {
        console.error('Listing could not use the catalogue', { code: error && error.code });
        cacheHeaders(res, 's-maxage=10');
        res.setHeader('X-Catalogue', 'original');
    }
    return res.status(200).send(template);
};

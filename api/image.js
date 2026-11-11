'use strict';

// Product images that were uploaded in the admin. Only images of published products are served.
const store = require('../lib/catalogue-store');

module.exports = async function image(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).send('Method not allowed.');
    }
    const id = req.query && typeof req.query.id === 'string' ? req.query.id : new URL(req.url || '/', 'http://localhost').searchParams.get('id');
    try {
        const found = await store.getPublicImage(String(id));
        if (!found) {
            res.setHeader('Cache-Control', 'public, s-maxage=30');
            return res.status(404).send('Not found.');
        }
        res.setHeader('Content-Type', found.content_type);
        // The ID never points at different bytes, so browsers may keep it for a year.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'");
        return res.status(200).send(found.data);
    } catch (error) {
        console.error('Image request failed', { code: error && error.code });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(503).send('Not available.');
    }
};

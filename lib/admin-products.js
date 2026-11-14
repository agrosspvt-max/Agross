'use strict';

// Admin API routes for the product editor. api/admin.js calls handle() for every route name starting with "product"
// or "catalogue". Viewing and editing need products_edit; publishing, archiving, restoring, deleting and the
// public-site switch need products_publish. Permissions are checked here on the server for every call.

const store = require('../lib/catalogue-store');
const catalogue = require('../lib/catalogue');
const { MAX_BYTES } = require('../lib/images');
const { authenticate, sendError, audit } = require('../lib/auth');

const MAX_BASE64_LENGTH = Math.ceil(MAX_BYTES * 4 / 3) + 100;
const PUBLISH_ROUTES = new Set(['product-publish', 'product-archive', 'product-restore', 'product-delete', 'product-decision-clear']);

function methodNotAllowed(res, allowed) {
    res.setHeader('Allow', allowed);
    return sendError(res, 405, 'Method not allowed.');
}

async function checked(content, productCatalogue) {
    const { withTransaction } = require('../lib/db');
    return withTransaction(async client => catalogue.validateContent(content, await store.validationContext(client, content, productCatalogue)));
}

// What the editor needs to draw one product.
async function productView(id) {
    const product = await store.getProduct(id);
    if (!product) return null;
    const validation = await checked(catalogue.cleanContent(product.content), product.catalogue);
    return { ...product, validation };
}

// Previews are drawn on admin pages (and in a sandboxed frame), so picture addresses must not depend on the page's own path.
function adminImageUrl(content) {
    if (content.image_id) return '/api/admin/product-image?id=' + content.image_id;
    return content.image ? '/' + content.image : '';
}

async function handle(name, req, res, { params, first, jsonBody }) {
    const publishing = PUBLISH_ROUTES.has(name) || (name === 'catalogue-live' && req.method === 'POST');
    const session = await authenticate(req, res, { permission: publishing ? 'products_publish' : 'products_edit' });
    if (!session) return true;
    const user = session.user;
    const body = req.method === 'POST' ? jsonBody(req) : null;

    try {
        if (name === 'products') {
            if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
            const parsed = store.parseListFilters({
                catalogue: first(params.catalogue), status: first(params.status), category: first(params.category), tab: first(params.tab), q: first(params.q)
            });
            if (parsed.error) return sendError(res, 400, parsed.error), true;
            return res.status(200).json(await store.listProducts(parsed.filters, first(params.page), first(params.pageSize))), true;
        }

        if (name === 'product-facets') {
            if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
            const facets = await store.facets();
            const [live, version] = await Promise.all([store.isLive(), store.currentVersion()]);
            return res.status(200).json({ ...facets, live, version, canPublish: user.permissions.includes('products_publish') }), true;
        }

        if (name === 'product') {
            if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
            const view = await productView(first(params.id));
            return (view ? res.status(200).json({ ...view, canPublish: user.permissions.includes('products_publish') }) : sendError(res, 404, 'Product not found.')), true;
        }

        if (name === 'product-image') {
            if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
            const found = await store.getImage(first(params.id));
            if (!found) return sendError(res, 404, 'Image not found.'), true;
            res.setHeader('Content-Type', found.content_type);
            res.setHeader('Content-Security-Policy', "default-src 'none'");
            return res.status(200).send(found.data), true;
        }

        if (name === 'product-preview') {
            if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
            const product = await store.getProduct(first(params.id));
            if (!product) return sendError(res, 404, 'Product not found.'), true;
            const content = catalogue.cleanContent(product.content);
            const shown = { ...content, image_id: null, image: adminImageUrl(content) || null };
            const record = catalogue.toPublic(product.catalogue, product.productId, shown);
            return res.status(200).json({
                product: record, cardHtml: catalogue.renderCard(product.catalogue, product.productId, shown),
                detailUrl: catalogue.CATALOGUES[product.catalogue].detailPage + '?productId=' + encodeURIComponent(product.productId) + '&preview=' + product.id
            }), true;
        }

        // What publishing would change in the grid positions, shown to the admin before publishing.
        if (name === 'product-publish-preview') {
            if (req.method !== 'GET') return methodNotAllowed(res, 'GET'), true;
            return res.status(200).json(await store.publishPreview(first(params.id))), true;
        }

        if (name === 'catalogue-live') {
            if (req.method === 'GET') {
                return res.status(200).json({ live: await store.isLive(), version: await store.currentVersion() }), true;
            }
            if (req.method !== 'POST') return methodNotAllowed(res, 'GET, POST'), true;
            if (!body || typeof body.live !== 'boolean') return sendError(res, 400, 'Choose on or off.'), true;
            await store.setLive(body.live, user);
            await audit(user.id, body.live ? 'catalogue_switched_on' : 'catalogue_switched_off', 'catalogue', 'public');
            return res.status(200).json({ live: body.live }), true;
        }

        // Everything below changes data.
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST'), true;
        if (!body) return sendError(res, 400, 'The request could not be read.'), true;

        if (name === 'product-create') {
            const id = await store.createProduct({ catalogue: body.catalogue, productId: body.productId, content: body.content, position: body.position }, user);
            return res.status(200).json({ id }), true;
        }
        if (name === 'product-save') {
            const result = await store.saveDraft(body.id, body.content, body.version, user, body.position);
            const product = await store.getProduct(body.id);
            const validation = await checked(catalogue.cleanContent(product.content), product.catalogue);
            return res.status(200).json({ ...result, validation }), true;
        }
        if (name === 'product-publish') {
            const result = await store.publish(body.id, user, { positionToken: body.positionToken });
            return res.status(200).json(result), true;
        }
        if (name === 'product-archive') {
            await store.archive(body.id, user);
            return res.status(200).json({ ok: true }), true;
        }
        if (name === 'product-restore') {
            return res.status(200).json(await store.restore(body.id, user)), true;
        }
        if (name === 'product-discard') {
            await store.discardDraft(body.id, user);
            return res.status(200).json({ ok: true }), true;
        }
        if (name === 'product-revision-restore') {
            await store.restoreRevision(body.id, body.number, user);
            return res.status(200).json({ ok: true }), true;
        }
        if (name === 'product-delete') {
            await store.deleteProduct(body.id, body.confirmProductId, user);
            return res.status(200).json({ ok: true }), true;
        }
        if (name === 'product-decision-clear') {
            await store.clearNeedsDecision(body.id, user);
            return res.status(200).json({ ok: true }), true;
        }
        if (name === 'product-image-upload') {
            if (typeof body.dataBase64 !== 'string' || !body.dataBase64 || body.dataBase64.length > MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/=\s]+$/.test(body.dataBase64)) {
                return sendError(res, 400, 'Choose a PNG, JPEG or WebP image of up to ' + MAX_BYTES / 1024 / 1024 + ' MB.'), true;
            }
            const saved = await store.saveImage(Buffer.from(body.dataBase64, 'base64'), body.filename, user);
            return res.status(200).json(saved), true;
        }
    } catch (error) {
        if (error instanceof store.StoreError) return sendError(res, error.status, error.message, error.extra), true;
        throw error;
    }
    return false;
}

module.exports = { handle };

'use strict';

// The managed catalogue against a real (local, test-only) database: drafts, publishing, archiving, images,
// permissions, the public endpoints and the import round trip.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { db, databaseAvailable, cleanDatabase, response } = require('./helpers');
const auth = require('../lib/auth');
const store = require('../lib/catalogue-store');
const { buildImport, saveDrafts, parseListing } = require('../lib/catalogue-import');
const admin = require('../api/admin');
const adminPage = require('../api/admin-page');
const catalogueApi = require('../api/catalogue');
const listingApi = require('../api/listing');
const imageApi = require('../api/image');

let available = false;
before(async () => { available = await databaseAvailable(); });
beforeEach(async () => { if (available) await cleanDatabase(); });
after(() => db.closePool());

const PASSWORD = 'correct horse battery';
const ORIGIN = { host: 'admin.test', origin: 'http://admin.test' };

async function createUser(username, permissions) {
    const { rows } = await db.query('INSERT INTO admin_users (username, password_hash, display_name, permissions) VALUES ($1, $2, $3, $4) RETURNING id',
        [username, await auth.hashPassword(PASSWORD), username, permissions]);
    return { id: rows[0].id };
}

async function call(handler, { method = 'GET', route, query = {}, body, cookie, csrf, headers: extra = {} } = {}) {
    const res = response();
    const headers = { ...ORIGIN, 'content-type': 'application/json', 'user-agent': 'test', ...extra };
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;
    if (method === 'GET') delete headers.origin;
    await handler({ method, headers, query: { ...(route ? { route } : {}), ...query }, body, url: '/', socket: { remoteAddress: '203.0.113.7' } }, res);
    return res;
}

async function signIn(username) {
    const res = await call(admin, { method: 'POST', route: 'login', body: { username, password: PASSWORD } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const cookie = res.headers['set-cookie'].split(';')[0];
    return { cookie, csrf: (await call(admin, { route: 'me', cookie })).body.csrfToken };
}

async function owner() {
    await createUser('owner', auth.ALL_PERMISSIONS);
    const session = await signIn('owner');
    const post = (route, body) => call(admin, { method: 'POST', route, body, ...session });
    const get = (route, query) => call(admin, { route, query, cookie: session.cookie });
    return { ...session, post, get };
}

const sample = (name, extra = {}) => ({
    name, category: 'Herbicide', technical: 'Sample<br>details', benefits: 'Helps crops', application: 'Foliar', dose: '100 ml/acre', packing: '1 Litre',
    listing_page: 'chemicals', listing_tab: 'herbicide', display_order: 10, image: 'products/Janta.png', image_alt: name + ' pack', ...extra
});

async function addProduct(o, productId, content, catalogue = 'chemical') {
    const created = await o.post('product-create', { catalogue, productId, content });
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    return created.body.id;
}

async function publishProduct(o, id) {
    const res = await o.post('product-publish', { id });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}

async function setLive(value) {
    await db.query("UPDATE app_settings SET value = $1::jsonb WHERE key = 'catalogue_live'", [JSON.stringify(value)]);
}

// The list is sent as a JSON text; parse it the way a browser would.
const publicList = async catalogue => {
    const res = await call(catalogueApi, { query: { catalogue } });
    if (typeof res.body === 'string') res.body = JSON.parse(res.body);
    return res;
};
const publicOne = (catalogue, productId) => call(catalogueApi, { query: { catalogue, productId } });
const listingHtml = page => call(listingApi, { query: { page } });

// A minimal valid PNG (300 x 200) with some unique bytes so each upload differs.
function png(seed = 0) {
    const b = Buffer.alloc(64);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b, 0);
    b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(300, 16); b.writeUInt32BE(200, 20); b[40] = seed;
    return b;
}
const upload = (o, seed, name = 'pack.png') => o.post('product-image-upload', { filename: name, dataBase64: png(seed).toString('base64') });

test('a new product is a draft that visitors cannot see until it is published', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    await setLive(true);
    const id = await addProduct(o, 'sample one', sample('SAMPLE ONE'));
    assert.deepEqual((await publicList('chemical')).body, []);
    assert.equal((await publicOne('chemical', 'sample one')).statusCode, 404);
    assert.doesNotMatch((await listingHtml('chemicals')).body, /SAMPLE ONE/);
    const view = (await o.get('product', { id })).body;
    assert.equal(view.status, 'draft');
    assert.equal(view.published, null);

    await publishProduct(o, id);
    const list = (await publicList('chemical')).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].productId, 'sample one');
    assert.equal(list[0].name, 'SAMPLE ONE');
    assert.equal(list[0].technical, 'Sample<br>details');
    assert.equal((await publicOne('chemical', 'sample one')).body.product.dose, '100 ml/acre');
    const html = (await listingHtml('chemicals')).body;
    assert.match(html, /SAMPLE ONE/);
    assert.match(html, /href="product\.html\?productId=sample%20one"/);
});

test('a draft edit leaves the published product and image visible until publication', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    await setLive(true);
    const first = await upload(o, 1);
    const id = await addProduct(o, 'sample two', sample('SAMPLE TWO', { image: null, image_id: first.body.id }));
    await publishProduct(o, id);
    assert.equal((await call(imageApi, { query: { id: first.body.id } })).statusCode, 200);

    // Edit name, dose and replace the image, but do not publish.
    const second = await upload(o, 2);
    const version = (await o.get('product', { id })).body.version;
    const saved = await o.post('product-save', { id, version, content: sample('SAMPLE TWO RENAMED', { dose: '999 ml', image: null, image_id: second.body.id, image_alt: 'new pack' }) });
    assert.equal(saved.statusCode, 200);

    const view = (await o.get('product', { id })).body;
    assert.equal(view.status, 'published');
    assert.equal(view.hasChanges, true);
    assert.equal(view.draft.name, 'SAMPLE TWO RENAMED');
    assert.equal(view.published.name, 'SAMPLE TWO');

    const visible = (await publicOne('chemical', 'sample two')).body.product;
    assert.equal(visible.name, 'SAMPLE TWO');
    assert.equal(visible.dose, '100 ml/acre');
    assert.equal(visible.image, '/api/image?id=' + first.body.id);
    const html = (await listingHtml('chemicals')).body;
    assert.match(html, /SAMPLE TWO/);
    assert.doesNotMatch(html, /RENAMED/);
    assert.equal((await call(imageApi, { query: { id: first.body.id } })).statusCode, 200, 'old image still served');
    assert.equal((await call(imageApi, { query: { id: second.body.id } })).statusCode, 404, 'draft image is not public');
    assert.equal((await call(admin, { route: 'product-image', query: { id: second.body.id }, cookie: o.cookie })).statusCode, 200, 'staff can see it');

    await publishProduct(o, id);
    assert.equal((await publicOne('chemical', 'sample two')).body.product.name, 'SAMPLE TWO RENAMED');
    assert.equal((await call(imageApi, { query: { id: second.body.id } })).statusCode, 200);
    assert.equal((await call(imageApi, { query: { id: first.body.id } })).statusCode, 404, 'replaced image is no longer served');
    assert.equal((await o.get('product', { id })).body.hasChanges, false);
});

test('discarding a draft goes back to the published version', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const id = await addProduct(o, 'sample three', sample('SAMPLE THREE'));
    assert.equal((await o.post('product-discard', { id })).statusCode, 409, 'nothing published yet');
    await publishProduct(o, id);
    const version = (await o.get('product', { id })).body.version;
    await o.post('product-save', { id, version, content: sample('CHANGED') });
    assert.equal((await o.get('product', { id })).body.content.name, 'CHANGED');
    assert.equal((await o.post('product-discard', { id })).statusCode, 200);
    const after = (await o.get('product', { id })).body;
    assert.equal(after.content.name, 'SAMPLE THREE');
    assert.equal(after.hasChanges, false);
    // Saving the draft back to exactly the published content leaves no pending changes.
    await o.post('product-save', { id, version: after.version, content: after.published });
    assert.equal((await o.get('product', { id })).body.hasChanges, false);
});

test('archiving and restoring change the grid, search data and detail page together', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    await setLive(true);
    const keep = await addProduct(o, 'keeper', sample('KEEPER', { display_order: 20 }));
    const id = await addProduct(o, 'sample four', sample('SAMPLE FOUR', { display_order: 10 }));
    await publishProduct(o, keep);
    await publishProduct(o, id);
    assert.equal((await publicList('chemical')).body.length, 2);

    assert.equal((await o.post('product-archive', { id })).statusCode, 200);
    assert.deepEqual((await publicList('chemical')).body.map(p => p.productId), ['keeper']);
    const gone = await publicOne('chemical', 'sample four');
    assert.equal(gone.statusCode, 410);
    assert.equal(gone.body.state, 'unavailable');
    assert.equal((await publicOne('chemical', 'never existed')).statusCode, 404);
    const html = (await listingHtml('chemicals')).body;
    assert.doesNotMatch(html, /SAMPLE FOUR/);
    assert.match(html, /KEEPER/);
    assert.equal((await o.post('product-archive', { id })).statusCode, 409);
    assert.equal((await o.post('product-publish', { id })).statusCode, 409, 'restore before publishing');

    const restored = await o.post('product-restore', { id });
    assert.equal(restored.body.status, 'published');
    assert.deepEqual((await publicList('chemical')).body.map(p => p.productId), ['sample four', 'keeper']);
    assert.equal((await publicOne('chemical', 'sample four')).statusCode, 200);
    assert.match((await listingHtml('chemicals')).body, /SAMPLE FOUR/);
    assert.equal((await o.post('product-restore', { id })).statusCode, 409);
});

test('a product that was never published comes back as a draft when restored', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const id = await addProduct(o, 'sample five', sample('SAMPLE FIVE'));
    await o.post('product-archive', { id });
    assert.equal((await o.post('product-restore', { id })).body.status, 'draft');
});

test('publishing is blocked until the required fields are right', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const id = await addProduct(o, 'sample six', { name: 'SAMPLE SIX' });
    const blocked = await o.post('product-publish', { id });
    assert.equal(blocked.statusCode, 422);
    assert.ok(blocked.body.errors.category);
    const version = (await o.get('product', { id })).body.version;
    const wrongTab = await o.post('product-save', { id, version, content: sample('SAMPLE SIX', { listing_tab: 'pgpr' }) });
    assert.equal(wrongTab.statusCode, 200, 'drafts may be incomplete or inconsistent');
    assert.ok(wrongTab.body.validation.errors.listing_tab);
    assert.equal((await o.post('product-publish', { id })).statusCode, 422);
    assert.equal((await db.query("SELECT count(*)::int n FROM products WHERE status = 'published'")).rows[0].n, 0);
});

test('product IDs are unique per catalogue and cannot be changed', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    await addProduct(o, 'twin', sample('TWIN'));
    assert.equal((await o.post('product-create', { catalogue: 'chemical', productId: 'twin', content: sample('AGAIN') })).statusCode, 409);
    assert.equal((await o.post('product-create', { catalogue: 'nonchemical', productId: 'twin', content: sample('OTHER CATALOGUE') })).statusCode, 200, 'same ID in the other catalogue is allowed');
    for (const productId of ['Upper', ' lead', 'bad/slash', '', 'x'.repeat(81), 'tab\tchar', '../x']) {
        assert.equal((await o.post('product-create', { catalogue: 'chemical', productId, content: sample('X') })).statusCode, 400, JSON.stringify(productId));
    }
    assert.equal((await o.post('product-create', { catalogue: 'other', productId: 'fine', content: sample('X') })).statusCode, 400);
    assert.equal((await o.post('product-create', { catalogue: 'chemical', productId: 'noname', content: {} })).statusCode, 400);
    const id = (await db.query("SELECT id FROM products WHERE product_id = 'twin' AND catalogue = 'chemical'")).rows[0].id;
    const view = (await o.get('product', { id })).body;
    await o.post('product-save', { id, version: view.version, content: sample('TWIN RENAMED'), productId: 'changed', catalogue: 'nonchemical' });
    const after = (await o.get('product', { id })).body;
    assert.equal(after.productId, 'twin');
    assert.equal(after.catalogue, 'chemical');
});

test('a product keeps its web address when its name changes (the Rotomax case)', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    await setLive(true);
    const id = await addProduct(o, 'rotomax', sample('ROTOMAX', { listing_page: 'nonchemical', listing_tab: 'pgpr', aliases: ['Rotomaxx'] }), 'nonchemical');
    await publishProduct(o, id);
    const version = (await o.get('product', { id })).body.version;
    await o.post('product-save', { id, version, content: sample('ROTOMAXX PLUS', { listing_page: 'nonchemical', listing_tab: 'pgpr', aliases: ['Rotomaxx', 'Roto'] }) });
    await publishProduct(o, id);
    const found = await publicOne('nonchemical', 'rotomax');
    assert.equal(found.statusCode, 200);
    assert.equal(found.body.product.name, 'ROTOMAXX PLUS');
    assert.deepEqual(found.body.product.aliases, ['Rotomaxx', 'Roto']);
    assert.match((await listingHtml('nonchemical')).body, /nonchemical-details\.html\?productId=rotomax"/);
});

test('stale edits are refused instead of overwriting newer ones', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const id = await addProduct(o, 'sample seven', sample('SAMPLE SEVEN'));
    const version = (await o.get('product', { id })).body.version;
    assert.equal((await o.post('product-save', { id, version, content: sample('FIRST') })).statusCode, 200);
    const stale = await o.post('product-save', { id, version, content: sample('SECOND') });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.body.code, 'version_conflict');
    assert.equal((await o.get('product', { id })).body.content.name, 'FIRST');
});

test('history can be reloaded into the draft', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const id = await addProduct(o, 'sample eight', sample('ORIGINAL'));
    const version = (await o.get('product', { id })).body.version;
    await o.post('product-save', { id, version, content: sample('SECOND NAME') });
    const history = (await o.get('product', { id })).body.revisions;
    assert.deepEqual(history.map(r => r.action), ['draft_saved', 'created']);
    assert.equal((await o.post('product-revision-restore', { id, number: history[1].number })).statusCode, 200);
    assert.equal((await o.get('product', { id })).body.content.name, 'ORIGINAL');
    assert.equal((await o.post('product-revision-restore', { id, number: 999 })).statusCode, 404);
});

test('permanent deletion needs an archived product and the typed ID', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const id = await addProduct(o, 'sample nine', sample('SAMPLE NINE'));
    await publishProduct(o, id);
    assert.equal((await o.post('product-delete', { id, confirmProductId: 'sample nine' })).statusCode, 409, 'published products cannot be deleted');
    await o.post('product-archive', { id });
    assert.equal((await o.post('product-delete', { id, confirmProductId: 'wrong' })).statusCode, 400);
    assert.equal((await o.post('product-delete', { id, confirmProductId: 'sample nine' })).statusCode, 200);
    assert.equal((await o.get('product', { id })).statusCode, 404);
    const audit = (await db.query("SELECT metadata FROM audit_log WHERE action = 'product_deleted'")).rows[0].metadata;
    assert.deepEqual(Object.keys(audit).sort(), ['catalogue', 'productId']);
});

test('images are checked, stored in the database and only public once published', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const good = await upload(o, 5);
    assert.equal(good.statusCode, 200);
    assert.deepEqual([good.body.width, good.body.height], [300, 200]);
    const stored = (await db.query('SELECT content_type, bytes, sha256 FROM product_images')).rows[0];
    assert.equal(stored.content_type, 'image/png');
    assert.equal(stored.sha256.length, 64);

    for (const [data, label] of [
        [Buffer.from('GIF89a' + 'x'.repeat(60)).toString('base64'), 'gif'],
        [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'.repeat(3)).toString('base64'), 'svg'],
        [Buffer.from('plain text file').toString('base64'), 'text'],
        ['', 'empty'], ['not base64 !!!', 'bad base64'],
        [Buffer.concat([png(1), Buffer.alloc(2.2 * 1024 * 1024)]).toString('base64'), 'too big']
    ]) {
        const res = await o.post('product-image-upload', { filename: 'x.png', dataBase64: data });
        assert.equal(res.statusCode, 400, label);
    }
    assert.equal((await db.query('SELECT count(*)::int n FROM product_images')).rows[0].n, 1);

    assert.equal((await call(imageApi, { query: { id: good.body.id } })).statusCode, 404, 'not attached to a published product');
    assert.equal((await call(imageApi, { query: { id: 'not-a-uuid' } })).statusCode, 404);
    const id = await addProduct(o, 'with image', sample('WITH IMAGE', { image: null, image_id: good.body.id }));
    assert.equal((await call(imageApi, { query: { id: good.body.id } })).statusCode, 404, 'still a draft');
    await publishProduct(o, id);
    const served = await call(imageApi, { query: { id: good.body.id } });
    assert.equal(served.statusCode, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.match(served.headers['cache-control'], /immutable/);
    assert.equal(Buffer.compare(served.body, png(5)), 0);

    assert.equal((await call(admin, { route: 'product-image', query: { id: good.body.id } })).statusCode, 401, 'staff only');
});

test('the public site keeps its original pages until the managed catalogue is switched on', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const id = await addProduct(o, 'only one', sample('ONLY ONE'));
    await publishProduct(o, id);
    const original = fs.readFileSync('chemicals.html', 'utf8');

    const off = await call(catalogueApi, { query: { catalogue: 'chemical' } });
    assert.equal(off.statusCode, 404);
    assert.deepEqual(off.body, { live: false });
    const offPage = await listingHtml('chemicals');
    assert.equal(offPage.body, original);
    assert.equal(offPage.headers['x-catalogue'], 'original');

    assert.equal((await o.post('catalogue-live', { live: true })).statusCode, 200);
    const onPage = await listingHtml('chemicals');
    assert.equal(onPage.headers['x-catalogue'], 'managed');
    assert.match(onPage.body, /ONLY ONE/);
    assert.match(onPage.body, /<!-- catalogue:start -->/);
    assert.doesNotMatch(onPage.body, /JANTA/);
    assert.match(onPage.body, /support-area/, 'the rest of the page is intact');

    // Nothing published on a page: the original page is served rather than an empty grid.
    assert.equal((await listingHtml('nonchemical')).headers['x-catalogue'], 'original');
    // Switch back instantly.
    await o.post('catalogue-live', { live: false });
    assert.equal((await listingHtml('chemicals')).body, original);
    assert.deepEqual((await call(catalogueApi, { query: { catalogue: 'chemical' } })).body, { live: false });
});

test('when the database is down the original listing page is still served', async t => {
    if (!available) return t.skip('no test database');
    const original = fs.readFileSync('chemicals.html', 'utf8');
    const good = process.env.DATABASE_URL;
    await db.closePool();
    process.env.DATABASE_URL = 'postgres://agross@127.0.0.1:1/none';
    const log = console.error;
    console.error = () => {};
    try {
        const page = await listingHtml('chemicals');
        assert.equal(page.statusCode, 200);
        assert.equal(page.body, original);
        assert.equal((await call(catalogueApi, { query: { catalogue: 'chemical' } })).statusCode, 503);
    } finally {
        console.error = log;
        await db.closePool();
        process.env.DATABASE_URL = good;
    }
});

test('public responses never contain drafts, archived products or internal fields', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    await setLive(true);
    const live = await addProduct(o, 'public one', sample('PUBLIC ONE'));
    await publishProduct(o, live);
    const version = (await o.get('product', { id: live })).body.version;
    await o.post('product-save', { id: live, version, content: sample('SECRET DRAFT NAME', { description: 'unpublished text' }) });
    await addProduct(o, 'only draft', sample('ONLY DRAFT'));
    const archived = await addProduct(o, 'archived one', sample('ARCHIVED ONE'));
    await publishProduct(o, archived);
    await o.post('product-archive', { id: archived });
    await db.query("UPDATE products SET import_notes = '[\"internal note\"]', needs_decision = true WHERE product_id = 'public one'");

    const everything = JSON.stringify([(await publicList('chemical')).body, (await publicOne('chemical', 'public one')).body, (await listingHtml('chemicals')).body]);
    for (const secret of ['SECRET DRAFT NAME', 'unpublished text', 'ONLY DRAFT', 'ARCHIVED ONE', 'internal note', 'needs_decision', 'import_notes']) {
        assert.ok(!everything.includes(secret), secret);
    }
    assert.match(everything, /PUBLIC ONE/);
    assert.equal((await publicOne('chemical', 'only draft')).statusCode, 404, 'a draft is simply unknown');
    assert.equal((await call(catalogueApi, { query: { catalogue: 'bogus' } })).statusCode, 400);
    assert.equal((await call(catalogueApi, { method: 'POST', query: { catalogue: 'chemical' } })).statusCode, 405);
});

test('catalogue and listing responses are cacheable for a short, defined time', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    await setLive(true);
    await publishProduct(o, await addProduct(o, 'cache one', sample('CACHE ONE')));
    const list = await publicList('chemical');
    assert.match(list.headers['vercel-cdn-cache-control'], /s-maxage=30/);
    assert.match(list.headers['cache-control'], /max-age=0/, 'browsers always revalidate');
    assert.ok(list.headers.etag);
    const again = response();
    await catalogueApi({ method: 'GET', headers: { 'if-none-match': list.headers.etag }, query: { catalogue: 'chemical' }, url: '/' }, again);
    assert.equal(again.statusCode, 304);
    assert.match((await listingHtml('chemicals')).headers['vercel-cdn-cache-control'], /s-maxage=30/);
});

test('the product editor needs the right permission for every action', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const id = await addProduct(o, 'guarded', sample('GUARDED'));
    await publishProduct(o, id);
    await createUser('editor', ['products_edit']);
    await createUser('mailonly', ['enquiries']);
    const editor = await signIn('editor');
    const mailonly = await signIn('mailonly');

    // No session at all.
    for (const [method, route, query] of [['GET', 'products'], ['GET', 'product', { id }], ['GET', 'product-facets'], ['GET', 'product-preview', { id }], ['POST', 'product-create'], ['POST', 'product-save'],
        ['POST', 'product-publish'], ['POST', 'product-archive'], ['POST', 'product-restore'], ['POST', 'product-delete'], ['POST', 'product-image-upload'], ['GET', 'catalogue-live'], ['POST', 'catalogue-live']]) {
        assert.equal((await call(admin, { method, route, query, body: method === 'POST' ? { id } : undefined })).statusCode, 401, route);
    }
    // Enquiry access alone gives no product access.
    for (const [method, route, query] of [['GET', 'products'], ['GET', 'product', { id }], ['POST', 'product-create'], ['POST', 'product-publish']]) {
        assert.equal((await call(admin, { method, route, query, body: { id }, ...mailonly })).statusCode, 403, route);
    }
    assert.equal((await call(adminPage, { query: { p: 'products' }, cookie: mailonly.cookie })).statusCode, 403);
    // An editor can edit but not publish, archive, restore, delete or switch the site.
    assert.equal((await call(admin, { route: 'products', cookie: editor.cookie })).statusCode, 200);
    assert.equal((await call(admin, { method: 'POST', route: 'product-create', body: { catalogue: 'chemical', productId: 'by editor', content: sample('BY EDITOR') }, ...editor })).statusCode, 200);
    for (const route of ['product-publish', 'product-archive', 'product-restore', 'product-delete', 'product-decision-clear']) {
        assert.equal((await call(admin, { method: 'POST', route, body: { id }, ...editor })).statusCode, 403, route);
    }
    assert.equal((await call(admin, { method: 'POST', route: 'catalogue-live', body: { live: true }, ...editor })).statusCode, 403);
    assert.equal((await call(admin, { route: 'catalogue-live', cookie: editor.cookie })).statusCode, 200);
    assert.equal((await call(adminPage, { query: { p: 'products' }, cookie: editor.cookie })).statusCode, 200);
    assert.equal((await call(adminPage, { query: { p: 'products/new' }, cookie: editor.cookie })).statusCode, 200);
    assert.equal((await call(adminPage, { query: { p: '' }, cookie: editor.cookie })).headers.location, '/admin/products', 'an editor lands on the product list');
    // Changes need the CSRF token.
    assert.equal((await call(admin, { method: 'POST', route: 'product-save', body: { id }, cookie: editor.cookie })).statusCode, 403);
    assert.equal((await db.query("SELECT status FROM products WHERE product_id = 'guarded'")).rows[0].status, 'published');
});

test('list filters, search and facets work', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    await addProduct(o, 'alpha herb', sample('ALPHA HERB'));
    const b = await addProduct(o, 'beta fung', sample('BETA FUNG', { category: 'Fungicide', listing_tab: null }));
    await addProduct(o, 'gamma bio', sample('GAMMA BIO', { category: 'Organic', listing_page: 'nonchemical', listing_tab: 'pgpr' }), 'nonchemical');
    await publishProduct(o, b);
    const ids = res => res.body.items.map(i => i.productId).sort();
    assert.deepEqual(ids(await o.get('products')), ['alpha herb', 'beta fung', 'gamma bio']);
    assert.deepEqual(ids(await o.get('products', { catalogue: 'nonchemical' })), ['gamma bio']);
    assert.deepEqual(ids(await o.get('products', { status: 'published' })), ['beta fung']);
    assert.deepEqual(ids(await o.get('products', { status: 'draft' })), ['alpha herb', 'gamma bio']);
    assert.deepEqual(ids(await o.get('products', { category: 'Fungicide' })), ['beta fung']);
    assert.deepEqual(ids(await o.get('products', { tab: 'pgpr' })), ['gamma bio']);
    assert.deepEqual(ids(await o.get('products', { q: 'BETA' })), ['beta fung']);
    assert.deepEqual(ids(await o.get('products', { q: 'gamma b' })), ['gamma bio']);
    assert.deepEqual(ids(await o.get('products', { q: '%' })), []);
    assert.equal((await o.get('products', { status: 'weird' })).statusCode, 400);
    assert.equal((await o.get('products', { catalogue: 'weird' })).statusCode, 400);
    const facets = (await o.get('product-facets')).body;
    assert.deepEqual([facets.counts.draft, facets.counts.published], [2, 1]);
    assert.equal(facets.live, false);
    assert.equal(facets.tabs.length, 9);
});

test('the preview shows the saved draft, including an image that is not public yet', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const img = await upload(o, 9);
    const id = await addProduct(o, 'preview me', sample('PREVIEW <ME>', { image: null, image_id: img.body.id }));
    const preview = (await o.get('product-preview', { id })).body;
    assert.match(preview.cardHtml, /PREVIEW &lt;ME&gt;/);
    assert.ok(preview.cardHtml.includes('/api/admin/product-image?id=' + img.body.id));
    assert.equal(preview.detailUrl, 'product.html?productId=preview%20me&preview=' + id);
    assert.equal(preview.product.name, 'PREVIEW <ME>');
    assert.equal((await call(admin, { route: 'product-preview', query: { id } })).statusCode, 401);
    // An existing picture in products/ is given as a root-relative address so a framed preview can load it.
    const legacy = await addProduct(o, 'legacy picture', sample('LEGACY', { image: 'products/Maxx Bit.png' }));
    const legacyPreview = (await o.get('product-preview', { id: legacy })).body;
    assert.ok(legacyPreview.cardHtml.includes('src="/products/Maxx Bit.png"'));
    assert.equal(legacyPreview.product.image, '/products/Maxx Bit.png');
});

test('decision flags from the import stay until someone clears them or publishes', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const id = await addProduct(o, 'flagged', sample('FLAGGED'));
    await db.query("UPDATE products SET needs_decision = true, import_notes = '[\"check me\"]' WHERE id = $1", [id]);
    assert.equal((await o.get('product', { id })).body.needsDecision, true);
    assert.equal((await o.get('products', { status: 'decision' })).body.total, 1);
    await o.post('product-decision-clear', { id });
    assert.equal((await o.get('products', { status: 'decision' })).body.total, 0);
    await db.query('UPDATE products SET needs_decision = true WHERE id = $1', [id]);
    await publishProduct(o, id);
    assert.equal((await o.get('product', { id })).body.needsDecision, false);
});

// ---- the real catalogue ---------------------------------------------------------------------------

function realImport() {
    const read = name => fs.readFileSync(name, 'utf8');
    return buildImport({
        chemical: JSON.parse(read('chemical.json')), nonchemical: JSON.parse(read('nonchemical.json')),
        listings: { chemicals: read('chemicals.html'), nonchemical: read('nonchemical.html') }
    }, { imageExists: file => fs.existsSync(file) });
}

test('the import creates drafts only, can be run again, and leaves the public site untouched', async t => {
    if (!available) return t.skip('no test database');
    const first = await saveDrafts(realImport(), db);
    assert.deepEqual(first, { created: 106, existing: 0 });
    assert.deepEqual(await saveDrafts(realImport(), db), { created: 0, existing: 106 });
    const counts = (await db.query('SELECT status, count(*)::int n FROM products GROUP BY status')).rows;
    assert.deepEqual(counts, [{ status: 'draft', n: 106 }]);
    assert.equal((await db.query('SELECT count(*)::int n FROM product_revisions')).rows[0].n, 106);
    assert.equal((await db.query('SELECT count(*)::int n FROM products WHERE needs_decision')).rows[0].n, 17);
    assert.equal((await db.query('SELECT count(*)::int n FROM products WHERE import_alternate IS NOT NULL')).rows[0].n, 1);
    assert.equal(await store.isLive(), false);
    assert.deepEqual(await store.publicCatalogue('chemical'), []);
    await setLive(true);
    assert.deepEqual((await publicList('nonchemical')).body, []);
    // A product the owner already edited is not overwritten by a re-import.
    await db.query("UPDATE products SET draft = jsonb_set(draft, '{name}', '\"EDITED\"') WHERE product_id = 'janta' AND catalogue = 'chemical'");
    await saveDrafts(realImport(), db);
    assert.equal((await db.query("SELECT draft->>'name' AS name FROM products WHERE product_id = 'janta'")).rows[0].name, 'EDITED');
});

test('publishing the imported catalogue reproduces the current grids, tabs and links', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    await saveDrafts(realImport(), db);
    for (const row of (await db.query('SELECT id FROM products')).rows) {
        const res = await o.post('product-publish', { id: row.id });
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    }
    await setLive(true);

    for (const [pageKey, file] of [['chemicals', 'chemicals.html'], ['nonchemical', 'nonchemical.html']]) {
        const original = parseListing(fs.readFileSync(file, 'utf8'), pageKey);
        const page = await listingHtml(pageKey);
        assert.equal(page.headers['x-catalogue'], 'managed');
        const generated = parseListing(page.body, pageKey);
        assert.deepEqual(generated.buttonOrder, original.buttonOrder, pageKey + ' tab buttons');

        const keyOf = card => card.page + '?' + card.productId;
        const byTab = cards => { const map = {}; for (const c of cards) (map[c.tabLabel] ||= []).push(c); return map; };
        const was = byTab(original.cards);
        const now = byTab(generated.cards);
        assert.deepEqual(Object.keys(now).sort(), Object.keys(was).sort());
        // Two products are in a category tab today but missing from "All"; the managed grid lists them there too.
        const addedToAll = pageKey === 'nonchemical' ? ['nonchemical-details.html?fasal vriddhi kit', 'nonchemical-details.html?ninja'] : [];

        const wasAll = was.All.map(keyOf);
        const nowAll = now.All.map(keyOf);
        assert.deepEqual(nowAll.filter(key => !addedToAll.includes(key)), wasAll, pageKey + ': the All grid keeps its order and members');
        assert.deepEqual(nowAll.slice(nowAll.length - addedToAll.length).sort(), [...addedToAll].sort(), 'tab-only products now also appear under All, at the end');

        for (const tab of Object.keys(was).filter(label => label !== 'All')) {
            assert.deepEqual(now[tab].map(keyOf).sort(), was[tab].map(keyOf).sort(), pageKey + ' / ' + tab + ' members');
        }
        // Every card shows the same picture and goes to the same address as before.
        const wasImages = Object.fromEntries(original.cards.map(card => [keyOf(card), card.image]));
        for (const card of generated.cards) assert.equal(card.image, wasImages[keyOf(card)], keyOf(card));
    }

    // One card has the same markup as the original (apart from line endings and spacing).
    const originalHtml = fs.readFileSync('chemicals.html', 'utf8').replace(/\r\n/g, '\n');
    const generatedHtml = (await listingHtml('chemicals')).body.replace(/\r\n/g, '\n');
    const cardOf = html => html.match(/<div class="relative background11">(?:(?!<div class="relative background11">)[\s\S])*?productId=janta"(?:(?!<div class="relative background11">)[\s\S])*?<\/h3>\s*<\/div>/)[0];
    const flat = text => text.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
    assert.equal(flat(cardOf(generatedHtml)), flat(cardOf(originalHtml)), 'the Janta card matches the original markup');

    // Search data and detail pages now come from the same published records.
    assert.equal((await publicList('chemical')).body.length, 67);
    assert.equal((await publicList('nonchemical')).body.length, 39);
    const rotomax = (await publicOne('nonchemical', 'rotomax')).body.product;
    assert.equal(rotomax.name, 'ROTOMAX');
    assert.deepEqual(rotomax.aliases, ['Rotomaxx']);
    assert.equal(rotomax.image, 'products/Rotomax.png');
});

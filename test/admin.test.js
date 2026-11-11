'use strict';

// Admin sign-in, access control, the overview and the inbox, against the local test database.
const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { db, databaseAvailable, cleanDatabase, response } = require('./helpers');
const auth = require('../lib/auth');
const inbox = require('../lib/inbox');
const admin = require('../api/admin');
const adminPage = require('../api/admin-page');
const enquiryHandler = require('../api/enquiry');

let available = false;
before(async () => { available = await databaseAvailable(); });
beforeEach(async () => {
    if (!available) return;
    await cleanDatabase();
    process.env.BREVO_API_URL = 'http://brevo.test';
    process.env.BREVO_API_KEY = 'k';
    process.env.FORM_FROM_EMAIL = 'verified@example.com';
});
after(() => db.closePool());

const PASSWORD = 'correct horse battery';
const ORIGIN = { host: 'admin.test', origin: 'http://admin.test' };

async function createUser(overrides = {}) {
    const username = overrides.username || 'owner';
    const { rows } = await db.query(
        'INSERT INTO admin_users (username, password_hash, display_name, permissions, must_change_password, active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [username, await auth.hashPassword(overrides.password || PASSWORD), overrides.displayName || 'Owner', overrides.permissions || auth.ALL_PERMISSIONS, overrides.mustChange || false, overrides.active !== false]
    );
    return { id: rows[0].id, username };
}

async function call(handler, { method = 'GET', route, query = {}, body, headers = {}, cookie, csrf, url } = {}) {
    const res = response();
    const all = { ...ORIGIN, 'content-type': 'application/json', 'user-agent': 'test', ...headers };
    if (cookie) all.cookie = cookie;
    if (csrf) all['x-csrf-token'] = csrf;
    if (method === 'GET') delete all.origin;
    await handler({ method, headers: all, query: { ...(route ? { route } : {}), ...query }, body, url: url || '/', socket: { remoteAddress: '203.0.113.9' } }, res);
    return res;
}

// Signs in through the real endpoint and returns what a browser would hold.
async function signIn(username = 'owner', password = PASSWORD) {
    const res = await call(admin, { method: 'POST', route: 'login', body: { username, password } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const cookie = res.headers['set-cookie'].split(';')[0];
    const me = await call(admin, { route: 'me', cookie });
    return { cookie, csrf: me.body.csrfToken, res };
}

async function addEnquiry(type, key, values, createdAt) {
    const { saveEnquiry } = inbox;
    const saved = await saveEnquiry({ submissionKey: key, formType: type, values, sourcePage: '/x' });
    if (createdAt) await db.query('UPDATE enquiries SET created_at = $2 WHERE id = $1', [saved.id, createdAt]);
    return saved.id;
}

const contact = (n, extra = {}) => ({ name: 'Person ' + n, email: 'p' + n + '@example.com', message: 'Hello ' + n, ...extra });
const recruit = n => ({ name: 'Applicant ' + n, contact: '9000000' + n, email: 'a' + n + '@example.com', profile: 'Sales', state: 'MP', address: 'Bhopal' });

test('passwords are stored with scrypt, never in plain text, and verify correctly', async () => {
    const hash = await auth.hashPassword(PASSWORD);
    assert.match(hash, /^scrypt\$32768\$8\$1\$/);
    assert.ok(!hash.includes(PASSWORD));
    assert.equal(await auth.verifyPassword(PASSWORD, hash), true);
    assert.equal(await auth.verifyPassword(PASSWORD + 'x', hash), false);
    assert.notEqual(hash, await auth.hashPassword(PASSWORD));
    assert.equal(await auth.verifyPassword(PASSWORD, 'garbage'), false);
    assert.ok(auth.passwordProblem('short'));
    assert.equal(auth.passwordProblem(PASSWORD, 'owner'), null);
});

test('sign-in sets a protected cookie and stores only a hash of the session token', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    const { cookie, res } = await signIn();
    assert.match(res.headers['set-cookie'], /HttpOnly/);
    assert.match(res.headers['set-cookie'], /SameSite=Strict/);
    assert.match(res.headers['set-cookie'], /Max-Age=43200/);
    const token = cookie.split('=')[1];
    const rows = (await db.query('SELECT * FROM admin_sessions')).rows;
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, token);
    assert.equal(rows[0].token_hash.length, 64);
    assert.equal(res.body.user.username, 'owner');
    assert.equal(res.body.user.password_hash, undefined);
    assert.equal(res.headers['cache-control'], 'no-store');
});

test('hosted deployments use the Secure __Host- cookie', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    process.env.VERCEL_ENV = 'production';
    try {
        const res = await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: PASSWORD } });
        assert.match(res.headers['set-cookie'], /^__Host-agross_admin=/);
        assert.match(res.headers['set-cookie'], /; Secure/);
    } finally {
        delete process.env.VERCEL_ENV;
    }
});

test('wrong password, unknown user and disabled user all get the same answer', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    await createUser({ username: 'gone', active: false });
    const answers = [];
    for (const [username, password] of [['owner', 'wrong password here'], ['nobody', PASSWORD], ['gone', PASSWORD], ['', ''], [undefined, undefined]]) {
        const res = await call(admin, { method: 'POST', route: 'login', body: { username, password } });
        assert.equal(res.statusCode, 401);
        assert.equal(res.headers['set-cookie'], undefined);
        answers.push(res.body.message);
    }
    assert.equal(new Set(answers).size, 1);
});

test('login requires a same-site JSON request', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    const crossSite = await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: PASSWORD }, headers: { origin: 'http://evil.test' } });
    assert.equal(crossSite.statusCode, 403);
    const wrongType = await call(admin, { method: 'POST', route: 'login', body: 'username=owner', headers: { 'content-type': 'text/plain' } });
    assert.equal(wrongType.statusCode, 400);
});

test('repeated failed sign-ins are throttled, even for the right password', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    for (let i = 0; i < 5; i++) {
        assert.equal((await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: 'wrong-' + i } })).statusCode, 401);
    }
    const blocked = await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: PASSWORD } });
    assert.equal(blocked.statusCode, 429);
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal(blocked.headers['set-cookie'], undefined);
    // Keys hold hashes only.
    const keys = (await db.query('SELECT key FROM rate_limits')).rows.map(row => row.key);
    assert.ok(keys.every(key => !key.includes('203.0.113.9')));
});

test('a successful sign-in clears the failure count for that user', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    for (let i = 0; i < 3; i++) await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: 'wrong-' + i } });
    await signIn();
    for (let i = 0; i < 4; i++) await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: 'wrong-' + i } });
    assert.equal((await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: PASSWORD } })).statusCode, 200);
});

test('every admin API route refuses a request with no session', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    const id = await addEnquiry('contact', 'unauth-key-0123456789', contact(1));
    const checks = [
        ['GET', 'me'], ['GET', 'overview'], ['GET', 'enquiries'], ['GET', 'enquiry', { id }],
        ['POST', 'logout'], ['POST', 'change-password'], ['POST', 'enquiry-status'], ['POST', 'enquiry-retry']
    ];
    for (const [method, route, query] of checks) {
        const res = await call(admin, { method, route, query, body: method === 'POST' ? { id, status: 'resolved' } : undefined });
        assert.equal(res.statusCode, 401, method + ' ' + route);
    }
    assert.equal((await call(admin, { route: 'nothing' })).statusCode, 404);
    assert.equal((await db.query('SELECT status FROM enquiries')).rows[0].status, 'new');
});

test('every admin page redirects to sign-in without a session and reveals nothing', async t => {
    if (!available) return t.skip('no test database');
    for (const path of ['/admin', '/admin/enquiries', '/admin/enquiries/11111111-1111-1111-1111-111111111111', '/admin/password']) {
        const res = await call(adminPage, { query: { p: path.replace(/^\/admin\/?/, '') } });
        assert.equal(res.statusCode, 302, path);
        assert.match(res.headers.location, /^\/admin\/login\?next=/);
        assert.equal(res.body, '');
        assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
    }
    const login = await call(adminPage, { query: { p: 'login' } });
    assert.equal(login.statusCode, 200);
    assert.match(login.body, /noindex/);
    assert.doesNotMatch(login.body, /enquir/i);
    assert.equal((await call(adminPage, { query: { p: 'unknown' } })).statusCode, 404);
    assert.equal((await call(adminPage, { method: 'POST', query: { p: '' } })).statusCode, 405);
    assert.match(login.headers['content-security-policy'], /default-src 'self'/);
});

test('a signed-in owner can open the pages and the API', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    const { cookie } = await signIn();
    for (const p of ['', 'enquiries', 'enquiries/11111111-1111-1111-1111-111111111111', 'password']) {
        const res = await call(adminPage, { query: { p }, cookie });
        assert.equal(res.statusCode, 200, p);
        assert.match(res.body, /<!doctype html>/i);
    }
    assert.equal((await call(adminPage, { query: { p: 'login' }, cookie })).statusCode, 302);
    assert.equal((await call(admin, { route: 'overview', cookie })).statusCode, 200);
});

test('changes need the session token and a same-site origin', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    const id = await addEnquiry('contact', 'csrf-key-0123456789ab', contact(1));
    const { cookie, csrf } = await signIn();
    const status = headers => call(admin, { method: 'POST', route: 'enquiry-status', body: { id, status: 'resolved' }, cookie, ...headers });
    assert.equal((await status({})).statusCode, 403);
    assert.equal((await status({ csrf: 'wrong' })).statusCode, 403);
    assert.equal((await status({ csrf, headers: { origin: 'http://evil.test' } })).statusCode, 403);
    assert.equal((await db.query('SELECT status FROM enquiries')).rows[0].status, 'new');
    assert.equal((await status({ csrf })).statusCode, 200);
    assert.equal((await db.query('SELECT status FROM enquiries')).rows[0].status, 'resolved');
});

test('sessions end at logout, after the idle limit and at the absolute limit', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    const first = await signIn();
    assert.equal((await call(admin, { method: 'POST', route: 'logout', body: {}, cookie: first.cookie, csrf: first.csrf })).statusCode, 200);
    assert.equal((await call(admin, { route: 'me', cookie: first.cookie })).statusCode, 401);

    const idle = await signIn();
    await db.query("UPDATE admin_sessions SET last_seen_at = now() - interval '3 hours' WHERE revoked_at IS NULL");
    assert.equal((await call(admin, { route: 'me', cookie: idle.cookie })).statusCode, 401);

    const old = await signIn();
    await db.query("UPDATE admin_sessions SET expires_at = now() - interval '1 minute' WHERE revoked_at IS NULL");
    assert.equal((await call(admin, { route: 'me', cookie: old.cookie })).statusCode, 401);

    const disabled = await signIn();
    await db.query('UPDATE admin_users SET active = false');
    assert.equal((await call(admin, { route: 'me', cookie: disabled.cookie })).statusCode, 401);
    assert.equal((await call(admin, { route: 'me', cookie: 'agross_admin=' + 'x'.repeat(500) })).statusCode, 401);
});

test('a forced password change blocks everything else until it is done', async t => {
    if (!available) return t.skip('no test database');
    await createUser({ mustChange: true });
    const other = await signIn();
    const { cookie, csrf } = await signIn();
    const blocked = await call(admin, { route: 'overview', cookie });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.body.code, 'password_change_required');
    const page = await call(adminPage, { query: { p: '' }, cookie });
    assert.equal(page.statusCode, 302);
    assert.equal(page.headers.location, '/admin/password');
    assert.equal((await call(adminPage, { query: { p: 'password' }, cookie })).statusCode, 200);

    const change = body => call(admin, { method: 'POST', route: 'change-password', body, cookie, csrf });
    assert.equal((await change({ currentPassword: 'wrong', newPassword: 'a brand new password' })).statusCode, 400);
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: 'short' })).statusCode, 400);
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: PASSWORD })).statusCode, 400);
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: 'a brand new password' })).statusCode, 200);

    assert.equal((await call(admin, { route: 'overview', cookie })).statusCode, 200);
    assert.equal((await call(admin, { route: 'me', cookie: other.cookie })).statusCode, 401, 'other sessions end');
    assert.equal((await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: PASSWORD } })).statusCode, 401);
    assert.equal((await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: 'a brand new password' } })).statusCode, 200);
});

test('the reset script gives a temporary password, forces a change and ends sessions', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    const session = await signIn();
    const run = spawnSync(process.execPath, ['scripts/admin-reset-password.js', 'OWNER'], { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const temporary = /: (\S+)\s*$/.exec(run.stdout)[1];
    assert.ok(temporary.length >= 16);
    assert.equal((await call(admin, { route: 'me', cookie: session.cookie })).statusCode, 401);
    assert.equal((await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: PASSWORD } })).statusCode, 401);
    const next = await call(admin, { method: 'POST', route: 'login', body: { username: 'owner', password: temporary } });
    assert.equal(next.statusCode, 200);
    assert.equal(next.body.user.mustChangePassword, true);
    const unknown = spawnSync(process.execPath, ['scripts/admin-reset-password.js', 'nobody'], { env: { ...process.env }, encoding: 'utf8' });
    assert.notEqual(unknown.status, 0);
    const audits = (await db.query("SELECT action FROM audit_log WHERE action = 'password_reset_by_script'")).rows;
    assert.equal(audits.length, 1);
});

test('someone without enquiry access gets nothing from the pages or the API', async t => {
    if (!available) return t.skip('no test database');
    await createUser({ username: 'limited', permissions: ['products_edit'] });
    const id = await addEnquiry('contact', 'perm-key-0123456789abc', contact(1));
    const { cookie, csrf } = await signIn('limited');
    for (const [method, route, query] of [['GET', 'overview'], ['GET', 'enquiries'], ['GET', 'enquiry', { id }], ['POST', 'enquiry-status'], ['POST', 'enquiry-retry']]) {
        const res = await call(admin, { method, route, query, body: { id, status: 'resolved' }, cookie, csrf });
        assert.equal(res.statusCode, 403, route);
    }
    assert.equal((await call(adminPage, { query: { p: '' }, cookie })).statusCode, 403);
    assert.equal((await call(adminPage, { query: { p: 'enquiries' }, cookie })).statusCode, 403);
});

test('recruitment records are hidden from everyone without recruitment access, everywhere', async t => {
    if (!available) return t.skip('no test database');
    await createUser({ username: 'staff', permissions: ['enquiries'] });
    const hiddenId = await addEnquiry('recruitment', 'recruit-key-0123456789a', recruit(1));
    await addEnquiry('contact', 'visible-key-0123456789a', contact(2));
    const { cookie, csrf } = await signIn('staff');

    const list = await call(admin, { route: 'enquiries', cookie });
    assert.equal(list.body.total, 1);
    assert.ok(list.body.items.every(item => item.formType !== 'recruitment'));
    assert.equal((await call(admin, { route: 'enquiries', query: { form: 'recruitment' }, cookie })).body.total, 0);
    assert.equal((await call(admin, { route: 'enquiries', query: { q: 'applicant' }, cookie })).body.total, 0);
    assert.equal((await call(admin, { route: 'enquiries', query: { q: 'a1@example.com' }, cookie })).body.total, 0);
    const overview = await call(admin, { route: 'overview', cookie });
    assert.equal(overview.body.total, 1);
    assert.ok(!overview.body.byForm.some(row => row.type === 'recruitment'));
    assert.equal((await call(admin, { route: 'enquiry', query: { id: hiddenId }, cookie })).statusCode, 404);
    assert.equal((await call(admin, { method: 'POST', route: 'enquiry-status', body: { id: hiddenId, status: 'resolved' }, cookie, csrf })).statusCode, 404);
    assert.equal((await call(admin, { method: 'POST', route: 'enquiry-retry', body: { id: hiddenId }, cookie, csrf })).statusCode, 404);
    assert.equal((await db.query("SELECT status FROM enquiries WHERE form_type = 'recruitment'")).rows[0].status, 'new');

    await createUser({ username: 'hr', permissions: ['enquiries', 'recruitment'] });
    const hr = await signIn('hr');
    assert.equal((await call(admin, { route: 'enquiries', cookie: hr.cookie })).body.total, 2);
    assert.equal((await call(admin, { route: 'enquiry', query: { id: hiddenId }, cookie: hr.cookie })).statusCode, 200);
});

test('overview tiles equal the inbox counts they open, using India Standard Time days', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    // 18:29 UTC is 23:59 IST on the 5th; 18:30 UTC is 00:00 IST on the 6th.
    await addEnquiry('contact', 'edge-before-0123456789', contact(1), '2026-11-05T18:29:00Z');
    await addEnquiry('contact', 'edge-after-01234567890', contact(2), '2026-11-05T18:30:00Z');
    await addEnquiry('dealership', 'edge-dealer-0123456789', { name: 'D', email: 'd@example.com', firm: 'F', mobile: '1', state: 's', district: 'd', teshil: 't', dealers: 'x', remark: 'r' }, '2026-11-06T10:00:00Z');
    await addEnquiry('recruitment', 'edge-recruit-0123456789', recruit(3), '2026-11-06T11:00:00Z');
    const later = await addEnquiry('farming', 'edge-farm-012345678901', { name: 'F', email: 'f@example.com', mobile: '1', authorised: 'a', produce: 'w', quantity: '1', address: 'x' }, '2026-11-08T05:00:00Z');
    await db.query("UPDATE enquiries SET status = 'resolved' WHERE id = $1", [later]);
    const { cookie } = await signIn();

    const fifth = await call(admin, { route: 'overview', query: { from: '2026-11-05', to: '2026-11-05' }, cookie });
    assert.equal(fifth.body.total, 1);
    const sixth = await call(admin, { route: 'overview', query: { from: '2026-11-06', to: '2026-11-06' }, cookie });
    assert.equal(sixth.body.total, 3);

    for (const [from, to] of [['2026-11-05', '2026-11-05'], ['2026-11-06', '2026-11-06'], ['2026-11-01', '2026-11-30'], ['2026-11-07', '2026-11-30']]) {
        const range = { from, to };
        const o = (await call(admin, { route: 'overview', query: range, cookie })).body;
        assert.equal((await call(admin, { route: 'enquiries', query: range, cookie })).body.total, o.total, 'total ' + from);
        assert.equal((await call(admin, { route: 'enquiries', query: { ...range, status: 'new' }, cookie })).body.total, o.new, 'new ' + from);
        for (const row of o.byForm) {
            assert.equal((await call(admin, { route: 'enquiries', query: { ...range, form: row.type }, cookie })).body.total, row.count, row.type + ' ' + from);
        }
        assert.equal(o.byForm.reduce((sum, row) => sum + row.count, 0), o.total);
    }
    const all = (await call(admin, { route: 'overview', query: { from: '2026-11-01', to: '2026-11-30' }, cookie })).body;
    assert.deepEqual(all.byForm.map(row => [row.type, row.count]), [['contact', 2], ['dealership', 1], ['farming', 1], ['recruitment', 1]]);
    assert.equal(all.total, 5);
    assert.equal(all.new, 4);
    const empty = (await call(admin, { route: 'overview', query: { from: '2026-01-01', to: '2026-01-02' }, cookie })).body;
    assert.equal(empty.total, 0);
});

test('bad filter values are rejected, not ignored', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    const { cookie } = await signIn();
    for (const query of [{ from: 'yesterday' }, { to: '2026-13-45' }, { from: '2026-11-09', to: '2026-11-01' }, { form: 'other' }, { status: 'done' }, { email: 'sent' }]) {
        assert.equal((await call(admin, { route: 'enquiries', query, cookie })).statusCode, 400, JSON.stringify(query));
    }
    assert.equal((await call(admin, { route: 'overview', query: { from: 'x' }, cookie })).statusCode, 400);
    assert.equal((await call(admin, { route: 'enquiry', query: { id: 'not-an-id' }, cookie })).statusCode, 404);
});

test('inbox filters, search and pagination work together', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    for (let i = 1; i <= 30; i++) await addEnquiry('contact', 'page-key-' + String(i).padStart(12, '0'), contact(i, { name: i === 7 ? '100% Özgür_Kumar' : 'Person ' + i }));
    const { cookie } = await signIn();
    const page1 = await call(admin, { route: 'enquiries', query: { pageSize: '10' }, cookie });
    assert.equal(page1.body.items.length, 10);
    assert.equal(page1.body.total, 30);
    const page3 = await call(admin, { route: 'enquiries', query: { pageSize: '10', page: '3' }, cookie });
    assert.equal(page3.body.items.length, 10);
    assert.notEqual(page3.body.items[0].id, page1.body.items[0].id);
    assert.equal((await call(admin, { route: 'enquiries', query: { q: 'p12@example' }, cookie })).body.total, 1);
    assert.equal((await call(admin, { route: 'enquiries', query: { q: '100%' }, cookie })).body.total, 1, 'percent is literal');
    assert.equal((await call(admin, { route: 'enquiries', query: { q: '%' }, cookie })).body.total, 1);
    assert.equal((await call(admin, { route: 'enquiries', query: { q: 'özgür_kumar' }, cookie })).body.total, 1);
    assert.equal((await call(admin, { route: 'enquiries', query: { q: "'; DROP TABLE enquiries; --" }, cookie })).body.total, 0);
    assert.equal((await call(admin, { route: 'enquiries', query: { pageSize: '5000' }, cookie })).body.pageSize, 100);
});

test('opening a record shows every submitted field in form order, and status changes record who and when', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    const id = await addEnquiry('dealership', 'detail-key-0123456789a', { name: 'Dealer', email: 'dealer@example.com', firm: 'Farm supplies', mobile: '9876543210', state: 'Maharashtra', district: 'Pune', teshil: 'Haveli', dealers: 'New Dealer', remark: 'Line one\nLine two' });
    const { cookie, csrf } = await signIn();
    const detail = (await call(admin, { route: 'enquiry', query: { id }, cookie })).body;
    assert.deepEqual(detail.fields.map(f => f.label), ['Name', 'Firm Name', 'Mobile No', 'State', 'District', 'Tehsil', 'Email', 'Dealer Type', 'Remark']);
    assert.equal(detail.fields.find(f => f.label === 'Remark').value, 'Line one\nLine two');
    assert.equal(detail.status, 'new');
    assert.equal(detail.statusChangedAt, null);

    for (const status of ['in_progress', 'resolved', 'new']) {
        assert.equal((await call(admin, { method: 'POST', route: 'enquiry-status', body: { id, status }, cookie, csrf })).statusCode, 200);
    }
    assert.equal((await call(admin, { method: 'POST', route: 'enquiry-status', body: { id, status: 'archived' }, cookie, csrf })).statusCode, 400);
    const after = (await call(admin, { route: 'enquiry', query: { id }, cookie })).body;
    assert.equal(after.status, 'new');
    assert.equal(after.statusChangedBy, 'Owner');
    assert.ok(after.statusChangedAt);
    const audit = (await db.query("SELECT metadata FROM audit_log WHERE action = 'enquiry_status_changed' ORDER BY id")).rows.map(row => row.metadata.status);
    assert.deepEqual(audit, ['in_progress', 'resolved', 'new']);
    assert.ok(!JSON.stringify((await db.query('SELECT metadata FROM audit_log')).rows).includes('Line one'), 'audit never copies enquiry text');
});

test('email state is visible and filterable, and a failed email can be retried from the dashboard', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    mock.method(console, 'error', () => {});
    mock.method(global, 'fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const res = response();
    await enquiryHandler({ method: 'POST', headers: { ...ORIGIN, 'content-type': 'application/json', accept: 'application/json' }, body: { formType: 'contact', submissionKey: 'retry-key-0123456789ab', ...contact(1) }, socket: {} }, res);
    assert.equal(res.statusCode, 200);

    const { cookie, csrf } = await signIn();
    const failed = (await call(admin, { route: 'enquiries', query: { email: 'failed' }, cookie })).body;
    assert.equal(failed.total, 1);
    assert.equal(failed.items[0].emailState, 'failed');
    assert.equal((await call(admin, { route: 'enquiries', query: { email: 'delivered' }, cookie })).body.total, 0);
    const id = failed.items[0].id;
    assert.equal((await call(admin, { route: 'enquiry', query: { id }, cookie })).body.notification.errorCode, 'http_500');

    mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ messageId: '<retry@brevo.test>' }) }));
    const retry = await call(admin, { method: 'POST', route: 'enquiry-retry', body: { id }, cookie, csrf });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.body.state, 'accepted');
    const detail = (await call(admin, { route: 'enquiry', query: { id }, cookie })).body.notification;
    assert.equal(detail.state, 'accepted');
    assert.notEqual(detail.state, 'delivered');
    assert.ok(detail.history.length >= 2);
    assert.equal((await call(admin, { method: 'POST', route: 'enquiry-retry', body: { id }, cookie, csrf })).statusCode, 409, 'cannot resend an accepted email');
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE action = 'notification_retry'")).rows[0].n, 1);
});

test('an Unconfirmed email asks for confirmation before it is retried', async t => {
    if (!available) return t.skip('no test database');
    await createUser();
    const id = await addEnquiry('contact', 'unconf-key-0123456789a', contact(1));
    await db.query("UPDATE notification_jobs SET state = 'unconfirmed', attempts = 1, last_error_code = 'timeout'");
    const send = mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ messageId: '<again@brevo.test>' }) }));
    const { cookie, csrf } = await signIn();
    const first = await call(admin, { method: 'POST', route: 'enquiry-retry', body: { id }, cookie, csrf });
    assert.equal(first.statusCode, 409);
    assert.equal(first.body.code, 'confirm_required');
    assert.equal(send.mock.callCount(), 0);
    const confirmed = await call(admin, { method: 'POST', route: 'enquiry-retry', body: { id, confirm: true }, cookie, csrf });
    assert.equal(confirmed.statusCode, 200);
    assert.equal(send.mock.callCount(), 1);
});

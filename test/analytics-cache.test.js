'use strict';

// Saved Analytics reports and the one shared refresh lease, against the local test database.
// Google is simulated. Two separately loaded copies of the admin API stand in for two Vercel instances.
const { test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { db, databaseAvailable, response } = require('./helpers');
const auth = require('../lib/auth');
const { JWT } = require('google-auth-library');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = { type: 'service_account', client_email: 'reader@agross.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const original = {
    authenticate: auth.authenticate, request: JWT.prototype.request, token: JWT.prototype.getAccessToken,
    property: process.env.GA_PROPERTY_ID, key: process.env.GA_SERVICE_ACCOUNT_JSON,
    error: console.error, warn: console.warn, info: console.info
};

let available = false;
let google; // the simulated Google: every report request is recorded and answered by `answer`
let logs;

before(async () => { available = await databaseAvailable(); });
after(async () => { await db.closePool(); });

beforeEach(async () => {
    if (!available) return;
    await db.query(`UPDATE analytics_cache SET report = NULL, fetched_at = NULL, lease_id = NULL, lease_until = NULL,
                    refreshing_days = NULL, cooldown_until = NULL, cooldown_reason = NULL`);
    process.env.GA_PROPERTY_ID = '123456789';
    process.env.GA_SERVICE_ACCOUNT_JSON = JSON.stringify(KEY);
    auth.authenticate = async () => ({ user: { id: 'owner', permissions: ['accounts'] }, csrfToken: 'x' });
    google = { calls: [], answer: () => hold() };
    JWT.prototype.getAccessToken = async () => ({ token: 'simulated' });
    JWT.prototype.request = function (options) {
        const days = Number(options.data.requests[0].dateRanges[0].startDate.replace('daysAgo', ''));
        const call = { days };
        google.calls.push(call);
        return google.answer(call);
    };
    logs = [];
    console.error = (...args) => logs.push(['error', JSON.stringify(args)]);
    console.warn = (...args) => logs.push(['warn', JSON.stringify(args)]);
    console.info = () => {};
});

afterEach(() => {
    Object.assign(auth, { authenticate: original.authenticate });
    JWT.prototype.request = original.request;
    JWT.prototype.getAccessToken = original.token;
    console.error = original.error;
    console.warn = original.warn;
    console.info = original.info;
    for (const [name, value] of [['GA_PROPERTY_ID', original.property], ['GA_SERVICE_ACCOUNT_JSON', original.key]]) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
});

// ---- helpers --------------------------------------------------------------------------------

// A fresh copy of the admin API and the analytics module: one simulated Vercel instance.
function instance() {
    for (const name of Object.keys(require.cache)) {
        if (/[\\/](lib[\\/]analytics|api[\\/]admin)\.js$/.test(name)) delete require.cache[name];
    }
    const handler = require('../api/admin');
    const analytics = require('../lib/analytics');
    return { handler, analytics };
}

async function load(copy, days) {
    const res = response();
    await copy.handler({ method: 'GET', headers: {}, query: { route: 'analytics', days: String(days) }, url: '/' }, res);
    return res;
}

// Holds Google's answer open until the test settles it.
function hold() {
    let settle;
    const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    google.calls.at(-1).settle = settle;
    return promise;
}

// A valid GA4 batch answer; `visitors` makes each report recognisable.
function gaAnswer(visitors) {
    const rows = visitors ? [{ metricValues: [visitors, visitors * 2, visitors * 3].map(value => ({ value: String(value) })) }] : [];
    return {
        data: {
            reports: [
                { rows, metadata: { timeZone: 'Asia/Kolkata' } },
                { rows: [] },
                { rows: visitors ? [{ dimensionValues: [{ value: 'google / organic' }], metricValues: [{ value: String(visitors) }] }] : [] },
                { rows: visitors ? [{ dimensionValues: [{ value: 'India' }], metricValues: [{ value: String(visitors) }] }] : [] },
                { rows: visitors ? [{ dimensionValues: [{ value: 'India' }, { value: 'Punjab' }], metricValues: [{ value: String(visitors) }] }] : [] }
            ]
        }
    };
}

function googleError(status, headers = {}) {
    return Object.assign(new Error('request failed'), { status, response: { status, headers: new Headers(headers), data: { error: { status: 'X' } } } });
}

// What gaxios throws when the report request runs past its timeout: no HTTP response at all.
function timeoutError() {
    return Object.assign(new Error('The operation was aborted.'), { code: 'TimeoutError', cause: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
}

async function until(check, label) {
    for (let i = 0; i < 400; i++) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Timed out waiting for ' + label);
}

async function shared() {
    const { rows } = await db.query(`SELECT lease_id, lease_until > now() AS lease_active, refreshing_days, cooldown_reason,
        ceil(extract(epoch FROM cooldown_until - now()))::int AS cooldown_left FROM analytics_cache WHERE range_days = 0`);
    return rows[0];
}

async function saved(days) {
    const { rows } = await db.query('SELECT report, fetched_at FROM analytics_cache WHERE range_days = $1', [days]);
    return rows[0];
}

async function seed(days, visitors, ageSeconds) {
    const report = {
        totals: { visitors, visits: visitors * 2 }, daily: [{ date: '2026-11-12', visitors, visits: visitors * 2 }],
        sources: [], countries: [], regions: [], timeZone: 'Asia/Kolkata'
    };
    await db.query('UPDATE analytics_cache SET report = $2, fetched_at = now() - make_interval(secs => $3) WHERE range_days = $1',
        [days, JSON.stringify(report), ageSeconds]);
    return (await saved(days)).fetched_at;
}

async function expireLease() {
    await db.query("UPDATE analytics_cache SET lease_until = now() - interval '1 second' WHERE range_days = 0");
}

function skip(t) {
    if (!available) { t.skip('local test database is not running'); return true; }
    return false;
}

// ---- overlap ------------------------------------------------------------------------------

test('ten overlapping requests from two instances make one Google call', async t => {
    if (skip(t)) return;
    const copies = [instance(), instance()];
    const results = [];
    let finished = 0;
    for (let i = 0; i < 10; i++) {
        const days = i % 2 ? 30 : 7;
        results.push(load(copies[i % 2], days).then(res => { finished++; return { days, res }; }));
    }
    await until(() => google.calls.length === 1 && finished === 9, 'nine requests to be turned away');
    const held = google.calls[0];
    held.settle.resolve(gaAnswer(40));
    const all = await Promise.all(results);

    assert.equal(google.calls.length, 1, 'only one request reached Google');
    const ok = all.filter(({ res }) => res.statusCode === 200);
    const waiting = all.filter(({ res }) => res.statusCode === 503);
    assert.equal(ok.length, 1);
    assert.equal(ok[0].days, held.days);
    assert.equal(waiting.length, 9);
    for (const { days, res } of waiting) {
        assert.equal(res.body.code, 'analytics_refreshing');
        assert.ok(res.body.retryAfter >= 1 && res.body.retryAfter <= 25, 'waits for the lease at most');
        assert.equal(res.headers['retry-after'], String(res.body.retryAfter));
        assert.match(res.body.message, new RegExp('Another Analytics refresh \\(last ' + held.days + ' days\\) is already running, and there is no saved report for the last ' + days + ' days yet\\.'));
    }
    assert.equal((await saved(held.days)).report.totals.visitors, 40);
    assert.equal((await shared()).lease_id, null, 'the lease is released with the save');
});

test('a request that cannot refresh shows the saved report with the countdown', async t => {
    if (skip(t)) return;
    const fetchedAt = await seed(30, 12, 600);
    const [a, b] = [instance(), instance()];
    const first = load(a, 7);
    await until(() => google.calls.length === 1, 'the first refresh');
    const res = await load(b, 30);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.stale, true);
    assert.equal(res.body.totals.visitors, 12);
    assert.equal(res.body.fetchedAt, fetchedAt.toISOString());
    assert.equal(res.body.notice.kind, 'refreshing');
    assert.match(res.body.notice.message, /^Another Analytics refresh \(last 7 days\) is already running, so this report has not been refreshed yet\.$/);
    assert.equal(res.headers['retry-after'], String(res.body.notice.retryAfter));
    google.calls[0].settle.resolve(gaAnswer(3));
    assert.equal((await first).statusCode, 200);
});

// ---- the lease guards every write -----------------------------------------------------------

test('an expired lease cannot save, start a cooldown or release after a newer claim', async t => {
    if (skip(t)) return;
    const { _lease: lease } = instance().analytics;
    const before = await seed(7, 5, 600);
    const leaseA = await lease.claimLease(7);
    assert.ok(leaseA);
    assert.equal(await lease.claimLease(30), null, 'the lease is shared by both ranges');
    await expireLease();
    const leaseB = await lease.claimLease(30);
    assert.ok(leaseB && leaseB !== leaseA);

    // A, the old refresh, finishes now: after B claimed, before B saved anything.
    assert.equal(await lease.saveReport(leaseA, 7, { totals: { visitors: 999 } }), null);
    assert.equal(await lease.startCooldown(leaseA, 60, 'timeout'), false);
    assert.equal(await lease.releaseLease(leaseA), false);

    const row = await saved(7);
    assert.equal(row.report.totals.visitors, 5, 'the saved report is unchanged');
    assert.equal(row.fetched_at.toISOString(), before.toISOString());
    const state = await shared();
    assert.equal(state.lease_id, leaseB, 'B still holds the lease');
    assert.equal(state.lease_active, true);
    assert.equal(state.refreshing_days, 30);
    assert.equal(state.cooldown_left, null, 'no cooldown was set');

    // B saves normally.
    assert.ok(await lease.saveReport(leaseB, 30, { totals: { visitors: 7 } }));
    assert.equal((await saved(30)).report.totals.visitors, 7);
    assert.equal((await shared()).lease_id, null);
});

test('an expired refresh that finishes after a newer claim, before the newer save, changes nothing', async t => {
    if (skip(t)) return;
    const before = await seed(7, 5, 600);
    const [a, b] = [instance(), instance()];

    const resultA = load(a, 7);
    await until(() => google.calls.length === 1, 'A to ask Google');
    const leaseA = (await shared()).lease_id;
    await expireLease();
    const resultB = load(b, 7);
    await until(() => google.calls.length === 2, 'B to ask Google');
    const leaseB = (await shared()).lease_id;
    assert.notEqual(leaseB, leaseA);

    google.calls[0].settle.resolve(gaAnswer(111));
    const resA = await resultA;
    assert.equal(resA.statusCode, 200, 'A still shows the genuine report it fetched');
    assert.equal(resA.body.totals.visitors, 111);
    const row = await saved(7);
    assert.equal(row.report.totals.visitors, 5, 'but A did not save it');
    assert.equal(row.fetched_at.toISOString(), before.toISOString());
    const state = await shared();
    assert.equal(state.lease_id, leaseB);
    assert.equal(state.lease_active, true);
    assert.equal(state.cooldown_left, null);
    assert.ok(logs.some(([level, text]) => level === 'warn' && /lease lost/.test(text) && /"save"/.test(text)));

    google.calls[1].settle.resolve(gaAnswer(222));
    assert.equal((await resultB).statusCode, 200);
    assert.equal((await saved(7)).report.totals.visitors, 222, 'B saves its report');
    assert.equal((await shared()).lease_id, null);
});

test('an expired refresh that times out after a newer claim sets no cooldown', async t => {
    if (skip(t)) return;
    await seed(7, 5, 600);
    const [a, b] = [instance(), instance()];
    const resultA = load(a, 7);
    await until(() => google.calls.length === 1, 'A to ask Google');
    await expireLease();
    const resultB = load(b, 7);
    await until(() => google.calls.length === 2, 'B to ask Google');
    const leaseB = (await shared()).lease_id;

    google.calls[0].settle.reject(timeoutError());
    const resA = await resultA;
    assert.equal(resA.statusCode, 200, 'A shows the saved report');
    assert.equal(resA.body.notice.kind, 'timeout');
    const state = await shared();
    assert.equal(state.lease_id, leaseB);
    assert.equal(state.cooldown_left, null, "A's cooldown was not written");
    assert.ok(logs.some(([level, text]) => level === 'warn' && /"cooldown"/.test(text)));

    google.calls[1].settle.resolve(gaAnswer(8));
    assert.equal((await resultB).statusCode, 200);
    assert.equal((await saved(7)).report.totals.visitors, 8);
});

test('an old refresh that finishes after the newer one saved cannot replace it', async t => {
    if (skip(t)) return;
    const [a, b] = [instance(), instance()];
    const resultA = load(a, 30);
    await until(() => google.calls.length === 1, 'A to ask Google');
    await expireLease();
    const resultB = load(b, 30);
    await until(() => google.calls.length === 2, 'B to ask Google');
    google.calls[1].settle.resolve(gaAnswer(222));
    await resultB;
    const savedByB = await saved(30);

    google.calls[0].settle.resolve(gaAnswer(111));
    await resultA;
    const row = await saved(30);
    assert.equal(row.report.totals.visitors, 222);
    assert.equal(row.fetched_at.toISOString(), savedByB.fetched_at.toISOString());
});

test('a lease that expires before saving writes nothing, and the next request can claim', async t => {
    if (skip(t)) return;
    const copy = instance();
    const first = load(copy, 7);
    await until(() => google.calls.length === 1, 'the first refresh');
    await expireLease();
    google.calls[0].settle.resolve(gaAnswer(9));
    await first;
    assert.equal((await saved(7)).report, null, 'nothing was saved');

    google.answer = () => Promise.resolve(gaAnswer(10));
    const next = await load(copy, 7);
    assert.equal(next.statusCode, 200);
    assert.equal(google.calls.length, 2);
    assert.equal((await saved(7)).report.totals.visitors, 10);
});

test('after claiming, a report another instance just saved is used without asking Google', async t => {
    if (skip(t)) return;
    // Another instance saves the 7-day report right after this one claims the lease.
    const realQuery = db.query;
    db.query = async (text, params) => {
        const result = await realQuery(text, params);
        if (/SET lease_id = \$1, lease_until/.test(text) && result.rowCount) {
            await realQuery("UPDATE analytics_cache SET report = '{\"totals\":{\"visitors\":77,\"visits\":80}}', fetched_at = now() WHERE range_days = 7");
        }
        return result;
    };
    let copy;
    try {
        copy = instance(); // picks up the wrapped query
    } finally {
        db.query = realQuery;
    }
    const res = await load(copy, 7);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totals.visitors, 77);
    assert.equal(res.body.stale, undefined);
    assert.equal(google.calls.length, 0, 'Google was not asked');
    assert.equal((await shared()).lease_id, null, 'the lease was released');
});

// ---- saved reports ------------------------------------------------------------------------

test('a saved report under five minutes old is shown without asking Google', async t => {
    if (skip(t)) return;
    const fetchedAt = await seed(30, 21, 120);
    const res = await load(instance(), 30);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.totals.visitors, 21);
    assert.equal(res.body.fetchedAt, fetchedAt.toISOString());
    assert.equal(res.body.stale, undefined);
    assert.equal(res.body.notice, undefined);
    assert.equal(google.calls.length, 0);
});

test('a fresh report keeps both ranges and every metric', async t => {
    if (skip(t)) return;
    google.answer = () => Promise.resolve(gaAnswer(15));
    for (const days of [7, 30]) {
        const res = await load(instance(), days);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body.totals, { visitors: 15, visits: 30, pageViews: 45 });
        assert.equal(res.body.daily.length, days);
        assert.deepEqual(res.body.sources, [{ source: 'google / organic', visits: 15 }]);
        assert.deepEqual(res.body.countries, [{ country: 'India', visitors: 15 }]);
        assert.deepEqual(res.body.regions, [{ country: 'India', region: 'Punjab', visitors: 15 }]);
        assert.equal(res.body.timeZone, 'Asia/Kolkata');
        assert.equal(res.body.fetchedAt, (await saved(days)).fetched_at.toISOString());
    }
    assert.deepEqual(google.calls.map(call => call.days), [7, 30]);
    assert.equal(await load(instance(), 400).then(res => res.statusCode), 400);
});

test('a valid report with no traffic is saved like any other', async t => {
    if (skip(t)) return;
    google.answer = () => Promise.resolve(gaAnswer(0));
    const res = await load(instance(), 7);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.totals, { visitors: 0, visits: 0, pageViews: 0 });
    assert.ok(res.body.daily.every(day => day.visitors === 0 && day.visits === 0));
    assert.deepEqual((await saved(7)).report.totals, { visitors: 0, visits: 0, pageViews: 0 });
    await load(instance(), 7);
    assert.equal(google.calls.length, 1, 'the saved empty report is reused');
});

// ---- timeouts -----------------------------------------------------------------------------

test('a timeout with nothing saved: 504, a shared 60-second cooldown, no range switching advice', async t => {
    if (skip(t)) return;
    google.answer = () => Promise.reject(timeoutError());
    const res = await load(instance(), 30);
    assert.equal(res.statusCode, 504);
    assert.equal(res.body.code, 'analytics_timeout');
    assert.equal(res.body.retryAfter, 60);
    assert.equal(res.headers['retry-after'], '60');
    assert.equal(res.body.message, 'Google Analytics did not respond in time, and there is no saved report for the last 30 days yet.');
    assert.doesNotMatch(res.body.message, /7 days|select|choose/i);
    const state = await shared();
    assert.equal(state.cooldown_reason, 'timeout');
    assert.ok(state.cooldown_left > 55 && state.cooldown_left <= 60);
    assert.equal(state.lease_id, null);
    assert.ok(logs.some(([, text]) => /Google Analytics request failed/.test(text) && /TimeoutError/.test(text)));

    // The other instance, other range: no Google call during the shared cooldown.
    const other = await load(instance(), 7);
    assert.equal(other.statusCode, 504);
    assert.equal(other.body.message, 'Google Analytics did not respond in time, and there is no saved report for the last 7 days yet.');
    assert.ok(other.body.retryAfter > 55 && other.body.retryAfter <= 60);
    assert.equal(google.calls.length, 1);
});

test('a timeout with a saved report under 24 hours old shows it with its fetch time and countdown', async t => {
    if (skip(t)) return;
    const fetchedAt = await seed(7, 33, 2 * 3600);
    google.answer = () => Promise.reject(timeoutError());
    const res = await load(instance(), 7);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.stale, true);
    assert.equal(res.body.totals.visitors, 33);
    assert.equal(res.body.fetchedAt, fetchedAt.toISOString());
    assert.deepEqual(res.body.notice, { kind: 'timeout', retryAfter: 60, message: 'Google Analytics did not respond in time, so this report could not be refreshed.' });
    assert.equal(res.headers['retry-after'], '60');

    // During the cooldown the saved report still comes with the time left.
    const again = await load(instance(), 7);
    assert.equal(again.statusCode, 200);
    assert.equal(again.body.notice.kind, 'timeout');
    assert.ok(again.body.notice.retryAfter > 55 && again.body.notice.retryAfter <= 60);
    assert.equal(google.calls.length, 1);
});

test('a saved report older than 24 hours is not shown', async t => {
    if (skip(t)) return;
    await seed(7, 33, 25 * 3600);
    google.answer = () => Promise.reject(timeoutError());
    const res = await load(instance(), 7);
    assert.equal(res.statusCode, 504);
    assert.equal(res.body.code, 'analytics_timeout');
});

// ---- rate limits --------------------------------------------------------------------------

for (const [label, header, expected] of [
    ['in seconds', () => ({ 'retry-after': '120' }), [119, 120]],
    ['as a date', () => ({ 'retry-after': new Date(Date.now() + 90 * 1000).toUTCString() }), [85, 91]],
    ['absent', () => ({}), [59, 60]]
]) {
    test('a 429 with Retry-After ' + label + ' sets the shared cooldown', async t => {
        if (skip(t)) return;
        google.answer = () => Promise.reject(googleError(429, header()));
        const res = await load(instance(), 7);
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.code, 'analytics_rate_limit');
        assert.equal(res.body.message, 'Google Analytics is limiting report requests, and there is no saved report for the last 7 days yet.');
        assert.ok(res.body.retryAfter >= expected[0] && res.body.retryAfter <= expected[1], String(res.body.retryAfter));
        assert.equal(res.headers['retry-after'], String(res.body.retryAfter));
        const state = await shared();
        assert.equal(state.cooldown_reason, 'rate_limit');
        assert.ok(state.cooldown_left >= expected[0] - 1 && state.cooldown_left <= expected[1]);

        const other = await load(instance(), 30);
        assert.equal(other.statusCode, 503);
        assert.equal(other.body.code, 'analytics_rate_limit');
        assert.equal(google.calls.length, 1, 'no Google call during the cooldown');
    });
}

test('a rate limit with a saved report shows it with the countdown', async t => {
    if (skip(t)) return;
    await seed(30, 4, 3600);
    google.answer = () => Promise.reject(googleError(429, { 'retry-after': '30' }));
    const res = await load(instance(), 30);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.notice, { kind: 'rate_limit', retryAfter: 30, message: 'Google Analytics is limiting report requests, so this report could not be refreshed.' });
});

test('another temporary Google error shows the saved report without a cooldown', async t => {
    if (skip(t)) return;
    await seed(7, 4, 3600);
    google.answer = () => Promise.reject(googleError(503));
    const res = await load(instance(), 7);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.notice, { kind: 'unavailable', message: 'Google Analytics could not refresh this report.' });
    assert.equal(res.headers['retry-after'], undefined);
    const state = await shared();
    assert.equal(state.cooldown_left, null);
    assert.equal(state.lease_id, null);
});

// ---- the page list behind the Page views tile ------------------------------------------------

async function loadPages(copy, days, windowEnd) {
    const res = response();
    await copy.handler({ method: 'GET', headers: {}, query: { route: 'analytics', view: 'pages', days: String(days), windowEnd }, url: '/' }, res);
    return res;
}

function yesterdayInIndia() {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
}

test('the page list says why it must wait, with the countdown, during a shared cooldown', async t => {
    if (skip(t)) return;
    for (const [reason, status, message] of [
        ['timeout', 504, 'Google Analytics did not respond in time, so the page list could not be loaded.'],
        ['rate_limit', 503, 'Google Analytics is limiting report requests, so the page list could not be loaded.']
    ]) {
        await db.query("UPDATE analytics_cache SET cooldown_until = now() + interval '40 seconds', cooldown_reason = $1 WHERE range_days = 0", [reason]);
        for (const days of [7, 30]) {
            const res = await loadPages(instance(), days, yesterdayInIndia());
            assert.equal(res.statusCode, status);
            assert.equal(res.body.message, message);
            assert.equal(res.body.code, 'analytics_' + reason);
            assert.ok(res.body.retryAfter > 35 && res.body.retryAfter <= 40);
            assert.equal(res.headers['retry-after'], String(res.body.retryAfter));
        }
    }
    assert.equal(google.calls.length, 0, 'no Google call during the cooldown');
});

test('the page list waits for a refresh that is already running', async t => {
    if (skip(t)) return;
    const copy = instance();
    const refresh = load(copy, 30);
    await until(() => google.calls.length === 1, 'the 30-day refresh');
    const res = await loadPages(instance(), 7, yesterdayInIndia());
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'analytics_refreshing');
    assert.equal(res.body.message, 'Another Analytics refresh (last 30 days) is already running, so the page list could not be loaded yet.');
    assert.ok(res.body.retryAfter >= 1 && res.body.retryAfter <= 25);
    google.calls[0].settle.resolve(gaAnswer(5));
    await refresh;
});

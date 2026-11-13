'use strict';

// What the owner sees when Google Analytics is set up wrongly. Uses the local test database for the
// saved-report table; the session check is replaced and Google's answers are simulated, so no network is used.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { db, databaseAvailable } = require('./helpers');
const auth = require('../lib/auth');
const { JWT } = require('google-auth-library');

auth.authenticate = async () => ({ user: { id: 'owner', permissions: ['accounts'] }, csrfToken: 'x' });
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = { type: 'service_account', client_email: 'reader@agross.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const originalRequest = JWT.prototype.request;
const originalToken = JWT.prototype.getAccessToken;
const saved = { property: process.env.GA_PROPERTY_ID, key: process.env.GA_SERVICE_ACCOUNT_JSON, error: console.error };
let logs;
let available = false;

before(async () => { available = await databaseAvailable(); });
after(async () => { await db.closePool(); });

function freshHandler() {
    for (const name of Object.keys(require.cache)) if (/[\\/](lib[\\/]analytics|api[\\/]admin)\.js$/.test(name)) delete require.cache[name];
    return require('../api/admin');
}

async function report(env, googleAnswer) {
    delete process.env.GA_PROPERTY_ID;
    delete process.env.GA_SERVICE_ACCOUNT_JSON;
    Object.assign(process.env, env);
    // Each case starts with nothing saved and no cooldown, so the answer below reaches the owner.
    await db.query(`UPDATE analytics_cache SET report = NULL, fetched_at = NULL, lease_id = NULL, lease_until = NULL,
                    refreshing_days = NULL, cooldown_until = NULL, cooldown_reason = NULL`);
    JWT.prototype.request = googleAnswer ? async () => { throw googleAnswer; } : originalRequest;
    // With a simulated answer, sign-in is simulated too; without one, the real key handling runs (no network is reached).
    JWT.prototype.getAccessToken = googleAnswer ? async () => ({ token: 'simulated' }) : originalToken;
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await freshHandler()({ method: 'GET', headers: {}, query: { route: 'analytics', days: '7' }, url: '/' }, res);
    return res;
}

function google(status, data) {
    return Object.assign(new Error('request failed'), { status, response: { status, headers: new Headers(), data } });
}

beforeEach(() => { logs = []; console.error = (...args) => logs.push(JSON.stringify(args)); });
afterEach(() => {
    console.error = saved.error;
    JWT.prototype.request = originalRequest;
    JWT.prototype.getAccessToken = originalToken;
    if (saved.property === undefined) delete process.env.GA_PROPERTY_ID; else process.env.GA_PROPERTY_ID = saved.property;
    if (saved.key === undefined) delete process.env.GA_SERVICE_ACCOUNT_JSON; else process.env.GA_SERVICE_ACCOUNT_JSON = saved.key;
});

const good = { GA_PROPERTY_ID: '123456789', GA_SERVICE_ACCOUNT_JSON: JSON.stringify(KEY) };

test('each setup mistake names the setting to fix', async t => {
    if (!available) return t.skip('local test database is not running');
    const cases = [
        [{ ...good, GA_PROPERTY_ID: 'G-ABC123' }, null, /G-… measurement ID/],
        [{ ...good, GA_PROPERTY_ID: 'properties/123456789' }, null, /only the numeric GA4 property ID/],
        [{ ...good, GA_SERVICE_ACCOUNT_JSON: '{"type": "service_account", ' }, null, /not valid JSON/],
        [{ ...good, GA_SERVICE_ACCOUNT_JSON: JSON.stringify({ web: { client_id: 'x' } }) }, null, /not a service account key/],
        [{ ...good, GA_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...KEY, private_key: KEY.private_key.replace(/\n/g, '\\n') }) }, null, /private key inside GA_SERVICE_ACCOUNT_JSON could not be read/],
        [good, google(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'x', details: [{ reason: 'SERVICE_DISABLED' }] } }), /Data API is not enabled/],
        [good, google(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Google Analytics Data API has not been used in project 1 before or it is disabled.' } }), /Data API is not enabled/],
        [good, google(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'User does not have sufficient permissions for this property.' } }), /add the service account email as a Viewer/],
        [good, google(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.' } }), /could not find the property/],
        [good, google(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), /rejected the service account key/],
        [good, google(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad' } }), /rejected the report request/]
    ];
    for (const [env, answer, expected] of cases) {
        const res = await report(env, answer);
        assert.equal(res.statusCode, 502, String(expected));
        assert.match(res.body.message, expected);
        assert.equal(res.body.code, 'analytics_setup');
        assert.ok(!JSON.stringify(res.body).includes('BEGIN PRIVATE KEY'), 'never echoes the key');
    }
});

test('logs say what went wrong without any secret', async t => {
    if (!available) return t.skip('local test database is not running');
    await report({ ...good, GA_PROPERTY_ID: 'G-ABC123' });
    assert.match(logs.join(''), /GA4_SETUP/);
    assert.match(logs.join(''), /measurement_id_as_property/);
    assert.ok(!logs.join('').includes('G-ABC123'));
    logs = [];
    await report(good, google(403, { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }));
    assert.match(logs.join(''), /SERVICE_DISABLED/);
    assert.ok(!logs.join('').includes('reader@agross'), 'no service account email in logs');
});

test('temporary problems still ask the owner to try again', async t => {
    if (!available) return t.skip('local test database is not running');
    const res = await report(good, google(503, { error: { status: 'UNAVAILABLE' } }));
    assert.equal(res.statusCode, 502);
    assert.match(res.body.message, /try again in a few minutes/);
    const missing = await report({}, null);
    assert.deepEqual(missing.body, { configured: false });
});

'use strict';

// Saving enquiries and sending notifications against a real (local, test-only) PostgreSQL database.
const { test, before, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { db, databaseAvailable, cleanDatabase, response } = require('./helpers');
const handler = require('../api/enquiry');
const webhook = require('../api/brevo-webhook');
const notify = require('../lib/notify');

let available = false;
before(async () => { available = await databaseAvailable(); if (!available) console.warn('Skipping database tests: no test database on 127.0.0.1:5433 (run npm run db:start).'); });
beforeEach(async () => {
    if (!available) return;
    await cleanDatabase();
    process.env.BREVO_API_KEY = 'test-key-not-a-real-credential';
    process.env.FORM_FROM_EMAIL = 'verified@example.com';
    process.env.BREVO_API_URL = 'http://brevo.test';
    process.env.BREVO_WEBHOOK_SECRET = 'test-webhook-secret';
});
afterEach(() => mock.restoreAll());
after(() => db.closePool());

const examples = {
    contact: { name: 'Visitor', email: 'visitor@example.com', website: 'https://example.com', phone: '9876543210', message: 'Please contact me.' },
    dealership: { name: 'Dealer', email: 'dealer@example.com', firm: 'Farm supplies', mobile: '9876543210', state: 'Maharashtra', district: 'Pune', teshil: 'Haveli', dealers: 'New Dealer', remark: 'I would like to partner.' },
    farming: { name: 'Crop buyer', email: 'buyer@example.com', mobile: '9876543210', authorised: 'Buyer Name', produce: 'Wheat', quantity: '10 tonnes', address: 'Bhopal' },
    recruitment: { name: 'Applicant', email: 'applicant@example.com', contact: '9876543210', profile: 'Sales Officer', state: 'Maharashtra', address: 'Pune' }
};
const subjects = { contact: 'Contact Us Request', dealership: 'Dealership Request', farming: 'Contract/Custom farming Request', recruitment: 'Join Us Request' };

function submission(type, key, extra = {}) {
    return {
        method: 'POST',
        headers: { host: 'www.agross.in', origin: 'https://www.agross.in', 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', referer: 'https://www.agross.in/contact.html?secret=1' },
        body: { formType: type, fax: '', submissionKey: key, ...examples[type], ...extra }
    };
}

function brevo(implementation) {
    return mock.method(global, 'fetch', implementation || (async () => ({ ok: true, json: async () => ({ messageId: '<test-id@brevo.test>' }) })));
}

async function submit(type, key, extra) {
    const res = response();
    await handler(submission(type, key, extra), res);
    return res;
}

async function job() {
    return (await db.query('SELECT * FROM notification_jobs')).rows[0];
}

for (const type of Object.keys(examples)) {
    test(type + ' form: one saved record with every field, one notification to info@agromaxx.in with the visitor as Reply-To', async t => {
        if (!available) return t.skip('no test database');
        const send = brevo();
        const res = await submit(type, 'key-' + type + '-0123456789');
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.redirect, '/thankyou.html');

        const rows = (await db.query('SELECT * FROM enquiries')).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].form_type, type);
        assert.deepEqual(rows[0].fields, examples[type]);
        assert.equal(rows[0].status, 'new');
        assert.equal(rows[0].source_page, '/contact.html'); // query string is never kept
        assert.equal(rows[0].email, examples[type].email);

        assert.equal(send.mock.callCount(), 1);
        const [url, options] = send.mock.calls[0].arguments;
        const email = JSON.parse(options.body);
        assert.equal(url, 'http://brevo.test/v3/smtp/email');
        assert.equal(options.headers['api-key'], process.env.BREVO_API_KEY);
        assert.deepEqual(email.to, [{ email: 'info@agromaxx.in' }]);
        assert.equal(email.sender.email, 'verified@example.com');
        assert.equal(email.replyTo.email, examples[type].email);
        assert.equal(email.subject, subjects[type]);
        for (const value of Object.values(examples[type])) assert.ok(email.textContent.includes(value));

        const saved = await job();
        assert.equal(saved.state, 'accepted');
        assert.equal(saved.provider_message_id, '<test-id@brevo.test>');
    });
}

test('a repeated submission with the same key creates one enquiry, one job and one email', async t => {
    if (!available) return t.skip('no test database');
    const send = brevo();
    const first = await submit('contact', 'repeat-key-0123456789');
    const second = await submit('contact', 'repeat-key-0123456789');
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal((await db.query('SELECT count(*)::int n FROM enquiries')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int n FROM notification_jobs')).rows[0].n, 1);
    assert.equal(send.mock.callCount(), 1);
});

test('simultaneous double submissions are saved once', async t => {
    if (!available) return t.skip('no test database');
    const send = brevo();
    const results = await Promise.all(Array.from({ length: 6 }, () => submit('dealership', 'double-click-0123456789')));
    assert.ok(results.every(res => res.statusCode === 200));
    assert.equal((await db.query('SELECT count(*)::int n FROM enquiries')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int n FROM notification_jobs')).rows[0].n, 1);
    assert.equal(send.mock.callCount(), 1);
});

test('different keys are different enquiries', async t => {
    if (!available) return t.skip('no test database');
    brevo();
    await submit('contact', 'first-key-0123456789ab');
    await submit('contact', 'second-key-0123456789a');
    assert.equal((await db.query('SELECT count(*)::int n FROM enquiries')).rows[0].n, 2);
});

test('email failure leaves the enquiry saved with a retryable Failed notification', async t => {
    if (!available) return t.skip('no test database');
    mock.method(console, 'error', () => {});
    brevo(async () => ({ ok: false, status: 401, json: async () => ({ message: 'private provider detail' }) }));
    const res = await submit('contact', 'failing-key-0123456789');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.redirect, '/thankyou.html');
    assert.ok(!JSON.stringify(res.body).includes('private provider detail'));
    assert.equal((await db.query('SELECT count(*)::int n FROM enquiries')).rows[0].n, 1);
    const saved = await job();
    assert.equal(saved.state, 'failed');
    assert.equal(saved.last_error_code, 'http_401');
    assert.equal(saved.provider_message_id, null);

    // Staff retry once the problem is fixed.
    brevo();
    const enquiryId = (await db.query('SELECT id FROM enquiries')).rows[0].id;
    const retried = await notify.deliver(enquiryId);
    assert.equal(retried.state, 'accepted');
    assert.equal((await job()).attempts, 2);
});

test('a timeout or unreadable answer is Unconfirmed and is not resent without confirmation', async t => {
    if (!available) return t.skip('no test database');
    for (const [implementation, code] of [
        [async () => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }); }, 'timeout'],
        [async () => ({ ok: true, json: async () => ({}) }), 'no_message_id'],
        [async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }), 'unreadable_response']
    ]) {
        await cleanDatabase();
        const send = brevo(implementation);
        const res = await submit('contact', 'unknown-key-' + code.padEnd(12, 'x'));
        assert.equal(res.statusCode, 200);
        assert.equal((await job()).state, 'unconfirmed', code);
        assert.equal((await job()).last_error_code, code);
        const enquiryId = (await db.query('SELECT id FROM enquiries')).rows[0].id;

        const blocked = await notify.deliver(enquiryId);
        assert.equal(blocked.claimed, false);
        assert.equal(send.mock.callCount(), 1);

        send.mock.restore();
        const ok = brevo();
        const confirmed = await notify.deliver(enquiryId, { acceptUnconfirmed: true });
        assert.equal(confirmed.state, 'accepted');
        assert.equal(ok.mock.callCount(), 1);
        mock.restoreAll();
    }
});

test('a network error is Failed and can be retried freely', async t => {
    if (!available) return t.skip('no test database');
    brevo(async () => { throw new TypeError('fetch failed'); });
    await submit('contact', 'network-key-0123456789');
    assert.equal((await job()).state, 'failed');
    assert.equal((await job()).last_error_code, 'network_error');
});

test('missing email configuration saves the enquiry and records why the email did not go', async t => {
    if (!available) return t.skip('no test database');
    delete process.env.BREVO_API_KEY;
    const send = brevo();
    const res = await submit('contact', 'unconfigured-0123456789');
    assert.equal(res.statusCode, 200);
    assert.equal(send.mock.callCount(), 0);
    assert.equal((await job()).state, 'failed');
    assert.equal((await job()).last_error_code, 'not_configured');
});

test('real email stays switched off on a development computer unless a mock address is given', async t => {
    if (!available) return t.skip('no test database');
    delete process.env.BREVO_API_URL;
    const send = brevo();
    await submit('contact', 'local-safety-0123456789');
    assert.equal(send.mock.callCount(), 0);
    assert.equal((await job()).last_error_code, 'real_email_disabled_locally');
});

test('when the database is unavailable the visitor gets an error and nothing is confirmed', async t => {
    if (!available) return t.skip('no test database');
    mock.method(console, 'error', () => {});
    const send = brevo();
    const good = process.env.DATABASE_URL;
    await db.closePool();
    process.env.DATABASE_URL = 'postgres://agross@127.0.0.1:1/none';
    try {
        const res = await submit('contact', 'db-down-key-0123456789');
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.redirect, undefined);
        assert.equal(send.mock.callCount(), 0);
    } finally {
        await db.closePool();
        process.env.DATABASE_URL = good;
    }
});

test('the public endpoint limits repeated submissions from one connection', async t => {
    if (!available) return t.skip('no test database');
    brevo();
    let limited = 0;
    for (let i = 0; i < 13; i++) {
        const res = await submit('contact', 'limit-key-' + String(i).padStart(12, '0'));
        if (res.statusCode === 429) limited++;
    }
    assert.equal(limited, 3);
    assert.equal((await db.query('SELECT count(*)::int n FROM enquiries')).rows[0].n, 10);
});

test('Delivered appears only when Brevo confirms delivery', async t => {
    if (!available) return t.skip('no test database');
    brevo();
    await submit('contact', 'webhook-key-0123456789');
    assert.equal((await job()).state, 'accepted');

    const call = (headers, body) => { const res = response(); return webhook({ method: 'POST', headers, body, url: '/api/brevo-webhook' }, res).then(() => res); };
    assert.equal((await call({}, { event: 'delivered', 'message-id': '<test-id@brevo.test>' })).statusCode, 401);
    assert.equal((await call({ authorization: 'Bearer wrong' }, { event: 'delivered', 'message-id': '<test-id@brevo.test>' })).statusCode, 401);
    assert.equal((await job()).state, 'accepted');

    const auth = { authorization: 'Bearer test-webhook-secret' };
    await call(auth, { event: 'request', 'message-id': '<test-id@brevo.test>' });
    assert.equal((await job()).state, 'accepted');
    await call(auth, { event: 'delivered', 'message-id': 'unknown@brevo.test' });
    assert.equal((await job()).state, 'accepted');

    const ok = await call(auth, { event: 'delivered', messageId: '<test-id@brevo.test>' });
    assert.equal(ok.statusCode, 200);
    assert.equal((await job()).state, 'delivered');
    assert.ok((await job()).delivered_at);

    delete process.env.BREVO_WEBHOOK_SECRET;
    assert.equal((await call(auth, { event: 'delivered' })).statusCode, 503);
});

test('a bounce after acceptance marks the notification Failed', async t => {
    if (!available) return t.skip('no test database');
    brevo();
    await submit('contact', 'bounce-key-0123456789a');
    const res = response();
    await webhook({ method: 'POST', headers: { authorization: 'Bearer test-webhook-secret' }, body: { event: 'hard_bounce', 'message-id': '<test-id@brevo.test>' }, url: '/' }, res);
    assert.equal((await job()).state, 'failed');
    assert.equal((await job()).last_error_code, 'hard_bounce');
});

test('a job abandoned mid-send becomes Unconfirmed instead of staying stuck', async t => {
    if (!available) return t.skip('no test database');
    brevo(async () => { throw new TypeError('x'); });
    await submit('contact', 'stuck-key-0123456789ab');
    await db.query("UPDATE notification_jobs SET state = 'sending', locked_until = now() - interval '1 minute'");
    await notify.sweepStale();
    assert.equal((await job()).state, 'unconfirmed');
});

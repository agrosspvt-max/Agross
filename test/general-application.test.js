'use strict';

// The general "send your resume" application exists only while no position is open. These go through the real public
// endpoint, as a form or a hand-made request would.
const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { db, databaseAvailable, cleanDatabase, response } = require('./helpers');
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

const PDF = Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64');
let counter = 0;

async function submit(body = {}) {
    const res = response();
    const n = ++counter;
    await enquiryHandler({
        method: 'POST', socket: { remoteAddress: '203.0.113.' + n }, query: {}, url: '/',
        headers: { host: 'site.test', origin: 'http://site.test', 'content-type': 'application/json', accept: 'application/json' },
        body: { formType: 'recruitment', name: 'Applicant ' + n, contact: '9876543210', email: 'a' + n + '@example.com', profile: 'General application',
            state: 'MP', address: 'Bhopal', submissionKey: 'general-test-' + String(n).padStart(8, '0') + '-0123', resume: { name: 'cv.pdf', content: PDF }, ...body }
    }, res);
    return res;
}

const open = (designation, isOpen = true) => db.query('INSERT INTO job_openings (designation, description, is_open) VALUES ($1, $2, $3) RETURNING id', [designation, 'Text.', isOpen]).then(r => r.rows[0].id);
const stored = () => db.query("SELECT fields->>'profile' AS profile, job_opening_id, display_name FROM enquiries ORDER BY created_at").then(r => r.rows);

function mockBrevo(t) {
    return t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ messageId: '<general@brevo.test>' }) }));
}

test('with no opening live, the general application is accepted and the role is always "General application"', async t => {
    if (!available) return t.skip('no test database');
    mockBrevo(t);
    await open('Closed Role', false);
    for (const profile of ['General application', 'Research and Development', 'A role nobody advertised']) {
        const res = await submit({ profile });
        assert.equal(res.statusCode, 200, profile);
        assert.deepEqual(res.body, { redirect: '/thankyou.html' });
    }
    const rows = await stored();
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.profile === 'General application' && row.job_opening_id === null), JSON.stringify(rows));
});

test('with even one opening live, nobody can send a general application, with the form or without it', async t => {
    if (!available) return t.skip('no test database');
    const calls = mockBrevo(t);
    const id = await open('Accounts Officer');
    await open('Closed Role', false);
    for (const profile of ['General application', 'Research and Development', undefined]) {
        const res = await submit({ profile });
        assert.ok(res.statusCode === 409 || res.statusCode === 400, String(res.statusCode));
    }
    const refused = await submit({ profile: 'General application' });
    assert.equal(refused.statusCode, 409);
    assert.match(refused.body.message, /hiring for specific positions.*Apply now/);
    assert.deepEqual(await stored(), [], 'nothing was saved');
    assert.equal(calls.mock.callCount(), 0, 'and nothing was emailed');

    // Applying to the opening itself still works, and the role comes from the opening.
    const applied = await submit({ openingId: id, profile: 'Something else' });
    assert.equal(applied.statusCode, 200);
    assert.deepEqual(await stored(), [{ profile: 'Accounts Officer', job_opening_id: id, display_name: (await stored())[0].display_name }]);
});

test('the general application comes back when the last opening closes, and a repeat of a saved one is confirmed', async t => {
    if (!available) return t.skip('no test database');
    const calls = mockBrevo(t);
    const first = { submissionKey: 'repeat-key-0123456789ab' };
    assert.equal((await submit(first)).statusCode, 200);
    const sentOnce = calls.mock.callCount();

    const id = await open('Accounts Officer');
    // The visitor's page retries the same submission after an opening went live: confirmed, not saved or emailed again.
    assert.equal((await submit(first)).statusCode, 200);
    assert.equal((await stored()).length, 1);
    assert.equal(calls.mock.callCount(), sentOnce);
    // A different application is refused while the opening is live ...
    assert.equal((await submit()).statusCode, 409);
    // ... and accepted again once it is closed.
    await db.query('UPDATE job_openings SET is_open = false WHERE id = $1', [id]);
    assert.equal((await submit()).statusCode, 200);
    assert.equal((await stored()).length, 2);
});

test('other forms are not affected, and the Form-4 page offers only the general role', async t => {
    if (!available) return t.skip('no test database');
    mockBrevo(t);
    await open('Accounts Officer');
    const res = await submit({ formType: 'contact', name: 'Visitor', email: 'v@example.com', message: 'Hello', profile: undefined, state: undefined, address: undefined, contact: undefined, resume: undefined });
    assert.equal(res.statusCode, 200);
    const page = fs.readFileSync(path.join(__dirname, '..', 'Form-4.html'), 'utf8');
    const select = /<select name="profile"[\s\S]*?<\/select>/.exec(page)[0];
    assert.deepEqual([...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1]), ['General application']);
});

test('the application form asks for the PDF resume before sending', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'Form-4.html'), 'utf8');
    const input = /<input id="recruitment-resume"[^>]*>/.exec(page)[0];
    assert.match(input, /\srequired[\s>]/);
    assert.match(input, /accept="\.pdf,application\/pdf"/);
    assert.doesNotMatch(page, /Resume \(optional\)/);
});

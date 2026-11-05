'use strict';

const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const handler = require('../api/enquiry');

const previousKey = process.env.BREVO_API_KEY;
const previousSender = process.env.FORM_FROM_EMAIL;
afterEach(() => {
    mock.restoreAll();
    if (previousKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = previousKey;
    if (previousSender === undefined) delete process.env.FORM_FROM_EMAIL;
    else process.env.FORM_FROM_EMAIL = previousSender;
});

const examples = {
    contact: { name: 'Visitor', email: 'visitor@example.com', website: 'https://example.com', phone: '9876543210', message: 'Please contact me.' },
    dealership: { name: 'Dealer', email: 'dealer@example.com', firm: 'Farm supplies', mobile: '9876543210', state: 'Maharashtra', district: 'Pune', teshil: 'Haveli', dealers: 'New Dealer', remark: 'I would like to partner.' },
    farming: { name: 'Crop buyer', email: 'buyer@example.com', mobile: '9876543210', authorised: 'Buyer Name', produce: 'Wheat', quantity: '10 tonnes', address: 'Bhopal' },
    recruitment: { name: 'Applicant', email: 'applicant@example.com', contact: '9876543210', profile: 'Sales Officer', state: 'Maharashtra', address: 'Pune' }
};
const subjects = { contact: 'Contact Us Request', dealership: 'Dealership Request', farming: 'Contract/Custom farming Request', recruitment: 'Join Us Request' };

function request(type = 'contact', overrides = {}) {
    return {
        method: 'POST',
        headers: { host: 'www.agross.in', origin: 'https://www.agross.in', 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: { formType: type, fax: '', ...examples[type] },
        ...overrides
    };
}

function response() {
    return {
        headers: {}, statusCode: 200,
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        send(body) { this.body = body; return this; },
        end() { return this; }
    };
}

function provider(implementation = async () => ({ ok: true, json: async () => ({ messageId: 'test-message-id' }) })) {
    process.env.BREVO_API_KEY = 'test-key-not-a-real-credential';
    process.env.FORM_FROM_EMAIL = 'verified@example.com';
    return mock.method(global, 'fetch', implementation);
}

for (const type of Object.keys(examples)) {
    test(type + ' delivers every field to the fixed recipient with a visitor reply-to', async () => {
        const send = provider();
        const req = request(type);
        // Client-supplied recipients and senders must never influence delivery.
        req.body.to = 'untrusted@example.com';
        req.body.sender = 'untrusted@example.com';
        const res = response();
        await handler(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.redirect, '/thankyou.html');
        assert.equal(send.mock.callCount(), 1);
        const [url, options] = send.mock.calls[0].arguments;
        const email = JSON.parse(options.body);
        assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
        assert.equal(options.headers['api-key'], process.env.BREVO_API_KEY);
        assert.deepEqual(email.to, [{ email: 'info@agromaxx.in' }]);
        assert.equal(email.sender.email, 'verified@example.com');
        assert.equal(email.replyTo.email, examples[type].email);
        assert.equal(email.subject, subjects[type]);
        assert.equal(email.htmlContent, undefined);
        for (const value of Object.values(examples[type])) assert.ok(email.textContent.includes(value));
    });
}

test('ordinary HTML form posts redirect only after successful provider acceptance', async () => {
    provider();
    const req = request();
    req.headers.accept = 'text/html';
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, '/thankyou.html');
    assert.equal(res.headers['cache-control'], 'no-store');
});

test('every required field is checked server-side', async () => {
    const send = provider();
    for (const [type, fields] of Object.entries(examples)) {
        for (const field of Object.keys(fields)) {
            if (type === 'contact' && ['website', 'phone'].includes(field)) continue;
            const req = request(type);
            req.body[field] = '  ';
            const res = response();
            await handler(req, res);
            assert.equal(res.statusCode, 400, type + ': ' + field);
        }
    }
    assert.equal(send.mock.callCount(), 0);
});

test('general enquiries can be sent without a website or phone number', async () => {
    const send = provider();
    const req = request();
    delete req.body.website;
    req.body.phone = ' ';
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(send.mock.callCount(), 1);
    const { textContent } = JSON.parse(send.mock.calls[0].arguments[1].body);
    assert.doesNotMatch(textContent, /Website:|Phone No:/);
});

test('invalid email, duplicate values, select placeholders and long fields are rejected', async () => {
    const send = provider();
    for (const fields of [
        { email: 'invalid' }, { email: 'visitor@example.com\r\nBcc: other@example.com' },
        { email: ['a@example.com', 'b@example.com'] }, { name: 'x'.repeat(121) }, { name: 'test\u0000' }
    ]) {
        const req = request(); Object.assign(req.body, fields);
        const res = response(); await handler(req, res); assert.equal(res.statusCode, 400);
    }
    const req = request('dealership'); req.body.state = 'SelectState';
    const res = response(); await handler(req, res); assert.equal(res.statusCode, 400);
    assert.equal(send.mock.callCount(), 0);
});

test('unknown or inherited form types and malformed bodies are rejected', async () => {
    const send = provider();
    for (const body of [undefined, null, [], 'name=visitor', {}, { formType: '__proto__' }, { formType: 'toString' }, { formType: ['contact'] }]) {
        const res = response(); await handler(request('contact', { body }), res); assert.equal(res.statusCode, 400);
    }
    assert.equal(send.mock.callCount(), 0);
});

test('oversized payloads and unsupported content types never reach the provider', async () => {
    const send = provider();
    const req = request(); req.body.message = 'x'.repeat(21000);
    const res = response(); await handler(req, res); assert.equal(res.statusCode, 413);
    const other = request(); other.headers['content-type'] = 'text/plain';
    const otherRes = response(); await handler(other, otherRes); assert.equal(otherRes.statusCode, 415);
    assert.equal(send.mock.callCount(), 0);
});

test('cross-site and malformed origins are rejected; same-site preview hosts work', async () => {
    const send = provider();
    for (const origin of ['https://untrusted.example', 'not-a-url']) {
        const req = request(); req.headers.origin = origin;
        const res = response(); await handler(req, res); assert.equal(res.statusCode, 403);
    }
    const crossSite = request(); delete crossSite.headers.origin; crossSite.headers['sec-fetch-site'] = 'cross-site';
    const crossRes = response(); await handler(crossSite, crossRes); assert.equal(crossRes.statusCode, 403);
    assert.equal(send.mock.callCount(), 0);
    const preview = request(); preview.headers.host = 'agross-preview.vercel.app'; preview.headers.origin = 'https://agross-preview.vercel.app';
    const res = response(); await handler(preview, res); assert.equal(res.statusCode, 200);
});

test('only POST is allowed and honeypot submissions send no mail', async () => {
    const send = provider();
    const get = response(); await handler(request('contact', { method: 'GET' }), get);
    assert.equal(get.statusCode, 405); assert.equal(get.headers.allow, 'POST');
    const req = request(); req.body.fax = 'spam';
    const res = response(); await handler(req, res); assert.equal(res.statusCode, 200);
    assert.equal(send.mock.callCount(), 0);
});

test('missing configuration fails without falsely confirming submission', async () => {
    const send = provider();
    delete process.env.BREVO_API_KEY;
    const res = response(); await handler(request(), res); assert.equal(res.statusCode, 503);
    assert.equal(send.mock.callCount(), 0); assert.equal(res.body.redirect, undefined);
});

test('provider rejection, malformed success and timeout never redirect or leak provider details', async () => {
    mock.method(console, 'error', () => {});
    for (const [implementation, status] of [
        [async () => ({ ok: false, status: 401, json: async () => ({ message: 'private provider detail' }) }), 502],
        [async () => ({ ok: true, json: async () => ({}) }), 502],
        [async () => { throw Object.assign(new Error('private provider detail'), { name: 'TimeoutError' }); }, 504],
        [async () => { throw new Error('private provider detail'); }, 502]
    ]) {
        const send = provider(implementation);
        const res = response(); await handler(request(), res);
        assert.equal(res.statusCode, status); assert.equal(res.body.redirect, undefined);
        assert.ok(!JSON.stringify(res.body).includes('private provider detail'));
        send.mock.restore();
    }
});

test('the four HTML forms use the matching handler contract and no agency endpoints', () => {
    const pages = { 'contact.html': 'contact', 'Form-2.html': 'dealership', 'Form-3.html': 'farming', 'Form-4.html': 'recruitment' };
    for (const [page, type] of Object.entries(pages)) {
        const html = fs.readFileSync(page, 'utf8');
        assert.match(html, /<form action="\/api\/enquiry" method="post" data-enquiry-form>/);
        assert.ok(html.includes('name="formType" value="' + type + '"'));
        assert.ok(!html.includes('client.digitalcube.tech'));
        assert.ok(html.includes('assets/js/forms.js'));
        assert.ok(html.includes('data-form-status'));
        for (const field of Object.keys(examples[type])) assert.ok(html.includes('name="' + field + '"'));
    }
});

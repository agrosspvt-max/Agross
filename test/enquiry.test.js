'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHandler } = require('../api/enquiry');

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

// Stand-ins for the database and email steps, so these tests cover only the form handling rules.
function setup(overrides = {}) {
    const calls = { save: [], deliver: [] };
    const handler = createHandler({
        save: async input => { calls.save.push(input); return { id: 'enquiry-' + calls.save.length, created: true }; },
        deliver: async id => { calls.deliver.push(id); return { state: 'accepted' }; },
        tooManyRequests: async () => false,
        ...overrides
    });
    return { calls, handler };
}

for (const type of Object.keys(examples)) {
    test(type + ' saves every field once and then attempts the notification', async () => {
        const { calls, handler } = setup();
        const req = request(type);
        // Client-supplied recipients and senders are never used.
        req.body.to = 'untrusted@example.com';
        req.body.sender = 'untrusted@example.com';
        const res = response();
        await handler(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.redirect, '/thankyou.html');
        assert.equal(calls.save.length, 1);
        assert.equal(calls.save[0].formType, type);
        assert.deepEqual(calls.save[0].values, examples[type]);
        assert.equal(calls.deliver.length, 1);
    });
}

test('ordinary HTML form posts redirect only after the enquiry is saved', async () => {
    const { handler } = setup();
    const req = request();
    req.headers.accept = 'text/html';
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, '/thankyou.html');
    assert.equal(res.headers['cache-control'], 'no-store');
});

test('every required field is checked server-side', async () => {
    const { calls, handler } = setup();
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
    assert.equal(calls.save.length, 0);
});

test('general enquiries can be sent without a website or phone number', async () => {
    const { calls, handler } = setup();
    const req = request();
    delete req.body.website;
    req.body.phone = ' ';
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.save.length, 1);
    assert.equal(Object.hasOwn(calls.save[0].values, 'website'), false);
    assert.equal(Object.hasOwn(calls.save[0].values, 'phone'), false);
});

test('invalid email, duplicate values, select placeholders and long fields are rejected', async () => {
    const { calls, handler } = setup();
    for (const fields of [
        { email: 'invalid' }, { email: 'visitor@example.com\r\nBcc: other@example.com' },
        { email: ['a@example.com', 'b@example.com'] }, { name: 'x'.repeat(121) }, { name: 'test\u0000' }
    ]) {
        const req = request(); Object.assign(req.body, fields);
        const res = response(); await handler(req, res); assert.equal(res.statusCode, 400);
    }
    const req = request('dealership'); req.body.state = 'SelectState';
    const res = response(); await handler(req, res); assert.equal(res.statusCode, 400);
    assert.equal(calls.save.length, 0);
});

test('unknown or inherited form types and malformed bodies are rejected', async () => {
    const { calls, handler } = setup();
    for (const body of [undefined, null, [], 'name=visitor', {}, { formType: '__proto__' }, { formType: 'toString' }, { formType: ['contact'] }]) {
        const res = response(); await handler(request('contact', { body }), res); assert.equal(res.statusCode, 400);
    }
    assert.equal(calls.save.length, 0);
});

test('oversized payloads and unsupported content types are never saved', async () => {
    const { calls, handler } = setup();
    const req = request(); req.body.message = 'x'.repeat(21000);
    const res = response(); await handler(req, res); assert.equal(res.statusCode, 413);
    const other = request(); other.headers['content-type'] = 'text/plain';
    const otherRes = response(); await handler(other, otherRes); assert.equal(otherRes.statusCode, 415);
    assert.equal(calls.save.length, 0);
});

test('cross-site and malformed origins are rejected; same-site preview hosts work', async () => {
    const { calls, handler } = setup();
    for (const origin of ['https://untrusted.example', 'not-a-url']) {
        const req = request(); req.headers.origin = origin;
        const res = response(); await handler(req, res); assert.equal(res.statusCode, 403);
    }
    const crossSite = request(); delete crossSite.headers.origin; crossSite.headers['sec-fetch-site'] = 'cross-site';
    const crossRes = response(); await handler(crossSite, crossRes); assert.equal(crossRes.statusCode, 403);
    assert.equal(calls.save.length, 0);
    const preview = request(); preview.headers.host = 'agross-preview.vercel.app'; preview.headers.origin = 'https://agross-preview.vercel.app';
    const res = response(); await handler(preview, res); assert.equal(res.statusCode, 200);
});

test('only POST is allowed and honeypot submissions are not saved', async () => {
    const { calls, handler } = setup();
    const get = response(); await handler(request('contact', { method: 'GET' }), get);
    assert.equal(get.statusCode, 405); assert.equal(get.headers.allow, 'POST');
    const req = request(); req.body.fax = 'spam';
    const res = response(); await handler(req, res); assert.equal(res.statusCode, 200);
    assert.equal(calls.save.length, 0);
    assert.equal(calls.deliver.length, 0);
});

test('a valid submission key is kept; a missing or odd one gets a server key', async () => {
    const { calls, handler } = setup();
    const keyed = request(); keyed.body.submissionKey = 'abcdef0123456789-key';
    await handler(keyed, response());
    assert.equal(calls.save[0].submissionKey, 'abcdef0123456789-key');
    for (const bad of [undefined, 'short', 'has spaces in it here', ['abcdef0123456789-key']]) {
        const req = request(); req.body.submissionKey = bad;
        await handler(req, response());
    }
    assert.ok(calls.save.slice(1).every(call => call.submissionKey.startsWith('server-')));
});

test('a repeat of an enquiry that was already saved confirms it without a second notification', async () => {
    const { calls, handler } = setup({ save: async () => ({ id: 'existing', created: false }) });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.deliver.length, 0);
});

test('when the enquiry cannot be saved the visitor is not told it was received', async () => {
    const { calls, handler } = setup({ save: async () => { throw Object.assign(new Error('private database detail'), { code: 'ECONNREFUSED' }); } });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.redirect, undefined);
    assert.ok(!JSON.stringify(res.body).includes('private database detail'));
    assert.equal(calls.deliver.length, 0);
});

test('too many submissions from one connection are refused', async () => {
    const { calls, handler } = setup({ tooManyRequests: async () => true });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 429);
    assert.equal(calls.save.length, 0);
});

test('an email problem never hides a saved enquiry from the visitor', async () => {
    const { calls, handler } = setup({ deliver: async () => { throw new Error('private provider detail'); } });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.redirect, '/thankyou.html');
    assert.equal(calls.save.length, 1);
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

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/forms.js', 'utf8');

function browser(fetch) {
    let submit;
    const status = { textContent: '', hidden: true };
    const button = { disabled: false };
    const form = {
        action: 'https://www.agross.in/api/enquiry', dataset: {}, attributes: {},
        fields: { formType: 'contact', name: 'Visitor', email: 'visitor@example.com', message: 'Keep my message' },
        querySelector: selector => selector === '[data-form-status]' ? status : button,
        addEventListener: (type, fn) => { if (type === 'submit') submit = fn; },
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this.attributes[name]; }
    };
    const navigations = [];
    const context = {
        document: { querySelectorAll: () => [form] }, fetch, URLSearchParams,
        FormData: class { constructor(form) { return new URLSearchParams(form.fields); } },
        window: { location: { assign: url => navigations.push(url) } }, TypeError, SyntaxError
    };
    vm.runInNewContext(source, context);
    return { form, status, button, navigations, submit: () => submit({ preventDefault() {} }) };
}

test('submits URL-encoded data and prevents duplicate clicks while sending', async () => {
    let resolve;
    let calls = 0;
    const view = browser(async (url, options) => {
        calls++;
        assert.equal(url, view.form.action);
        assert.equal(options.headers.Accept, 'application/json');
        assert.equal(options.body.get('message'), 'Keep my message');
        await new Promise(done => { resolve = done; });
        return { ok: true, json: async () => ({ redirect: '/thankyou.html' }) };
    });
    const pending = view.submit();
    assert.equal(view.button.disabled, true); assert.equal(view.status.hidden, false);
    await view.submit(); assert.equal(calls, 1);
    resolve(); await pending;
    assert.deepEqual(view.navigations, ['/thankyou.html']);
});

test('server failures preserve form values, show the error and allow retry', async () => {
    let fail = true;
    const view = browser(async () => ({ ok: !fail, json: async () => fail ? { message: 'Please enter a valid email address.' } : { redirect: '/thankyou.html' } }));
    await view.submit();
    assert.equal(view.form.fields.message, 'Keep my message');
    assert.equal(view.status.textContent, 'Please enter a valid email address.');
    assert.equal(view.button.disabled, false); assert.equal(view.form.attributes['aria-busy'], undefined);
    assert.deepEqual(view.navigations, []);
    fail = false; await view.submit(); assert.deepEqual(view.navigations, ['/thankyou.html']);
});

test('network and non-JSON errors show a useful fallback without redirecting', async () => {
    for (const fetch of [
        async () => { throw new TypeError('Failed to fetch'); },
        async () => ({ ok: false, json: async () => { throw new SyntaxError('Unexpected token'); } })
    ]) {
        const view = browser(fetch); await view.submit();
        assert.ok(view.status.textContent.includes('info@agromaxx.in'));
        assert.equal(view.button.disabled, false); assert.deepEqual(view.navigations, []);
    }
});

test('every attempt for one page view carries the same submission key, so a retry is saved once', async () => {
    const keys = [];
    let fail = true;
    const view = browser(async (url, options) => {
        keys.push(options.body.get('submissionKey'));
        return { ok: !fail, json: async () => fail ? { message: 'Try again.' } : { redirect: '/thankyou.html' } };
    });
    await view.submit();
    fail = false;
    await view.submit();
    assert.equal(keys.length, 2);
    assert.match(keys[0], /^[A-Za-z0-9_-]{16,64}$/);
    assert.equal(keys[0], keys[1]);
});

'use strict';

// Layout contract for the product editor (checked in a real browser too; see docs/screenshots).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const js = fs.readFileSync('admin/assets/admin.js', 'utf8');
const css = fs.readFileSync('admin/assets/admin.css', 'utf8');

test('the editor keeps the form on the left and a private page preview on the right', () => {
    assert.match(css, /\.editor-layout \{ display: grid; grid-template-columns: minmax\(0, 1\.1fr\) minmax\(0, 1fr\)/);
    assert.match(css, /@media \(max-width: 899px\) \{[\s\S]*\.editor-layout \{ grid-template-columns: 1fr; \}/, 'stacked on narrow screens');
    // form column first in the page, then the preview column
    assert.ok(js.indexOf("class: 'stack editor-form'") < js.indexOf("class: 'stack editor-preview'"));
    assert.ok(js.includes("el('h2', { text: 'Product page preview' })"));
    assert.ok(js.includes("'&preview=' + product.id") && js.includes("'&embed=1&t='"), 'the real detail page in embed mode, for the saved draft');
    assert.ok(js.includes("title: 'Product page preview'"));
});

test('the saved preview reloads after a successful save and when the editor opens', () => {
    const save = js.slice(js.indexOf('function save(thenDo)'), js.indexOf('function act('));
    assert.ok(save.includes('refreshPreviews()'));
    assert.ok(save.indexOf("if (!result.ok) { say(") < save.indexOf('refreshPreviews()'), 'a failed save returns before any refresh');
    const build = js.slice(js.indexOf('function build(record)'), js.indexOf('function buildHistory'));
    assert.ok(build.includes('refreshPreviews()'));
});

test('the embedded preview renders unsaved form values without saving or showing raw markup', () => {
    const elements = new Map();
    const doc = {
        baseURI: 'http://localhost:3000/nonchemical-details.html',
        documentElement: { dataset: { productPreview: 'product-id' } },
        getElementById(id) {
            if (id.endsWith('-heading') && id !== 'description-heading') return null;
            if (!elements.has(id)) elements.set(id, { style: {}, dataset: {} });
            return elements.get(id);
        }
    };
    const content = {
        name: 'ADBHUT', category: 'Biological', description: 'A draft description',
        technical: 'Line <br><strong>two</strong><span>example</span>',
        benefits: '<em>draft</em>', application: 'Foliar only', image_alt: 'Bottle'
    };
    const start = js.indexOf('function syncPagePreview()');
    const stop = js.indexOf("window.addEventListener('message'", start);
    const context = {
        URL, pageFrame: { contentDocument: doc }, product: { id: 'product-id', catalogue: 'nonchemical' },
        collect: () => content, TEXT_INPUTS: [['application', 'Application']],
        imageSrc: () => '/products/Adbhut.png', sizePagePreview: () => {}
    };
    vm.createContext(context);
    vm.runInContext(js.slice(start, stop), context);
    context.syncPagePreview();
    assert.equal(elements.get('product-application').textContent, 'Foliar only');
    assert.equal(elements.get('product-technical').innerHTML, 'Line <br><strong>two</strong>&lt;span&gt;example&lt;/span&gt;');
    assert.equal(elements.get('product-image').src, 'http://localhost:3000/products/Adbhut.png');
    assert.equal(elements.get('description-heading').style.display, 'block');

    content.description = '';
    content.application = 'Drenching';
    context.syncPagePreview();
    assert.equal(elements.get('product-application').textContent, 'Drenching');
    assert.equal(elements.get('description-heading').style.display, 'none');
    assert.equal(elements.get('product-description').textContent, '');

    doc.documentElement.dataset.productPreview = 'other-product';
    content.application = 'Should not appear';
    context.syncPagePreview();
    assert.equal(elements.get('product-application').textContent, 'Drenching');
    const previewButton = js.slice(js.indexOf("var preview = el('button'"), js.indexOf('actionsBox.appendChild(preview)'));
    assert.doesNotMatch(previewButton, /\bsave\s*\(/);
});

test('status, history and deleting live in one collapsed "Product management" section', () => {
    const build = js.slice(js.indexOf('function build(record)'), js.indexOf('function buildHistory'));
    assert.ok(build.includes("el('summary', { text: 'Product management' })"));
    assert.ok(js.includes("var managementOpen = false;"), 'closed by default');
    assert.ok(js.includes("el('details', { class: 'card management' })"));
    for (const part of ['statusBox', 'historyBox', 'deleteBox']) assert.ok(build.includes(part), part);
    // the old right-hand cards are gone
    assert.ok(!js.includes("var side = el('div', { class: 'stack' }"));
    assert.ok(js.includes("typed-ID") === false && js.includes('confirmProductId: confirmInput.value'), 'delete still needs the typed product ID');
    assert.ok(js.includes("'product-revision-restore'"), 'previous versions can still be loaded into the draft');
});

test('the editor actions stay reachable', () => {
    assert.match(css, /\.sticky \{ position: sticky; bottom: 0/);
    for (const label of ['Save draft', 'Preview', 'Publish', 'Archive', 'Restore']) assert.ok(js.includes("text: '" + label) || js.includes("'" + label + "'"), label);
});

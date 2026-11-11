'use strict';

// Product content rules, image checks, listing markup and the import analysis. No database needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cat = require('../lib/catalogue');
const { inspectImage } = require('../lib/images');
const { buildImport, renderReport } = require('../lib/catalogue-import');

function png(width, height) {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b, 0);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
}
function jpeg(width, height) {
    const b = Buffer.alloc(30);
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]).copy(b, 0);
    b.writeUInt16BE(height, 7);
    b.writeUInt16BE(width, 9);
    return b;
}
function webpX(width, height) {
    const b = Buffer.alloc(40);
    b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii');
    b.writeUIntLE(width - 1, 24, 3); b.writeUIntLE(height - 1, 27, 3);
    return b;
}

test('only simple formatting survives in technical details and benefits', () => {
    assert.equal(cat.sanitizeRich('Line one<br>Line two<BR/>Three'), 'Line one<br>Line two<br>Three');
    assert.equal(cat.sanitizeRich('<b>bold</b> and <em>italic</em>'), '<b>bold</b> and <em>italic</em>');
    assert.equal(cat.sanitizeRich('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(cat.sanitizeRich('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
    assert.equal(cat.sanitizeRich('<b onclick="x()">hi</b>'), '&lt;b onclick=&quot;x()&quot;&gt;hi');
    assert.equal(cat.sanitizeRich('<a href="javascript:x">link</a>'), '&lt;a href=&quot;javascript:x&quot;&gt;link&lt;/a&gt;');
    assert.equal(cat.sanitizeRich('<b>never closed'), '<b>never closed</b>');
    assert.equal(cat.sanitizeRich('stray </i> close'), 'stray  close');
    assert.equal(cat.sanitizeRich('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
    assert.equal(cat.sanitizeRich('Tom &amp; Jerry'), 'Tom &amp; Jerry');
    assert.equal(cat.sanitizeRich('<b>x<i>y</b>z'), '<b>x<i>y</i></b>z');
});

test('cleanContent trims, drops unknown fields and keeps a tab only inside its grid', () => {
    const clean = cat.cleanContent({
        name: '  Rotomax  ', category: 'Organic', evil: '<x>', listing_page: 'nonchemical', listing_tab: 'pgpr', display_order: '40',
        aliases: ['Rotomaxx', ' rotomaxx ', '', 3], image: 'products/Rotomax.png', image_alt: 'A pack'
    });
    assert.equal(clean.name, 'Rotomax');
    assert.equal(clean.evil, undefined);
    assert.equal(clean.display_order, 40);
    assert.deepEqual(clean.aliases, ['Rotomaxx']);
    assert.equal(cat.cleanContent({ name: 'x', listing_page: null, listing_tab: 'pgpr' }).listing_tab, null);
    assert.equal(cat.cleanContent({ name: 'x', listing_page: 'nowhere' }).listing_page, null);
    assert.equal(cat.cleanContent({ name: 'x', display_order: 'abc' }).display_order, null);
    assert.equal(cat.cleanContent({ name: 5, category: ['a'] }).name, '');
    // An uploaded image replaces any old path.
    const replaced = cat.cleanContent({ name: 'x', image: 'products/Old.png', image_id: '11111111-1111-1111-1111-111111111111' });
    assert.equal(cat.imageUrl(replaced), '/api/image?id=11111111-1111-1111-1111-111111111111');
});

test('validation blocks what must be fixed and only warns about the rest', () => {
    const tabs = [{ listing_page: 'chemicals', key: 'herbicide' }];
    const ok = cat.validateContent(cat.cleanContent({ name: 'A', category: 'Herbicide', listing_page: 'chemicals', listing_tab: 'herbicide', image: 'products/A.png', image_alt: 'A' }), { tabs, knownCategories: ['Herbicide'] });
    assert.deepEqual(ok.errors, {});
    const bad = cat.validateContent(cat.cleanContent({ name: '', category: '', listing_page: 'chemicals', listing_tab: 'pgpr', image: 'products/A.png' }), { tabs });
    assert.deepEqual(Object.keys(bad.errors).sort(), ['category', 'image_alt', 'listing_tab', 'name']);
    const evilPath = cat.validateContent({ ...cat.cleanContent({ name: 'A', category: 'B', image_alt: 'x' }), image: '../../etc/passwd' }, { tabs });
    assert.ok(evilPath.errors.image);
    const badId = cat.validateContent({ ...cat.cleanContent({ name: 'A', category: 'B', image_alt: 'x' }), image_id: 'nope' }, { tabs });
    assert.ok(badId.errors.image);
    const warnOnly = cat.validateContent(cat.cleanContent({ name: 'A', category: 'New thing' }), { tabs, knownCategories: ['Herbicide'] });
    assert.deepEqual(warnOnly.errors, {});
    assert.ok(warnOnly.warnings.some(text => /No image/.test(text)));
    assert.ok(warnOnly.warnings.some(text => /Not listed/.test(text)));
    assert.ok(warnOnly.warnings.some(text => /new category/.test(text)));
});

test('the public record uses the original JSON names and leaves out empty fields and internal ones', () => {
    const record = cat.toPublic('chemical', 'maxx eleven', cat.cleanContent({
        name: 'MAXX ELEVEN', category: 'Fungicide', technical: 'A<br>B', target_diseases: 'Rust', target_crops: '', dose: '250 g', packing: '1 Kg',
        image: 'products/Maxx Eleven.png', image_alt: 'Pack', aliases: ['Maxx 11'], tags: 'x'
    }));
    assert.equal(record.productId, 'maxx eleven');
    assert.equal(record.targetdiseases, 'Rust');
    assert.equal(record.image, 'products/Maxx Eleven.png');
    assert.equal(record.targetcrops, undefined);
    assert.deepEqual(record.aliases, ['Maxx 11']);
    for (const internal of ['draft', 'status', 'needs_decision', 'import_notes', 'display_order', 'listing_page', 'listing_tab', 'image_id']) {
        assert.equal(internal in record, false, internal);
    }
});

test('cards escape names, encode links and use the logo when there is no image', () => {
    const card = cat.renderCard('nonchemical', 'a & b<"x">', cat.cleanContent({ name: '<b>Bad</b> & "name"' }));
    assert.ok(card.includes('href="nonchemical-details.html?productId=a%20%26%20b%3C%22x%22%3E"'));
    assert.ok(card.includes('&lt;b&gt;Bad&lt;/b&gt; &amp; &quot;name&quot;'));
    assert.ok(!card.includes('<b>Bad'));
    assert.ok(card.includes('src="assets/agross-logo.png"'));
    const withPath = cat.renderCard('chemical', 'janta', cat.cleanContent({ name: 'JANTA', image: 'products/Janta.png' }));
    assert.ok(withPath.includes('src="products/Janta.png"'));
    assert.ok(withPath.includes('href="product.html?productId=janta"'));
});

test('a listing lists every placed product under All and again under its tab, in display order', () => {
    const tabs = [{ key: 'b', label: 'Beta', display_order: 2 }, { key: 'a', label: 'Alpha', display_order: 1 }];
    const make = (id, order, tab, page = 'chemicals') => ({ catalogue: 'chemical', productId: id, content: cat.cleanContent({ name: id.toUpperCase(), listing_page: page, listing_tab: tab, display_order: order }) });
    const html = cat.renderListing('chemicals', [make('three', 30, 'a'), make('one', 10, 'b'), make('two', 20, null), make('elsewhere', 5, null, 'nonchemical')], tabs);
    assert.ok(html.indexOf('data-tab="tab-1"') < html.indexOf('>\n                            Alpha') && html.indexOf('Alpha') < html.indexOf('Beta'), 'buttons in tab order');
    const section = id => html.slice(html.indexOf('id="' + id + '"'), html.indexOf('id="' + id + '"') + 5000);
    const hrefs = text => [...text.matchAll(/class="block">/g)].length;
    assert.equal(hrefs(html.slice(html.indexOf('id="tab-1"'), html.indexOf('id="tab-2"'))), 3, 'All holds the three placed products');
    assert.ok(html.indexOf('productId=one') < html.indexOf('productId=two') && html.indexOf('productId=two') < html.indexOf('productId=three'));
    assert.ok(!html.includes('elsewhere'));
    assert.match(section('tab-2'), /productId=three/);
    assert.match(html, /id="tab-3" class="tab-content">[\s\S]*productId=one/);
    assert.throws(() => cat.fillTemplate('<div></div>', 'x'));
    assert.equal(cat.fillTemplate('a<!-- catalogue:start -->OLD<!-- catalogue:end -->b', 'NEW').replace(/\s+/g, ''), 'a<!--catalogue:start-->NEW<!--catalogue:end-->b');
});

test('uploads are checked by content, not by name', () => {
    assert.deepEqual(inspectImage(png(300, 200)), { type: 'image/png', width: 300, height: 200 });
    assert.deepEqual(inspectImage(jpeg(640, 480)), { type: 'image/jpeg', width: 640, height: 480 });
    assert.deepEqual(inspectImage(webpX(500, 400)), { type: 'image/webp', width: 500, height: 400 });
    for (const bad of [Buffer.from('GIF89a' + 'x'.repeat(50)), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.repeat(3)), Buffer.from('not an image at all, just text'), Buffer.alloc(0), null, 'text']) {
        assert.ok(inspectImage(bad).error, String(bad).slice(0, 20));
    }
    assert.match(inspectImage(png(50, 50)).error, /too small/);
    assert.match(inspectImage(png(5000, 200)).error, /too large/);
    assert.match(inspectImage(Buffer.concat([png(300, 300), Buffer.alloc(2.1 * 1024 * 1024)])).error, /larger than 2 MB/);
});

// ---- the real import -----------------------------------------------------------------------

function realImport() {
    const read = name => fs.readFileSync(name, 'utf8');
    return buildImport({
        chemical: JSON.parse(read('chemical.json')), nonchemical: JSON.parse(read('nonchemical.json')),
        listings: { chemicals: read('chemicals.html'), nonchemical: read('nonchemical.html') }
    }, { imageExists: file => fs.existsSync(file) });
}

test('the import covers every record and reports what disagrees', () => {
    const result = realImport();
    const find = (catalogue, id) => result.products.find(p => p.catalogue === catalogue && p.productId === id);
    assert.equal(result.products.length, 67 + 39);
    assert.equal(result.sourceCounts.nonchemical.records, 40);
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].productId, 'veera');
    assert.deepEqual(result.duplicates[0].differing.sort(), ['category', 'technical', 'dose'].sort());
    assert.ok(find('nonchemical', 'veera').alternate);
    assert.equal(find('nonchemical', 'veera').content.category, 'Organic');
    assert.equal(find('nonchemical', 'veera').alternate.category, 'PGPR');

    const flagged = flag => result.products.filter(p => p.flags.has(flag)).map(p => p.catalogue + ':' + p.productId).sort();
    assert.deepEqual(flagged('unlisted'), ['chemical:maxx zyme', 'chemical:mex quin', 'chemical:tattoo', 'nonchemical:maxx grow', 'nonchemical:pretej']);
    assert.deepEqual(flagged('cross-listed'), ['chemical:mint', 'chemical:zilmil', 'nonchemical:tattoo']);
    assert.deepEqual(flagged('tab-not-in-all'), ['nonchemical:fasal vriddhi kit', 'nonchemical:ninja']);
    assert.deepEqual(flagged('missing-image'), ['chemical:mex quin']);
    assert.deepEqual(flagged('in-both-catalogues'), ['chemical:maxx zyme', 'chemical:tattoo', 'nonchemical:maxx zyme', 'nonchemical:tattoo']);
    for (const id of ['manager', 'shoot out', 'max mad', 'maxlone']) assert.ok(find('chemical', id).flags.has('label-mismatch'), id);
    assert.ok(find('nonchemical', 'potaxx dm').flags.has('label-mismatch'));
    assert.equal(find('chemical', 'mex quin').content.image, null);
    assert.equal(find('chemical', 'janta').content.image, 'products/Janta.png');
    assert.equal(find('chemical', 'janta').content.listing_page, 'chemicals');
    assert.equal(find('chemical', 'janta').needsDecision, false);
    assert.deepEqual(find('nonchemical', 'rotomax').content.aliases, ['Rotomaxx']);
    assert.equal(find('nonchemical', 'rotomax').content.listing_page, 'nonchemical');
    assert.deepEqual(result.tabOrderIssues.map(i => i.page + ':' + i.tab).sort(), ['chemicals:Insecticide', 'nonchemical:Bioinsecticide', 'nonchemical:PGPR']);
    assert.equal(result.gridIssues.length, 0);
});

test('the report names both veera records, the tab mapping and every disagreeing product', () => {
    const result = realImport();
    const report = renderReport(result, { generatedOn: 'test' });
    assert.match(report, /## 2\. The two `veera` records/);
    assert.match(report, /"Organic" \| "PGPR"/);
    assert.match(report, /## 3\. Proposed category-to-tab mapping/);
    for (const product of result.products.filter(p => p.needsDecision)) {
        assert.ok(report.includes('| ' + product.productId + ' | ' + product.catalogue + ' |'), product.productId);
    }
    assert.match(report, /Nothing has been published/);
});

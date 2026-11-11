'use strict';

// The pack-fitting script (assets/js/product-image.js) and the two detail pages that share it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/product-image.js', 'utf8');

// A fake page: one picture (natural size, with a visible pack given as fractions) and a stage.
function fit({ natural, pack, stage = { width: 330, height: 460 }, failRead = false, src = 'products/Pack.png' }) {
    const styles = {};
    const attributes = { src };
    const listeners = {};
    const image = {
        naturalWidth: natural[0], naturalHeight: natural[1], complete: true, currentSrc: src, src,
        style: new Proxy(styles, { set(target, key, value) { target[key] = value; return true; } }),
        getAttribute: name => attributes[name], setAttribute: (name, value) => { attributes[name] = value; },
        addEventListener: (type, fn) => { listeners[type] = fn; }
    };
    const stageEl = { clientWidth: stage.width, clientHeight: stage.height };
    const canvas = {
        getContext: () => ({
            drawImage() {},
            getImageData(x, y, cw, ch) {
                if (failRead) throw new Error('tainted canvas');
                const data = new Uint8ClampedArray(cw * ch * 4);
                for (let row = 0; row < ch; row++) {
                    for (let col = 0; col < cw; col++) {
                        const inside = col / cw >= pack[0] && col / cw < pack[2] && row / ch >= pack[1] && row / ch < pack[3];
                        data[(row * cw + col) * 4 + 3] = inside ? 255 : 0;
                    }
                }
                return { data };
            }
        })
    };
    const classes = new Set();
    const context = {
        document: {
            getElementById: id => (id === 'product-image' ? image : id === 'product-stage' ? stageEl : null),
            createElement: () => canvas, documentElement: { classList: { add: name => classes.add(name) } }
        },
        window: { addEventListener() {} }, Math, Array, Uint8ClampedArray, Error
    };
    vm.runInNewContext(source, context);
    const px = name => parseFloat(styles[name]);
    const width = px('width'), height = px('height');
    return { width, height, left: px('left'), top: px('top'), ready: attributes['data-fit'], classes, natural, stage, attributes };
}

// Visible pack on screen, and where its middle sits relative to the stage's middle.
function visible(result, pack) {
    const packWidth = (pack[2] - pack[0]) * result.width, packHeight = (pack[3] - pack[1]) * result.height;
    const centreX = result.left + (pack[0] + pack[2]) / 2 * result.width - result.stage.width / 2;
    const centreY = result.top + (pack[1] + pack[3]) / 2 * result.height - result.stage.height / 2;
    return { packWidth, packHeight, centreX, centreY };
}

test('a tall pack fills 80% of the stage height, is centred, and keeps its proportions', () => {
    const pack = [0, 0, 1, 1];
    const result = fit({ natural: [248, 518], pack });
    const seen = visible(result, pack);
    assert.equal(result.ready, 'ready');
    assert.ok(result.classes.has('fit-js'));
    assert.ok(Math.abs(seen.packHeight - 460 * 0.8) < 3, 'height ' + seen.packHeight);
    assert.ok(Math.abs(seen.centreX) < 1 && Math.abs(seen.centreY) < 1);
    assert.ok(Math.abs(result.width / result.height - 248 / 518) < 0.001, 'never stretched');
});

test('transparent padding does not change how big the visible pack looks', () => {
    const tight = fit({ natural: [248, 518], pack: [0, 0, 1, 1] });
    // The same pack inside a much bigger, mostly empty picture.
    const padded = fit({ natural: [900, 1600], pack: [0.28, 0.15, 0.72, 0.85] });
    const a = visible(tight, [0, 0, 1, 1]), b = visible(padded, [0.28, 0.15, 0.72, 0.85]);
    assert.ok(Math.abs(a.packHeight - b.packHeight) < 3, a.packHeight + ' vs ' + b.packHeight);
    assert.ok(Math.abs(b.centreX) < 1.5 && Math.abs(b.centreY) < 1.5, 'the pack, not the picture, is centred');
    assert.ok(Math.abs(padded.width / padded.height - 900 / 1600) < 0.001);
});

test('a huge file and a tiny file end up the same size on screen', () => {
    const pack = [0.1, 0.05, 0.9, 0.95];
    const huge = visible(fit({ natural: [6302, 9177], pack }), pack);
    const small = visible(fit({ natural: [235, 523], pack }), pack);
    const ratio = (n, m) => Math.abs(n - m) / Math.max(n, m);
    // Different proportions, but both are limited by the same stage height.
    assert.ok(huge.packHeight > 300 && small.packHeight > 300);
    assert.ok(ratio(huge.packHeight, 460 * 0.8) < 0.01);
    assert.ok(ratio(small.packHeight, 460 * 0.8) < 0.5);
});

test('a wide pack is limited by the stage width instead, and stays fully visible', () => {
    const pack = [0, 0, 1, 1];
    const result = fit({ natural: [900, 500], pack });
    const seen = visible(result, pack);
    assert.ok(Math.abs(seen.packWidth - 330 * 0.8) < 2);
    assert.ok(seen.packHeight < 460 * 0.8);
    assert.ok(result.left + 0 >= 0 && result.left + result.width <= 330 + 1, 'inside the stage');
});

test('very small pictures are not blown up beyond a fixed limit', () => {
    const pack = [0, 0, 1, 1];
    const result = fit({ natural: [60, 120], pack });
    assert.ok(result.width / 60 <= 1.8 + 1e-9, 'scale ' + result.width / 60);
});

test('the pack follows the stage when it is resized (phone width)', () => {
    const pack = [0.1, 0.1, 0.9, 0.9];
    const phone = visible(fit({ natural: [400, 800], pack, stage: { width: 226, height: 300 } }), pack);
    assert.ok(Math.abs(phone.packHeight - 300 * 0.8) < 2);
    assert.ok(phone.packWidth <= 226 * 0.8 + 1);
});

test('if the picture cannot be read the whole picture is fitted instead', () => {
    const result = fit({ natural: [248, 518], pack: [0.2, 0.2, 0.5, 0.5], failRead: true });
    const seen = visible(result, [0, 0, 1, 1]);
    assert.equal(result.ready, 'ready');
    assert.ok(Math.abs(seen.packHeight - 460 * 0.8) < 3);
    assert.ok(Math.abs(result.width / result.height - 248 / 518) < 0.001);
});

test('the placeholder picture is ignored until the real one loads', () => {
    const result = fit({ natural: [100, 100], pack: [0, 0, 1, 1], src: 'illustra/newreverseimage.svg' });
    assert.equal(result.ready, undefined);
});

test('both detail pages use the same stage, script and sizing rules', () => {
    const pages = ['product.html', 'nonchemical-details.html'].map(name => fs.readFileSync(name, 'utf8').replace(/\r\n/g, '\n'));
    const rules = html => html.match(/\/\* Product photo[\s\S]*?\.is-preview \.animate_animated \{[\s\S]*?\}\n/)[0];
    for (const html of pages) {
        assert.ok(html.includes('<div class="product-stage" id="product-stage">'));
        assert.ok(html.includes('src="assets/js/product-image.js"'));
        assert.ok(!/id="product-image"[^>]*style=/.test(html), 'no inline size on the picture');
        assert.ok(html.includes("classList.add('is-preview')"), 'embed mode for the editor preview');
    }
    assert.equal(rules(pages[0]), rules(pages[1]), 'identical sizing CSS on both pages');
    assert.match(rules(pages[0]), /height: clamp\(300px, 46vw, 460px\)/);
});

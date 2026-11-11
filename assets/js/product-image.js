/*
 * Sizes the pack photo on the product detail pages (and therefore in the admin preview).
 *
 * Files differ a lot: some are tiny, some are huge, and many have transparent padding around the pack,
 * so "same width on screen" does not look the same. This finds the visible pack inside the picture,
 * scales the whole picture so that pack fits a fixed stage at a consistent size, and centres it.
 * The picture is only scaled and moved, never stretched or cropped.
 */
(function () {
    'use strict';

    var image = document.getElementById('product-image');
    var stage = document.getElementById('product-stage');
    if (!image || !stage) { return; }

    var PLACEHOLDER = 'newreverseimage.svg';
    var FILL_WIDTH = 0.8;        // the pack may use this much of the stage width
    var FILL_HEIGHT = 0.8;       // ... and this much of its height
    var MAX_UPSCALE = 1.8;       // very small files are not blown up further than this
    var SAMPLE = 220;            // longest side, in pixels, of the copy used to find the pack
    var cache = {};
    var bounds = null;

    // The smallest box around the visible pack, as fractions (0 to 1) of the picture. Null if it cannot be read.
    function measure(el) {
        try {
            var width = el.naturalWidth, height = el.naturalHeight;
            var scale = Math.min(1, SAMPLE / Math.max(width, height));
            var cw = Math.max(1, Math.round(width * scale)), ch = Math.max(1, Math.round(height * scale));
            var canvas = document.createElement('canvas');
            canvas.width = cw; canvas.height = ch;
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(el, 0, 0, cw, ch);
            var data = ctx.getImageData(0, 0, cw, ch).data;

            var see = 0, i;
            for (i = 3; i < data.length; i += 4) { if (data[i] < 250) { see++; } }
            var hasAlpha = see > cw * ch * 0.01;

            // A picture with no transparency: treat a plain, even background colour as empty space.
            var background = null;
            if (!hasAlpha) {
                var corners = [[0, 0], [cw - 1, 0], [0, ch - 1], [cw - 1, ch - 1]].map(function (p) {
                    var o = (p[1] * cw + p[0]) * 4;
                    return [data[o], data[o + 1], data[o + 2]];
                });
                var mean = [0, 1, 2].map(function (k) { return corners.reduce(function (sum, p) { return sum + p[k]; }, 0) / 4; });
                var spread = Math.max.apply(null, corners.map(function (p) { return Math.abs(p[0] - mean[0]) + Math.abs(p[1] - mean[1]) + Math.abs(p[2] - mean[2]); }));
                if (spread < 40) { background = mean; }
            }

            var columns = new Array(cw).fill(0), rows = new Array(ch).fill(0), x, y;
            for (y = 0; y < ch; y++) {
                for (x = 0; x < cw; x++) {
                    var o = (y * cw + x) * 4;
                    var visible = data[o + 3] >= 24;
                    if (visible && background) {
                        visible = Math.abs(data[o] - background[0]) + Math.abs(data[o + 1] - background[1]) + Math.abs(data[o + 2] - background[2]) >= 36;
                    }
                    if (visible) { columns[x]++; rows[y]++; }
                }
            }
            // A line must hold a few visible pixels, so a speck of dust does not count.
            var needColumn = Math.max(1, Math.round(ch * 0.004)), needRow = Math.max(1, Math.round(cw * 0.004));
            var left = columns.findIndex(function (n) { return n >= needColumn; });
            var top = rows.findIndex(function (n) { return n >= needRow; });
            var right = cw - 1 - columns.slice().reverse().findIndex(function (n) { return n >= needColumn; });
            var bottom = ch - 1 - rows.slice().reverse().findIndex(function (n) { return n >= needRow; });
            if (left < 0 || top < 0 || right <= left || bottom <= top) { return null; }
            return { x0: left / cw, y0: top / ch, x1: (right + 1) / cw, y1: (bottom + 1) / ch };
        } catch (error) {
            return null;
        }
    }

    function place() {
        var naturalWidth = image.naturalWidth, naturalHeight = image.naturalHeight;
        var stageWidth = stage.clientWidth, stageHeight = stage.clientHeight;
        if (!naturalWidth || !naturalHeight || !stageWidth || !stageHeight) { return; }
        var box = bounds || { x0: 0, y0: 0, x1: 1, y1: 1 };
        var packWidth = (box.x1 - box.x0) * naturalWidth, packHeight = (box.y1 - box.y0) * naturalHeight;
        var factor = Math.min(stageWidth * FILL_WIDTH / packWidth, stageHeight * FILL_HEIGHT / packHeight, MAX_UPSCALE);
        var width = naturalWidth * factor, height = naturalHeight * factor;
        image.style.width = width + 'px';
        image.style.height = height + 'px';
        // Move the picture so the middle of the visible pack sits in the middle of the stage.
        image.style.left = (stageWidth / 2 - (box.x0 + box.x1) / 2 * width) + 'px';
        image.style.top = (stageHeight / 2 - (box.y0 + box.y1) / 2 * height) + 'px';
        image.setAttribute('data-pack', [box.x0, box.y0, box.x1, box.y1].map(function (n) { return n.toFixed(4); }).join(','));
        image.setAttribute('data-fit', 'ready');
    }

    function onLoad() {
        if (image.getAttribute('src').indexOf(PLACEHOLDER) !== -1) { return; }
        var key = image.currentSrc || image.src;
        if (!(key in cache)) { cache[key] = measure(image); }
        bounds = cache[key];
        place();
    }

    document.documentElement.classList.add('fit-js');
    image.addEventListener('load', onLoad);
    // A picture that cannot be loaded is replaced by the logo, once.
    image.addEventListener('error', function () {
        if (image.getAttribute('src').indexOf('agross-logo.png') === -1 && image.getAttribute('src').indexOf(PLACEHOLDER) === -1) {
            image.src = 'assets/agross-logo.png';
        }
    });
    if (window.ResizeObserver) { new ResizeObserver(place).observe(stage); } else { window.addEventListener('resize', place); }
    if (image.complete && image.naturalWidth) { onLoad(); }
}());

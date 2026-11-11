/*
 * Header product search (desktop #search-input and mobile #search-input1).
 *
 * One shared product list is built from the published catalogue (/api/catalogue), so the
 * suggestions always match what the detail pages can open:
 *   chemical     -> product.html?productId=<id>
 *   nonchemical  -> nonchemical-details.html?productId=<id>
 * Until the managed catalogue is switched on (or if it cannot be reached) the original
 * chemical.json / nonchemical.json files are used instead.
 * window.AgrossCatalogue is also used by the product detail pages.
 * Pages without the search controls are left alone.
 */
(function () {
    'use strict';

    // ---- catalogue loading (shared with the detail pages) ------------------------------------

    var STATIC_FILES = { chemical: 'chemical.json', nonchemical: 'nonchemical.json' };

    function readJson(url, options) {
        return fetch(url, options).then(function (response) {
            return response.json().catch(function () { return null; }).then(function (body) {
                return { status: response.status, ok: response.ok, body: body };
            });
        });
    }

    // Returns { records, managed }. "managed" is false when the original JSON file was used.
    function loadList(catalogue) {
        return readJson('/api/catalogue?catalogue=' + catalogue, { cache: 'no-cache' })
            .then(function (result) {
                if (result.ok && Array.isArray(result.body)) { return { records: result.body, managed: true }; }
                throw new Error('static');
            })
            .catch(function () {
                return readJson(STATIC_FILES[catalogue], { cache: 'no-cache' }).then(function (result) {
                    if (!result.ok || !Array.isArray(result.body)) { throw new Error(STATIC_FILES[catalogue] + ' ' + result.status); }
                    return { records: result.body, managed: false };
                });
            });
    }

    // Returns { state: 'ok' | 'unavailable' | 'missing' | 'preview-denied', product? }.
    function loadProduct(catalogue, productId, previewId) {
        if (previewId) {
            return readJson('/api/admin/product-preview?id=' + encodeURIComponent(previewId), { credentials: 'same-origin', cache: 'no-store' })
                .then(function (result) {
                    return result.ok && result.body && result.body.product ? { state: 'ok', product: result.body.product } : { state: 'preview-denied' };
                });
        }
        return readJson('/api/catalogue?catalogue=' + catalogue + '&productId=' + encodeURIComponent(productId), { cache: 'no-cache' })
            .then(function (result) {
                if (result.ok && result.body && result.body.product) { return { state: 'ok', product: result.body.product }; }
                if (result.status === 410) { return { state: 'unavailable' }; }
                if (result.status === 404 && result.body && result.body.state === 'missing') { return { state: 'missing' }; }
                throw new Error('static');
            })
            .catch(function () {
                return readJson(STATIC_FILES[catalogue], { cache: 'no-cache' }).then(function (result) {
                    if (!result.ok || !Array.isArray(result.body)) { throw new Error('The catalogue could not be loaded'); }
                    var product = result.body.filter(function (record) { return record.productId === productId; })[0];
                    return product ? { state: 'ok', product: product } : { state: 'missing' };
                });
            });
    }

    window.AgrossCatalogue = { loadList: loadList, loadProduct: loadProduct };

    var CATALOGUES = [
        { key: 'chemical', file: 'chemical.json', page: 'product.html', label: 'Chemical' },
        { key: 'nonchemical', file: 'nonchemical.json', page: 'nonchemical-details.html', label: 'Non-chemical' }
    ];

    var FALLBACK_IMAGE = 'assets/agross-logo.png';

    // Other spellings visitors may type, keyed by "<catalogue>:<productId>".
    // They are matched but never shown.
    var ALIASES = {
        'nonchemical:rotomax': ['Rotomaxx'],
        'chemical:taandab': ['Taanbad'],
        'chemical:cuirass': ['Curiass'],
        'chemical:camasa': ['Casama'],
        'chemical:max mad': ['Max Mad'],
        'chemical:maxlone': ['Maxlone'],
        'nonchemical:potaxx dm': ['Potaxx DM']
    };

    var MSG_LOADING = 'Loading products…';
    var MSG_ERROR = 'Product search is unavailable right now. Please try again later.';
    var MSG_PARTIAL = 'Some products could not be loaded, so these results may be incomplete.';

    // ---- matching helpers -------------------------------------------------

    // Lower-case, and treat runs of spaces, hyphens and underscores as one space.
    function normalize(text) {
        return String(text).toLowerCase().replace(/[\s\-‐-―_]+/g, ' ').trim();
    }

    function makeTerm(text) {
        var spaced = normalize(text);
        return { spaced: spaced, compact: spaced.replace(/ /g, '') };
    }

    // 0 = name starts with the query, 1 = a word starts with it, 2 = contains it, -1 = no match
    function rankTerm(term, query, queryCompact) {
        if (term.spaced.indexOf(query) === 0) { return 0; }
        if (term.spaced.indexOf(' ' + query) !== -1) { return 1; }
        if (term.spaced.indexOf(query) !== -1 || term.compact.indexOf(queryCompact) !== -1) { return 2; }
        return -1;
    }

    function rankEntry(entry, query, queryCompact) {
        var best = -1;
        for (var i = 0; i < entry.terms.length; i++) {
            var rank = rankTerm(entry.terms[i], query, queryCompact);
            if (rank !== -1 && (best === -1 || rank < best)) { best = rank; }
        }
        return best;
    }

    // ---- shared catalogue data -------------------------------------------

    var data = { state: 'idle', entries: [], failed: [], promise: null, listeners: [] };

    function buildEntries(lists) {
        var entries = [];
        CATALOGUES.forEach(function (catalogue, index) {
            var loaded = lists[index];
            if (!loaded || !Array.isArray(loaded.records)) { return; }
            var records = loaded.records;
            var seen = new Set();
            records.forEach(function (record) {
                if (!record || typeof record.productId !== 'string' || seen.has(record.productId)) { return; }
                // The detail page opens the first record with a given productId.
                seen.add(record.productId);
                var name = String(record.name || record.productId).trim();
                // Managed records carry their own aliases; the built-in list only backs the original JSON files.
                var aliases = loaded.managed ? (Array.isArray(record.aliases) ? record.aliases : []) : (ALIASES[catalogue.key + ':' + record.productId] || []);
                entries.push({
                    id: record.productId,
                    name: name,
                    catalogue: catalogue.label,
                    showCatalogue: false,
                    image: record.image || FALLBACK_IMAGE,
                    url: catalogue.page + '?productId=' + encodeURIComponent(record.productId),
                    terms: [name].concat(aliases).map(makeTerm)
                });
            });
        });
        // Label products that share a name across (or within) the catalogues.
        var counts = {};
        entries.forEach(function (entry) {
            var key = normalize(entry.name);
            counts[key] = (counts[key] || 0) + 1;
        });
        entries.forEach(function (entry) {
            entry.showCatalogue = counts[normalize(entry.name)] > 1;
        });
        return entries;
    }

    function fetchCatalogue(catalogue) {
        return loadList(catalogue.key).catch(function () { return null; });
    }

    function notify() {
        data.listeners.forEach(function (listener) { listener(); });
    }

    function loadData() {
        if (data.state === 'loading' || data.state === 'ready') { return data.promise; }
        data.state = 'loading';
        data.promise = Promise.all(CATALOGUES.map(fetchCatalogue)).then(function (lists) {
            data.failed = CATALOGUES.filter(function (catalogue, i) { return !lists[i]; })
                .map(function (catalogue) { return catalogue.key; });
            if (data.failed.length === CATALOGUES.length) {
                data.state = 'error';
            } else {
                data.entries = buildEntries(lists);
                data.state = 'ready';
            }
            notify();
        });
        return data.promise;
    }

    function search(queryText) {
        var query = normalize(queryText);
        var queryCompact = query.replace(/ /g, '');
        var matches = [];
        data.entries.forEach(function (entry, order) {
            var rank = rankEntry(entry, query, queryCompact);
            if (rank !== -1) { matches.push({ entry: entry, rank: rank, order: order }); }
        });
        matches.sort(function (a, b) { return (a.rank - b.rank) || (a.order - b.order); });
        return matches.map(function (match) { return match.entry; });
    }

    // ---- suggestion box ---------------------------------------------------

    var boxCount = 0;

    function SearchBox(input, panel, classes, moveToParent) {
        var box = this;
        box.input = input;
        box.panel = panel;
        box.classes = classes;
        box.rows = [];
        box.active = -1;
        box.isOpen = false;
        box.uid = 'product-search-' + (++boxCount);

        // The desktop panel starts inside an <a>; links must not be nested, so
        // move it next to that anchor (same positioned ancestor, same place).
        if (moveToParent) {
            var holder = input.closest('li');
            if (holder && panel.parentNode !== holder) { holder.appendChild(panel); }
        }

        box.status = document.createElement('div');
        box.status.className = classes.status;
        box.status.setAttribute('role', 'status');
        box.list = document.createElement('div');
        box.list.id = box.uid + '-list';
        box.list.setAttribute('role', 'listbox');
        box.list.setAttribute('aria-label', 'Product suggestions');
        box.note = document.createElement('div');
        box.note.className = classes.status;
        panel.textContent = '';
        panel.appendChild(box.status);
        panel.appendChild(box.list);
        panel.appendChild(box.note);
        panel.hidden = true;

        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-controls', box.list.id);
        input.setAttribute('autocomplete', 'off');

        input.addEventListener('input', function () {
            if (data.state === 'idle' || data.state === 'error') { loadData(); }
            box.render();
        });
        input.addEventListener('focus', function () {
            if (data.state === 'idle' || data.state === 'error') { loadData(); }
            box.render();
        });
        input.addEventListener('click', function () { box.render(); });
        input.addEventListener('keydown', function (event) { box.onKeydown(event); });
        input.addEventListener('focusout', function (event) {
            if (!panel.contains(event.relatedTarget)) { box.close(); }
        });

        // Keep focus in the input while the pointer scrolls or presses inside the list.
        panel.addEventListener('mousedown', function (event) { event.preventDefault(); });
        // A selection closes the list; the browser follows the link itself.
        panel.addEventListener('click', function (event) {
            if (event.target.closest('a')) { box.close(); }
        });
        document.addEventListener('pointerdown', function (event) {
            if (box.isOpen && !input.contains(event.target) && !panel.contains(event.target)) { box.close(); }
        });
        window.addEventListener('pageshow', function (event) { if (event.persisted) { box.close(); } });

        data.listeners.push(function () { if (box.isOpen) { box.render(); } });
    }

    SearchBox.prototype.open = function () {
        this.isOpen = true;
        this.panel.hidden = false;
        this.input.setAttribute('aria-expanded', 'true');
    };

    SearchBox.prototype.close = function () {
        this.isOpen = false;
        this.panel.hidden = true;
        this.setActive(-1);
        this.input.setAttribute('aria-expanded', 'false');
    };

    SearchBox.prototype.setStatus = function (text, isError) {
        this.status.textContent = text || '';
        this.status.hidden = !text;
        this.status.classList.toggle(this.classes.error, !!isError);
    };

    SearchBox.prototype.setActive = function (index) {
        if (this.active >= 0 && this.rows[this.active]) {
            this.rows[this.active].classList.remove(this.classes.active);
            this.rows[this.active].setAttribute('aria-selected', 'false');
        }
        this.active = index;
        if (index >= 0 && this.rows[index]) {
            var row = this.rows[index];
            row.classList.add(this.classes.active);
            row.setAttribute('aria-selected', 'true');
            this.input.setAttribute('aria-activedescendant', row.id);
            row.scrollIntoView({ block: 'nearest' });
        } else {
            this.active = -1;
            this.input.removeAttribute('aria-activedescendant');
        }
    };

    SearchBox.prototype.buildRow = function (entry, index) {
        var classes = this.classes;
        var row = document.createElement('a');
        row.className = classes.item;
        row.href = entry.url;
        row.id = this.uid + '-option-' + index;
        row.tabIndex = -1;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');

        var image = document.createElement('img');
        image.className = classes.icon;
        image.alt = '';
        image.addEventListener('error', function useFallback() {
            image.removeEventListener('error', useFallback);
            image.src = FALLBACK_IMAGE;
        });
        image.src = entry.image;
        row.appendChild(image);

        var name = document.createElement('span');
        name.className = classes.name;
        name.textContent = entry.name;
        row.appendChild(name);

        if (entry.showCatalogue) {
            var tag = document.createElement('span');
            tag.className = classes.tag;
            tag.textContent = entry.catalogue;
            row.appendChild(tag);
        }
        return row;
    };

    SearchBox.prototype.render = function () {
        var queryText = this.input.value.trim();
        this.list.textContent = '';
        this.rows = [];
        this.setActive(-1);
        this.note.textContent = '';
        this.note.hidden = true;

        if (!queryText) {
            this.close();
            return;
        }
        this.open();

        if (data.state === 'idle' || data.state === 'loading') {
            this.setStatus(MSG_LOADING);
            return;
        }
        if (data.state === 'error') {
            this.setStatus(MSG_ERROR, true);
            return;
        }

        var matches = search(queryText);
        if (!matches.length) {
            this.setStatus('No products found for “' + queryText + '”.');
        } else {
            this.setStatus('');
            var box = this;
            matches.forEach(function (entry, index) {
                var row = box.buildRow(entry, index);
                box.rows.push(row);
                box.list.appendChild(row);
            });
        }
        if (data.failed.length) {
            this.note.textContent = MSG_PARTIAL;
            this.note.hidden = false;
        }
    };

    SearchBox.prototype.onKeydown = function (event) {
        var count = this.rows.length;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!this.isOpen) { this.render(); count = this.rows.length; }
            if (!count) { return; }
            var step = event.key === 'ArrowDown' ? 1 : -1;
            var next = this.active === -1 ? (step === 1 ? 0 : count - 1) : (this.active + step + count) % count;
            this.setActive(next);
        } else if (event.key === 'Enter') {
            var target = this.active >= 0 ? this.rows[this.active] : (count === 1 ? this.rows[0] : null);
            if (target) {
                event.preventDefault();
                target.click();
            }
        } else if (event.key === 'Escape') {
            if (this.isOpen) {
                event.preventDefault();
                this.close();
            } else {
                this.input.blur();
            }
        }
    };

    // ---- wiring -------------------------------------------------------------

    function init() {
        var desktopInput = document.getElementById('search-input');
        var desktopPanel = document.getElementById('autocomplete');
        if (desktopInput && desktopPanel) {
            new SearchBox(desktopInput, desktopPanel, {
                item: 'autocomplete-item', icon: 'autocomplete-icon', name: 'autocomplete-name',
                tag: 'autocomplete-tag', status: 'autocomplete-status', error: 'is-error', active: 'is-active'
            }, true);
            var icon = document.getElementById('search-icon');
            if (icon) { icon.addEventListener('click', function () { desktopInput.focus(); }); }
        }

        var mobileInput = document.getElementById('search-input1');
        var mobilePanel = document.getElementById('autocomplete1');
        if (mobileInput && mobilePanel) {
            new SearchBox(mobileInput, mobilePanel, {
                item: 'autocomplete1-item', icon: 'autocomplete1-icon', name: 'autocomplete1-name',
                tag: 'autocomplete1-tag', status: 'autocomplete1-status', error: 'is-error', active: 'is-active'
            }, false);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

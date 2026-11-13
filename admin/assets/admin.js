(function () {
    'use strict';

    var TIME_ZONE = 'Asia/Kolkata';
    var FORM_TYPES = [
        ['contact', 'General Contact'], ['dealership', 'Dealership'],
        ['farming', 'Contract or Custom Farming'], ['recruitment', 'Recruitment']
    ];
    var STATUS_LABELS = { 'new': 'New', in_progress: 'In progress', resolved: 'Resolved', shortlisted: 'Shortlisted', rejected: 'Rejected' };
    var GENERAL_STATUSES = ['new', 'in_progress', 'resolved'];
    var EMAIL_LABELS = { pending: 'Pending', accepted: 'Accepted by Brevo', delivered: 'Delivered', failed: 'Failed', unconfirmed: 'Unconfirmed' };
    var ERROR_TEXT = {
        not_configured: 'Email sending is not configured.',
        real_email_disabled_locally: 'Real email is switched off on this computer.',
        network_error: 'Could not reach Brevo.',
        timeout: 'Brevo did not answer in time.',
        unreadable_response: 'Brevo answered, but the answer could not be read.',
        no_message_id: 'Brevo answered without a message ID.',
        interrupted: 'The sending process stopped before the result was known.'
    };

    var csrfToken = null;
    var currentUser = null;

    // ---- small helpers --------------------------------------------------

    function el(tag, attributes, children) {
        var node = document.createElement(tag);
        Object.keys(attributes || {}).forEach(function (key) {
            if (key === 'text') node.textContent = attributes[key];
            else if (key === 'class') node.className = attributes[key];
            else if (attributes[key] !== false && attributes[key] !== null && attributes[key] !== undefined) node.setAttribute(key, attributes[key] === true ? '' : attributes[key]);
        });
        [].concat(children || []).forEach(function (child) {
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return node;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
        return node;
    }

    var timeFormat = new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    function formatTime(value) {
        return value ? timeFormat.format(new Date(value)) + ' IST' : '';
    }

    var dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
    function today() {
        return dayFormat.format(new Date());
    }
    function addDays(day, count) {
        var date = new Date(day + 'T00:00:00Z');
        date.setUTCDate(date.getUTCDate() + count);
        return date.toISOString().slice(0, 10);
    }
    function presetRange(preset) {
        var end = today();
        if (preset === 'today') return { from: end, to: end };
        if (preset === '7') return { from: addDays(end, -6), to: end };
        if (preset === '30') return { from: addDays(end, -29), to: end };
        return null;
    }
    function presetFor(from, to) {
        var found = 'custom';
        ['today', '7', '30'].forEach(function (preset) {
            var range = presetRange(preset);
            if (range.from === from && range.to === to) found = preset;
        });
        return from || to ? found : '30';
    }

    function api(path, options) {
        options = options || {};
        var headers = { Accept: 'application/json' };
        var init = { method: options.method || 'GET', credentials: 'same-origin', headers: headers };
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(options.body);
        }
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
        return fetch('/api/admin/' + path, init).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
                if (response.status === 401 && path !== 'login') {
                    window.location.assign('/admin/login?next=' + encodeURIComponent(window.location.pathname + window.location.search));
                } else if (response.status === 403 && data.code === 'password_change_required') {
                    window.location.assign('/admin/password');
                }
                return { ok: response.ok, status: response.status, data: data };
            });
        }).catch(function () {
            return { ok: false, status: 0, data: { message: 'Could not reach the server. Check your connection and try again.' } };
        });
    }

    function badge(kind, label) {
        return el('span', { class: 'badge ' + kind, text: label });
    }

    function showError(container, message, retry) {
        clear(container);
        var box = el('div', { class: 'card' }, [el('p', { class: 'error', role: 'alert', text: message })]);
        if (retry) {
            var button = el('button', { type: 'button', text: 'Try again' });
            button.addEventListener('click', retry);
            box.appendChild(button);
        }
        container.appendChild(box);
    }

    // ---- page shell -----------------------------------------------------

    function buildShell(active) {
        var top = document.getElementById('top');
        clear(top);
        top.appendChild(el('a', { class: 'brand', href: '/admin' }, [el('img', { src: '/assets/agross-logo.png', alt: '' }), 'Agross Admin']));
        var links = [];
        if (can('enquiries')) {
            links.push(el('a', { href: '/admin', 'aria-current': active === 'overview' ? 'page' : false, text: 'Overview' }));
            links.push(el('a', { href: '/admin/enquiries', 'aria-current': active === 'inbox' || active === 'enquiry' ? 'page' : false, text: 'Enquiries' }));
        }
        if (can('products_edit')) {
            links.push(el('a', { href: '/admin/products', 'aria-current': active === 'products' || active === 'product-edit' ? 'page' : false, text: 'Products' }));
        }
        if (can('recruitment')) {
            links.push(el('a', { href: '/admin/recruiting', 'aria-current': active === 'recruiting' ? 'page' : false, text: 'Recruiting' }));
        }
        if (can('accounts')) {
            links.push(el('a', { href: '/admin/analytics', 'aria-current': active === 'analytics' ? 'page' : false, text: 'Analytics' }));
        }
        var nav = el('nav', {}, links);
        top.appendChild(nav);
        var signOut = el('button', { type: 'button', text: 'Sign out' });
        signOut.addEventListener('click', function () {
            api('logout', { method: 'POST', body: {} }).then(function () { window.location.assign('/admin/login'); });
        });
        top.appendChild(el('div', { class: 'who' }, [currentUser.displayName, signOut]));
    }

    function can(permission) {
        return Boolean(currentUser && currentUser.permissions && currentUser.permissions.indexOf(permission) !== -1);
    }

    function start(active, run) {
        api('me').then(function (result) {
            if (!result.ok) return;
            csrfToken = result.data.csrfToken;
            currentUser = result.data.user;
            buildShell(active);
            run(document.getElementById('main'));
        });
    }

    // ---- sign in and password ---------------------------------------------

    function loginPage() {
        var form = document.getElementById('login-form');
        var message = document.getElementById('login-error');
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var button = form.querySelector('button');
            button.disabled = true;
            message.hidden = true;
            api('login', { method: 'POST', body: { username: form.username.value, password: form.password.value } }).then(function (result) {
                if (result.ok) {
                    var next = new URLSearchParams(window.location.search).get('next') || '';
                    var safe = /^\/admin(\/[A-Za-z0-9\-\/]*)?$/.test(next) ? next : '/admin';
                    window.location.assign(result.data.user.mustChangePassword ? '/admin/password' : safe);
                    return;
                }
                message.textContent = result.data.message || 'Sign in failed.';
                message.hidden = false;
                form.password.value = '';
                button.disabled = false;
            });
        });
    }

    function passwordPage() {
        start('password', function (main) {
            clear(main);
            main.appendChild(el('h1', { text: 'Change password' }));
            if (currentUser.mustChangePassword) {
                main.appendChild(el('p', { class: 'note', text: 'Choose a new password before you continue.' }));
            }
            var message = el('p', { class: 'error', role: 'alert', hidden: true });
            var form = el('form', { class: 'card form narrow', novalidate: true }, [
                el('label', {}, ['Current password', el('input', { name: 'current', type: 'password', autocomplete: 'current-password', required: true })]),
                el('label', {}, ['New password (at least 12 characters)', el('input', { name: 'next', type: 'password', autocomplete: 'new-password', required: true })]),
                el('label', {}, ['Repeat new password', el('input', { name: 'again', type: 'password', autocomplete: 'new-password', required: true })]),
                message,
                el('button', { type: 'submit', class: 'primary', text: 'Save new password' })
            ]);
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                message.hidden = true;
                if (form.next.value !== form.again.value) {
                    message.textContent = 'The new passwords do not match.';
                    message.hidden = false;
                    return;
                }
                api('change-password', { method: 'POST', body: { currentPassword: form.current.value, newPassword: form.next.value } }).then(function (result) {
                    if (result.ok) {
                        window.location.assign('/admin');
                    } else {
                        message.textContent = result.data.message || 'The password could not be changed.';
                        message.hidden = false;
                    }
                });
            });
            main.appendChild(form);
        });
    }

    // ---- date filter shared by Overview and Enquiries ------------------------

    function dateFilter(from, to, onApply) {
        var preset = el('select', { name: 'preset' }, [
            el('option', { value: 'today', text: 'Today' }), el('option', { value: '7', text: 'Last 7 Days' }),
            el('option', { value: '30', text: 'Last 30 Days' }), el('option', { value: 'custom', text: 'Custom range' })
        ]);
        var fromInput = el('input', { type: 'date', name: 'from', value: from });
        var toInput = el('input', { type: 'date', name: 'to', value: to });
        preset.value = presetFor(from, to);
        function sync() {
            var custom = preset.value === 'custom';
            fromInput.disabled = !custom;
            toInput.disabled = !custom;
            if (!custom) {
                var range = presetRange(preset.value);
                fromInput.value = range.from;
                toInput.value = range.to;
            }
        }
        preset.addEventListener('change', function () { sync(); if (preset.value !== 'custom') onApply(); });
        fromInput.addEventListener('change', onApply);
        toInput.addEventListener('change', onApply);
        sync();
        return {
            nodes: [el('label', {}, ['Date', preset]), el('label', {}, ['From', fromInput]), el('label', {}, ['To', toInput])],
            value: function () { return { from: fromInput.value, to: toInput.value }; }
        };
    }

    function rangeText(from, to) {
        return from === to ? 'Showing ' + from + ' (India Standard Time).' : 'Showing ' + from + ' to ' + to + ' (India Standard Time).';
    }

    // ---- overview ------------------------------------------------------------------

    function overviewPage() {
        start('overview', function (main) {
            var params = new URLSearchParams(window.location.search);
            var range = presetRange('30');
            var from = params.get('from') || range.from;
            var to = params.get('to') || range.to;
            var results = el('div', {}, [el('p', { class: 'note', text: 'Loading…' })]);
            var note = el('p', { class: 'range-note' });
            var filter = dateFilter(from, to, load);

            clear(main);
            main.appendChild(el('h1', { text: 'Overview' }));
            main.appendChild(el('div', { class: 'filters' }, filter.nodes));
            main.appendChild(note);
            main.appendChild(results);

            function link(extra) {
                var value = filter.value();
                var query = new URLSearchParams({ from: value.from, to: value.to });
                Object.keys(extra || {}).forEach(function (key) { query.set(key, extra[key]); });
                return '/admin/enquiries?' + query.toString();
            }

            function tile(label, value, href, hint) {
                return el('a', { class: 'tile', href: href }, [
                    el('div', { class: 'label', text: label }),
                    el('div', { class: 'value', text: String(value) }),
                    el('div', { class: 'hint', text: hint })
                ]);
            }

            function load() {
                var value = filter.value();
                if (!value.from || !value.to || value.from > value.to) {
                    showError(results, 'Choose a start date that is not after the end date.');
                    return;
                }
                window.history.replaceState(null, '', '/admin?from=' + value.from + '&to=' + value.to);
                note.textContent = rangeText(value.from, value.to);
                clear(results).appendChild(el('p', { class: 'note', text: 'Loading…' }));
                api('overview?from=' + value.from + '&to=' + value.to).then(function (result) {
                    if (!result.ok) {
                        showError(results, result.data.message || 'The overview could not be loaded.', load);
                        return;
                    }
                    var data = result.data;
                    clear(results);
                    results.appendChild(el('div', { class: 'tiles' }, [
                        tile('Total submissions', data.total, link(), 'Open these in the inbox'),
                        tile('New enquiries', data.new, link({ status: 'new' }), 'Open New enquiries')
                    ]));
                    var card = el('div', { class: 'card' }, [el('h2', { text: 'Submissions by form type' })]);
                    card.appendChild(el('div', { class: 'form-tiles' }, data.byForm.map(function (row) {
                        return tile(row.title, row.count, link({ form: row.type }), 'Open ' + row.title);
                    })));
                    results.appendChild(card);
                    if (data.total === 0) results.appendChild(el('p', { class: 'note', text: 'No enquiries were saved in this period.' }));
                });
            }
            load();
        });
    }

    function analyticsPage() {
        start('analytics', function (main) {
            var days = el('select', {}, [
                el('option', { value: 'realtime', text: 'Last 30 minutes' }),
                el('option', { value: '1', text: 'Last 1 day' }),
                el('option', { value: '7', text: 'Last 7 days' }),
                el('option', { value: '30', text: 'Last 30 days' })
            ]);
            var results = el('div', { class: 'stack' });
            var latestLoad = 0;
            var countdown = null;
            var numbers = new Intl.NumberFormat('en-IN');
            var dates = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
            clear(main);
            main.appendChild(el('h1', { text: 'Analytics' }));
            main.appendChild(el('div', { class: 'filters' }, [el('label', {}, ['Date range', days])]));
            main.appendChild(results);
            days.addEventListener('change', load);
            load();

            function tile(label, count, hint) {
                return el('div', { class: 'tile' }, [
                    el('div', { class: 'label', text: label }),
                    el('div', { class: 'value', text: numbers.format(count) }),
                    el('div', { class: 'note', text: hint })
                ]);
            }

            function table(title, headings, rows) {
                var card = el('section', { class: 'card' }, [el('h2', { text: title })]);
                if (!rows.length) {
                    card.appendChild(el('p', { class: 'note', text: 'No data for this date range.' }));
                    return card;
                }
                var head = el('tr', {}, headings.map(function (label) {
                    return el('th', { scope: 'col', text: label });
                }));
                var body = rows.map(function (row) {
                    return el('tr', {}, row.map(function (value, i) {
                        return el('td', { 'data-label': headings[i], text: value });
                    }));
                });
                card.appendChild(el('table', { 'aria-label': title }, [el('thead', {}, [head]), el('tbody', {}, body)]));
                return card;
            }

            function locationName(name) {
                return !name || name === '(not set)' ? 'Unknown' : name;
            }

            function render(data, range) {
                clear(results);
                if (!data.configured) {
                    results.appendChild(el('div', { class: 'card' }, [
                        el('p', { class: 'note', text: 'Google Analytics setup is pending. Connect the Agross GA4 property to view reports.' })
                    ]));
                    return;
                }
                var realtime = range === 'realtime';
                var lastDay = range === '1';
                var shortRange = realtime || lastDay;
                var tiles = shortRange ? [
                    tile('Active users', data.totals.activeUsers, 'Distinct active users measured by GA4'),
                    tile('Page views', data.totals.pageViews, 'Includes repeat page views')
                ] : [
                    tile('Visitors', data.totals.visitors, 'Distinct visitors measured by GA4'),
                    tile('Visits', data.totals.visits, 'Includes repeat visits')
                ];
                results.appendChild(el('div', { class: 'tiles analytics-totals' }, tiles));
                var period = 'Last 30 minutes';
                if (lastDay) period = '24 hours ending ' + formatTime(data.windowEnd) + ' · Recent data may still be processing';
                if (!shortRange) {
                    var through = data.stale ? dates.format(new Date(data.daily.at(-1).date + 'T00:00:00Z')) : 'yesterday';
                    period = 'Through ' + through + (data.timeZone ? ' · ' + data.timeZone : '');
                }
                var fetched = el('p', { class: 'range-note', text: period + ' · Last successful fetch: ' + formatTime(data.fetchedAt) + '.' });
                results.appendChild(fetched);
                if (data.stale) {
                    var notice = data.notice || { message: 'Google Analytics could not refresh this report.' };
                    var again = retryButton();
                    results.appendChild(el('div', { class: 'analytics-notice' }, [
                        waitNote('note', notice.message + ' Showing the last successful report.', notice.retryAfter, again), again
                    ]));
                }
                if (shortRange) {
                    if (!data.totals.activeUsers && !data.totals.pageViews) {
                        results.appendChild(el('div', { class: 'card', text: 'No traffic has been reported for this time range.' }));
                    }
                    if (realtime) results.appendChild(el('div', {}, [retryButton('Refresh')]));
                    return;
                }
                if (!data.totals.visitors && !data.totals.visits) {
                    results.appendChild(el('div', { class: 'card', text: 'No traffic has been reported for this date range.' }));
                    return;
                }
                var max = Math.max(1, ...data.daily.map(function (row) { return row.visits; }));
                var trend = el('section', { class: 'card' }, [el('h2', { text: 'Daily visits' })]);
                trend.appendChild(el('div', { class: 'analytics-chart', 'aria-hidden': 'true' }, data.daily.map(function (row) {
                    return el('meter', { min: 0, max: max, value: row.visits, title: row.date + ' · ' + numbers.format(row.visits) + ' visits' });
                })));
                trend.appendChild(el('details', { class: 'analytics-daily' }, [
                    el('summary', { text: 'View daily counts' }),
                    table('Daily traffic', ['Date', 'Visitors', 'Visits'], data.daily.map(function (row) {
                        return [dates.format(new Date(row.date + 'T00:00:00Z')), numbers.format(row.visitors), numbers.format(row.visits)];
                    }))
                ]));
                results.appendChild(trend);
                results.appendChild(table('Traffic sources', ['Source / medium', 'Visits'], data.sources.map(function (row) {
                    var source = row.source === '(direct) / (none)' ? 'Direct / unknown' : locationName(row.source);
                    return [source, numbers.format(row.visits)];
                })));
                results.appendChild(el('div', { class: 'detail analytics-locations' }, [
                    table('Top countries', ['Country', 'Visitors'], data.countries.map(function (row) {
                        return [locationName(row.country), numbers.format(row.visitors)];
                    })),
                    table('Top regions', ['Region', 'Country', 'Visitors'], data.regions.map(function (row) {
                        return [locationName(row.region), locationName(row.country), numbers.format(row.visitors)];
                    }))
                ]));
            }

            function retryButton(label) {
                var button = el('button', { type: 'button', text: label || 'Try again' });
                button.addEventListener('click', load);
                return button;
            }

            // A message with a live "Try again in N s." countdown from Retry-After. The button stays
            // disabled until it ends. Nothing reloads by itself: the owner presses Try again.
            function waitNote(kind, message, seconds, button) {
                stopCountdown();
                var left = el('span', { 'aria-live': 'off' });
                var note = el('p', { class: kind, role: kind === 'error' ? 'alert' : 'status' }, [message + ' ', left]);
                var until = Date.now() + (seconds || 0) * 1000;
                function tick() {
                    var remaining = Math.ceil((until - Date.now()) / 1000);
                    if (remaining > 0) {
                        left.textContent = 'Try again in ' + remaining + ' s.';
                        button.disabled = true;
                    } else {
                        stopCountdown();
                        left.textContent = seconds ? 'You can try again now.' : '';
                        button.disabled = false;
                    }
                }
                tick();
                if (seconds > 0) countdown = setInterval(tick, 1000);
                return note;
            }

            function stopCountdown() {
                if (countdown) clearInterval(countdown);
                countdown = null;
            }

            function load() {
                var request = ++latestLoad;
                var range = days.value;
                stopCountdown();
                clear(results).appendChild(el('p', { class: 'note', role: 'status', text: 'Loading traffic…' }));
                api('analytics?days=' + range).then(function (result) {
                    if (request !== latestLoad) return;
                    if (result.ok) return render(result.data, range);
                    var message = result.data.message || 'Traffic reports could not be loaded.';
                    if (!result.data.retryAfter) return showError(results, message, load);
                    var again = retryButton();
                    clear(results).appendChild(el('div', { class: 'card' }, [waitNote('error', message, result.data.retryAfter, again), again]));
                });
            }
        });
    }

    // ---- inbox ---------------------------------------------------------------------

    function resumeActions(enquiryId) {
        var url = '/api/admin/enquiry-resume?id=' + encodeURIComponent(enquiryId);
        return el('div', { class: 'buttons' }, [
            el('a', { href: url + '&view=1', target: '_blank', rel: 'noopener noreferrer', text: 'View PDF' }),
            el('a', { href: url, download: true, text: 'Download' })
        ]);
    }

    function inboxPage() {
        start('inbox', function (main) {
            var params = new URLSearchParams(window.location.search);
            var defaults = presetRange('30');
            var from = params.has('from') || params.has('to') ? (params.get('from') || '') : defaults.from;
            var to = params.has('from') || params.has('to') ? (params.get('to') || '') : defaults.to;
            var page = Math.max(1, Number(params.get('page')) || 1);
            var latestLoad = 0;

            function select(name, label, options, current) {
                var node = el('select', { name: name }, [el('option', { value: '', text: 'All' })].concat(options.map(function (item) {
                    return el('option', { value: item[0], text: item[1] });
                })));
                node.value = current || '';
                node.addEventListener('change', function () { page = 1; load(); });
                return el('label', {}, [label, node]);
            }

            var filter = dateFilter(from, to, function () { page = 1; load(); });
            var formSelect = select('form', 'Form', FORM_TYPES, params.get('form'));
            var statuses = can('recruitment') ? Object.keys(STATUS_LABELS) : GENERAL_STATUSES;
            var statusSelect = select('status', 'Status', statuses.map(function (key) { return [key, STATUS_LABELS[key]]; }), params.get('status'));
            var emailSelect = select('email', 'Email', Object.keys(EMAIL_LABELS).map(function (key) { return [key, EMAIL_LABELS[key]]; }), params.get('email'));
            var search = el('input', { type: 'search', name: 'q', value: params.get('q') || '', placeholder: 'Name, company, email, phone' });
            var searchLabel = el('label', {}, ['Search', search]);
            var apply = el('button', { type: 'submit', class: 'primary', text: 'Search' });
            var reset = el('a', { class: 'button', href: '/admin/enquiries', text: 'Reset' });
            var filters = el('form', { class: 'filters' }, filter.nodes.concat([formSelect, statusSelect, emailSelect, searchLabel, el('div', { class: 'actions' }, [apply, reset])]));
            filters.addEventListener('submit', function (event) { event.preventDefault(); page = 1; load(); });

            var note = el('p', { class: 'range-note' });
            var results = el('div', {});
            clear(main);
            main.appendChild(el('h1', { text: 'Enquiries' }));
            main.appendChild(filters);
            main.appendChild(note);
            main.appendChild(results);

            function currentQuery() {
                var value = filter.value();
                var query = new URLSearchParams();
                if (value.from) query.set('from', value.from);
                if (value.to) query.set('to', value.to);
                [['form', formSelect], ['status', statusSelect], ['email', emailSelect]].forEach(function (pair) {
                    var chosen = pair[1].querySelector('select').value;
                    if (chosen) query.set(pair[0], chosen);
                });
                if (search.value.trim()) query.set('q', search.value.trim());
                return query;
            }

            function load() {
                var loadId = ++latestLoad;
                var query = currentQuery();
                if (query.get('from') && query.get('to') && query.get('from') > query.get('to')) {
                    showError(results, 'Choose a start date that is not after the end date.');
                    return;
                }
                var shown = new URLSearchParams(query);
                if (page > 1) shown.set('page', String(page));
                window.history.replaceState(null, '', '/admin/enquiries' + (shown.toString() ? '?' + shown.toString() : ''));
                note.textContent = query.get('from') ? rangeText(query.get('from'), query.get('to') || query.get('from')) : 'Showing all dates.';
                query.set('page', String(page));
                clear(results).appendChild(el('p', { class: 'note', text: 'Loading…' }));
                api('enquiries?' + query.toString()).then(function (result) {
                    if (loadId !== latestLoad) return;
                    if (!result.ok) {
                        showError(results, result.data.message || 'The enquiries could not be loaded.', load);
                        return;
                    }
                    render(result.data);
                });
            }

            function render(data) {
                clear(results);
                if (!data.items.length) {
                    results.appendChild(el('div', { class: 'card' }, [el('p', { class: 'note', text: 'No enquiries match these filters.' })]));
                    return;
                }
                var body = el('tbody');
                var headings = ['Submitted', 'Form', 'Name or company', 'Contact', 'Status', 'Email'];
                if (data.showAttachments) headings.push('Attachments');
                data.items.forEach(function (item) {
                    var detail = '/admin/enquiries/' + item.id;
                    var emailCell = el('td', { 'data-label': 'Email' }, [badge(item.emailState, EMAIL_LABELS[item.emailState] || item.emailState)]);
                    var cells = [
                        el('td', { 'data-label': 'Submitted', text: formatTime(item.createdAt) }),
                        el('td', { 'data-label': 'Form', text: item.formTitle }),
                        el('td', {}, [el('a', { href: detail, text: item.name }), item.company && item.company !== item.name ? el('small', { text: item.company }) : '']),
                        el('td', { 'data-label': 'Contact' }, [item.email, item.phone ? el('small', { text: item.phone }) : '']),
                        el('td', { 'data-label': 'Status' }, [badge(item.status, STATUS_LABELS[item.status])]),
                        emailCell
                    ];
                    if (data.showAttachments) {
                        cells.push(el('td', { 'data-label': 'Attachments' }, item.hasResume ? resumeActions(item.id) : '—'));
                    }
                    body.appendChild(el('tr', {}, cells));
                });
                results.appendChild(el('table', {}, [
                    el('thead', {}, [el('tr', {}, headings.map(function (heading) { return el('th', { scope: 'col', text: heading }); }))]),
                    body
                ]));
                var first = (data.page - 1) * data.pageSize + 1;
                var last = first + data.items.length - 1;
                var prev = el('button', { type: 'button', text: 'Previous', disabled: data.page <= 1 });
                var next = el('button', { type: 'button', text: 'Next', disabled: last >= data.total });
                prev.addEventListener('click', function () { page = data.page - 1; load(); });
                next.addEventListener('click', function () { page = data.page + 1; load(); });
                results.appendChild(el('div', { class: 'pager' }, [el('span', { class: 'note', text: 'Showing ' + first + '–' + last + ' of ' + data.total }), el('div', { class: 'buttons' }, [prev, next])]));
            }
            load();
        });
    }

    // ---- one enquiry -----------------------------------------------------------------

    function enquiryPage() {
        var id = window.location.pathname.split('/').pop();
        start('enquiry', function (main) {
            clear(main);
            var holder = el('div', {});
            var noteDrafts = {};
            main.appendChild(el('a', { class: 'back', href: '/admin/enquiries', text: '← Back to enquiries' }));
            main.appendChild(holder);
            load();

            function load() {
                api('enquiry?id=' + encodeURIComponent(id)).then(function (result) {
                    if (!result.ok) {
                        showError(holder, result.status === 404 ? 'This enquiry was not found.' : (result.data.message || 'The enquiry could not be loaded.'), result.status === 404 ? null : load);
                        return;
                    }
                    render(result.data);
                });
            }

            function followUpCard(enquiry) {
                var selected = enquiry.status;
                var statuses = enquiry.formType === 'recruitment' ? Object.keys(STATUS_LABELS) : GENERAL_STATUSES;
                var noteLabel = el('span', {});
                var note = el('textarea', { rows: 3, maxlength: 2000, placeholder: 'Optional internal note' });
                var save = el('button', { type: 'submit', class: 'primary', text: 'Save follow-up' });
                var message = el('p', { class: 'follow-up-message', role: 'status' });
                var changed = el('p', { class: 'note follow-up-message' });
                var buttons = statuses.map(function (key) {
                    var button = el('button', { type: 'button', text: STATUS_LABELS[key] });
                    button.addEventListener('click', function () {
                        selected = key;
                        showSelection();
                        message.textContent = '';
                    });
                    return button;
                });
                var form = el('form', { class: 'follow-up-form' }, [
                    el('div', { class: 'buttons' }, buttons),
                    el('label', {}, [noteLabel, note]),
                    el('div', { class: 'buttons' }, [save]),
                    message, changed
                ]);

                function savedNote() {
                    return enquiry.statusNotes[selected] || '';
                }

                function showSelection() {
                    buttons.forEach(function (button, index) {
                        button.setAttribute('aria-pressed', String(statuses[index] === selected));
                    });
                    noteLabel.textContent = 'Notes for ' + STATUS_LABELS[selected];
                    note.value = noteDrafts[selected] ?? savedNote();
                    save.disabled = selected === enquiry.status && note.value.trim() === savedNote();
                    changed.textContent = enquiry.statusChangedAt
                        ? 'Last changed ' + formatTime(enquiry.statusChangedAt) + (enquiry.statusChangedBy ? ' by ' + enquiry.statusChangedBy : '') + '.'
                        : '';
                }

                note.addEventListener('input', function () {
                    noteDrafts[selected] = note.value;
                    save.disabled = selected === enquiry.status && note.value.trim() === savedNote();
                    message.textContent = '';
                });
                form.addEventListener('submit', function (event) {
                    event.preventDefault();
                    if (save.disabled) return;
                    save.disabled = note.disabled = true;
                    buttons.forEach(function (button) { button.disabled = true; });
                    message.textContent = '';
                    api('enquiry-status', { method: 'POST', body: {
                        id: enquiry.id, status: selected, expectedStatus: enquiry.status, note: noteDrafts[selected]
                    } }).then(function (result) {
                        note.disabled = false;
                        buttons.forEach(function (button) { button.disabled = false; });
                        if (result.ok) {
                            Object.assign(enquiry, result.data.followUp);
                            delete noteDrafts[selected];
                        }
                        showSelection();
                        message.className = 'follow-up-message ' + (result.ok ? 'note' : 'error');
                        message.textContent = result.ok ? 'Follow-up saved.' : (result.data.message || 'The follow-up could not be saved.');
                    });
                });
                showSelection();
                return el('div', { class: 'card' }, [el('h2', { text: 'Follow-up status' }), form]);
            }

            function render(enquiry) {
                clear(holder);
                holder.appendChild(el('h1', { text: enquiry.formTitle + ' enquiry' }));

                var fields = el('dl', { class: 'fields' });
                fields.appendChild(el('dt', { text: 'Submitted' }));
                fields.appendChild(el('dd', { text: formatTime(enquiry.createdAt) }));
                enquiry.fields.forEach(function (field) {
                    fields.appendChild(el('dt', { text: field.label }));
                    fields.appendChild(el('dd', { text: field.value }));
                });
                if (enquiry.resumeFilename) {
                    fields.appendChild(el('dt', { text: 'Resume' }));
                    fields.appendChild(el('dd', {}, [
                        el('div', { text: enquiry.resumeFilename }),
                        resumeActions(enquiry.id)
                    ]));
                }
                if (enquiry.sourcePage) {
                    fields.appendChild(el('dt', { text: 'Sent from page' }));
                    fields.appendChild(el('dd', { text: enquiry.sourcePage }));
                }

                var statusCard = followUpCard(enquiry);

                var note = enquiry.notification;
                var mailCard = el('div', { class: 'card' }, [
                    el('h2', { text: 'Email notification' }),
                    el('p', {}, [badge(note.state, EMAIL_LABELS[note.state] || note.state)])
                ]);
                mailCard.appendChild(el('p', { class: 'note', text: 'Sent to info@agromaxx.in with the visitor’s address as Reply-To. The enquiry is saved even when email fails.' }));
                if (note.errorCode) mailCard.appendChild(el('p', { class: 'error', text: ERROR_TEXT[note.errorCode] || ('Brevo problem: ' + note.errorCode) }));
                if (note.state === 'delivered') mailCard.appendChild(el('p', { class: 'note', text: 'Delivery confirmed by Brevo ' + formatTime(note.deliveredAt) + '.' }));
                else if (note.state === 'accepted') mailCard.appendChild(el('p', { class: 'note', text: 'Brevo accepted it ' + formatTime(note.acceptedAt) + '. Delivery has not been confirmed.' }));
                if (note.state === 'unconfirmed') mailCard.appendChild(el('p', { class: 'note', text: 'The result of the earlier attempt is not known. Retrying could send a duplicate email.' }));
                var retryMessage = el('p', { class: 'error', role: 'alert', hidden: true });
                if (note.state === 'failed' || note.state === 'unconfirmed' || (note.state === 'pending' && note.attempts === 0)) {
                    var retry = el('button', { type: 'button', class: 'primary', text: note.state === 'unconfirmed' ? 'Retry anyway' : 'Retry email' });
                    retry.addEventListener('click', function () {
                        if (note.state === 'unconfirmed' && !window.confirm('The earlier attempt may have been sent. Send again?')) return;
                        retry.disabled = true;
                        api('enquiry-retry', { method: 'POST', body: { id: enquiry.id, confirm: note.state === 'unconfirmed' } }).then(function (result) {
                            if (result.ok) {
                                load();
                            } else {
                                retryMessage.textContent = result.data.message || 'The email could not be retried.';
                                retryMessage.hidden = false;
                                retry.disabled = false;
                            }
                        });
                    });
                    mailCard.appendChild(retry);
                }
                mailCard.appendChild(retryMessage);
                if (note.history.length) {
                    mailCard.appendChild(el('ul', { class: 'history' }, note.history.map(function (entry) {
                        return el('li', { text: formatTime(entry.at) + ': ' + entry.event.replace(/_/g, ' ') + (entry.detail ? ' (' + entry.detail + ')' : '') });
                    })));
                }

                holder.appendChild(el('div', { class: 'detail' }, [
                    el('div', { class: 'card' }, [el('h2', { text: 'Submitted details' }), fields]),
                    el('div', { class: 'stack' }, [statusCard, mailCard])
                ]));
            }
        });
    }

    // ---- products ------------------------------------------------------------------------

    var PRODUCT_STATUS = { draft: 'Draft', published: 'Published', archived: 'Archived' };
    var CATALOGUE_LABELS = { chemical: 'Chemical', nonchemical: 'Non-chemical' };
    var LISTING_LABELS = { chemicals: 'Chemical grid', nonchemical: 'Non-chemical grid' };

    function productBadges(item) {
        var badges = [badge('product-' + item.status, PRODUCT_STATUS[item.status] || item.status)];
        if (item.hasChanges) badges.push(badge('pending', 'Unpublished changes'));
        if (item.needsDecision) badges.push(badge('failed', 'Decision needed'));
        return badges;
    }

    function listingText(listingPage, listingTab, tabs) {
        if (!listingPage) return 'Not listed';
        var tab = (tabs || []).filter(function (candidate) { return candidate.listing_page === listingPage && candidate.key === listingTab; })[0];
        return LISTING_LABELS[listingPage] + ' / ' + (tab ? tab.label : 'All only');
    }

    function productsPage() {
        start('products', function (main) {
            var params = new URLSearchParams(window.location.search);
            var page = Math.max(1, Number(params.get('page')) || 1);
            clear(main);
            var head = el('div', { class: 'page-head' }, [el('h1', { text: 'Products' })]);
            if (can('products_edit')) head.appendChild(el('a', { class: 'button primary', href: '/admin/products/new', text: 'Add product' }));
            main.appendChild(head);
            var liveBox = el('div', {});
            main.appendChild(liveBox);

            var facetData = null;
            var results = el('div', {});
            var filterBox = el('form', { class: 'filters' });
            main.appendChild(filterBox);
            main.appendChild(results);

            function options(list, current) {
                return [el('option', { value: '', text: 'All' })].concat(list.map(function (item) {
                    var node = el('option', { value: item[0], text: item[1] });
                    return node;
                }));
            }

            function buildFilters() {
                var catalogueSelect = el('select', { name: 'catalogue' }, options([['chemical', 'Chemical'], ['nonchemical', 'Non-chemical']]));
                var statusSelect = el('select', { name: 'status' }, options([
                    ['draft', 'Draft (never published)'], ['published', 'Published'], ['archived', 'Archived'],
                    ['changes', 'Published, with unpublished changes'], ['decision', 'Decision needed (from the import)']
                ]));
                var categories = {};
                facetData.categories.forEach(function (row) { categories[row.category] = true; });
                var categorySelect = el('select', { name: 'category' }, options(Object.keys(categories).sort().map(function (name) { return [name, name]; })));
                var tabSelect = el('select', { name: 'tab' }, options(facetData.tabs.map(function (tab) { return [tab.key, LISTING_LABELS[tab.listing_page] + ': ' + tab.label]; })));
                var search = el('input', { type: 'search', name: 'q', placeholder: 'Name or ID' });
                catalogueSelect.value = params.get('catalogue') || '';
                statusSelect.value = params.get('status') || '';
                categorySelect.value = params.get('category') || '';
                tabSelect.value = params.get('tab') || '';
                search.value = params.get('q') || '';
                [catalogueSelect, statusSelect, categorySelect, tabSelect].forEach(function (select) {
                    select.addEventListener('change', function () { page = 1; load(); });
                });
                clear(filterBox);
                [['Catalogue', catalogueSelect], ['Status', statusSelect], ['Category', categorySelect], ['Tab', tabSelect], ['Search', search]].forEach(function (pair) {
                    filterBox.appendChild(el('label', {}, [pair[0], pair[1]]));
                });
                filterBox.appendChild(el('div', { class: 'actions' }, [el('button', { type: 'submit', class: 'primary', text: 'Search' }), el('a', { class: 'button', href: '/admin/products', text: 'Reset' })]));
                filterBox.onsubmit = function (event) { event.preventDefault(); page = 1; load(); };
            }

            function formQuery() {
                var query = new URLSearchParams();
                ['catalogue', 'status', 'category', 'tab', 'q'].forEach(function (name) {
                    var node = filterBox.elements[name];
                    if (node && node.value.trim()) query.set(name, node.value.trim());
                });
                return query;
            }

            function renderLive() {
                clear(liveBox);
                var counts = facetData.counts;
                var text = facetData.live
                    ? 'The public site is using the managed catalogue.'
                    : 'The public site is still using its original pages. Visitors see no change until the managed catalogue is switched on.';
                var card = el('div', { class: 'card live-card' }, [
                    el('div', {}, [
                        el('strong', { text: facetData.live ? 'Managed catalogue is ON' : 'Managed catalogue is OFF' }),
                        el('p', { class: 'note', text: text }),
                        el('p', { class: 'note', text: counts.published + ' published, ' + counts.draft + ' draft, ' + counts.archived + ' archived, ' + counts.changes + ' with unpublished changes, ' + counts.decision + ' awaiting a decision.' })
                    ])
                ]);
                if (facetData.canPublish) {
                    var toggle = el('button', { type: 'button', text: facetData.live ? 'Switch back to the original pages' : 'Switch on the managed catalogue' });
                    toggle.addEventListener('click', function () {
                        var message = facetData.live
                            ? 'Switch the public site back to its original pages? Published products stay saved.'
                            : 'Switch the public site to the managed catalogue? Grids, product pages and search will show only published products.';
                        if (!window.confirm(message)) return;
                        api('catalogue-live', { method: 'POST', body: { live: !facetData.live } }).then(function (result) {
                            if (result.ok) loadFacets(); else window.alert(result.data.message || 'The change could not be made.');
                        });
                    });
                    card.appendChild(toggle);
                }
                liveBox.appendChild(card);
            }

            function loadFacets() {
                return api('product-facets').then(function (result) {
                    if (!result.ok) { showError(results, result.data.message || 'The product list could not be loaded.', loadFacets); return; }
                    facetData = result.data;
                    renderLive();
                    buildFilters();
                    load();
                });
            }

            function load() {
                var query = formQuery();
                var shown = new URLSearchParams(query);
                if (page > 1) shown.set('page', String(page));
                window.history.replaceState(null, '', '/admin/products' + (shown.toString() ? '?' + shown.toString() : ''));
                query.set('page', String(page));
                clear(results).appendChild(el('p', { class: 'note', text: 'Loading…' }));
                api('products?' + query.toString()).then(function (result) {
                    if (!result.ok) { showError(results, result.data.message || 'The products could not be loaded.', load); return; }
                    render(result.data);
                });
            }

            function render(data) {
                clear(results);
                if (!data.items.length) {
                    results.appendChild(el('div', { class: 'card' }, [el('p', { class: 'note', text: 'No products match these filters.' })]));
                    return;
                }
                var body = el('tbody');
                data.items.forEach(function (item) {
                    body.appendChild(el('tr', {}, [
                        el('td', {}, [el('a', { href: '/admin/products/' + item.id, text: item.name || '(no name)' }), el('small', { text: item.productId })]),
                        el('td', { 'data-label': 'Catalogue', text: CATALOGUE_LABELS[item.catalogue] }),
                        el('td', { 'data-label': 'Category', text: item.category }),
                        el('td', { 'data-label': 'Listing', text: listingText(item.listingPage, item.listingTab, facetData.tabs) }),
                        el('td', { 'data-label': 'Status' }, [el('div', { class: 'badges' }, productBadges(item))]),
                        el('td', { 'data-label': 'Updated', text: formatTime(item.updatedAt) })
                    ]));
                });
                results.appendChild(el('table', {}, [
                    el('thead', {}, [el('tr', {}, ['Product', 'Catalogue', 'Category', 'Listing', 'Status', 'Updated'].map(function (heading) { return el('th', { scope: 'col', text: heading }); }))]),
                    body
                ]));
                var first = (data.page - 1) * data.pageSize + 1;
                var last = first + data.items.length - 1;
                var prev = el('button', { type: 'button', text: 'Previous', disabled: data.page <= 1 });
                var next = el('button', { type: 'button', text: 'Next', disabled: last >= data.total });
                prev.addEventListener('click', function () { page = data.page - 1; load(); });
                next.addEventListener('click', function () { page = data.page + 1; load(); });
                results.appendChild(el('div', { class: 'pager' }, [el('span', { class: 'note', text: 'Showing ' + first + '–' + last + ' of ' + data.total }), el('div', { class: 'buttons' }, [prev, next])]));
            }

            loadFacets();
        });
    }

    var TEXT_INPUTS = [
        ['target_crops', 'Target crops'], ['target_pests', 'Target pests'], ['target_diseases', 'Target diseases'],
        ['target_insects', 'Target insects'], ['target_weeds', 'Target weeds'], ['application', 'Application'], ['dose', 'Dose'], ['packing', 'Packing sizes']
    ];

    function productEditPage() {
        var idFromPath = window.location.pathname.split('/').pop();
        var isNew = idFromPath === 'new';
        start('product-edit', function (main) {
            clear(main);
            var holder = el('div', {});
            main.appendChild(el('a', { class: 'back', href: '/admin/products', text: '← Back to products' }));
            main.appendChild(holder);
            var tabs = [];
            var product = null;       // the record from the server (null while adding)
            var imageState = { image: null, image_id: null };
            var dirty = false;
            var fields = {};
            var messages = el('div', { class: 'messages', role: 'status' });
            var validation = { errors: {}, warnings: [] };

            window.addEventListener('beforeunload', function (event) {
                if (dirty) { event.preventDefault(); event.returnValue = ''; }
            });

            api('product-facets').then(function (facets) {
                if (!facets.ok) { showError(holder, facets.data.message || 'The page could not be loaded.'); return; }
                tabs = facets.data.tabs;
                if (isNew) { build(null); return; }
                reload();
            });

            function reload() {
                api('product?id=' + encodeURIComponent(idFromPath)).then(function (result) {
                    if (!result.ok) { showError(holder, result.status === 404 ? 'This product was not found.' : (result.data.message || 'The product could not be loaded.'), result.status === 404 ? null : reload); return; }
                    product = result.data;
                    validation = product.validation || validation;
                    build(product);
                });
            }

            function say(text, isError) {
                clear(messages);
                if (text) messages.appendChild(el('p', { class: isError ? 'error' : 'ok', role: isError ? 'alert' : 'status', text: text }));
            }

            function input(name, label, props) {
                var node = el(props && props.tag || 'input', Object.assign({ name: name, id: 'f-' + name }, props && props.attrs || {}));
                fields[name] = node;
                node.addEventListener('input', function () { dirty = true; syncPagePreview(); });
                if (node.tagName === 'SELECT') node.addEventListener('change', syncPagePreview);
                var wrap = el('label', { class: props && props.wide ? 'wide' : '' }, [label, node, el('span', { class: 'field-error', 'data-error-for': name, hidden: true })]);
                return wrap;
            }

            function setValue(name, value) {
                if (fields[name]) fields[name].value = value === null || value === undefined ? '' : value;
            }

            function fill(content) {
                content = content || {};
                ['name', 'category', 'subcategory', 'type', 'description', 'technical', 'benefits', 'tags', 'image_alt', 'display_order']
                    .concat(TEXT_INPUTS.map(function (pair) { return pair[0]; })).forEach(function (name) { setValue(name, content[name]); });
                setValue('aliases', (content.aliases || []).join('\n'));
                fields.listing_page.value = content.listing_page || '';
                refreshTabs(content.listing_tab || '');
                imageState = { image: content.image || null, image_id: content.image_id || null };
                drawImage();
                showValidation();
            }

            function refreshTabs(selected) {
                var page = fields.listing_page.value;
                clear(fields.listing_tab);
                fields.listing_tab.appendChild(el('option', { value: '', text: page ? 'All only' : 'Not applicable' }));
                tabs.filter(function (tab) { return tab.listing_page === page; }).forEach(function (tab) {
                    fields.listing_tab.appendChild(el('option', { value: tab.key, text: tab.label }));
                });
                fields.listing_tab.value = selected || '';
                fields.listing_tab.disabled = !page;
            }

            function collect() {
                var content = {
                    listing_page: fields.listing_page.value || null, listing_tab: fields.listing_tab.value || null,
                    display_order: fields.display_order.value === '' ? null : Number(fields.display_order.value),
                    aliases: fields.aliases.value.split('\n'), image: imageState.image, image_id: imageState.image_id
                };
                ['name', 'category', 'subcategory', 'type', 'description', 'technical', 'benefits', 'tags', 'image_alt']
                    .concat(TEXT_INPUTS.map(function (pair) { return pair[0]; })).forEach(function (name) { content[name] = fields[name].value; });
                return content;
            }

            function showValidation() {
                document.querySelectorAll('[data-error-for]').forEach(function (node) {
                    var message = validation.errors && validation.errors[node.getAttribute('data-error-for')];
                    node.textContent = message || '';
                    node.hidden = !message;
                });
                var box = document.getElementById('validation-box');
                if (!box) return;
                clear(box);
                var errors = Object.keys(validation.errors || {});
                if (errors.length) {
                    box.appendChild(el('p', { class: 'error', text: 'Before this can be published:' }));
                    box.appendChild(el('ul', {}, errors.map(function (name) { return el('li', { text: validation.errors[name] }); })));
                }
                if ((validation.warnings || []).length) {
                    box.appendChild(el('p', { class: 'note', text: 'Things to check (these do not block publishing):' }));
                    box.appendChild(el('ul', {}, validation.warnings.map(function (text) { return el('li', { text: text }); })));
                }
            }

            function imageSrc() {
                if (imageState.image_id) return '/api/admin/product-image?id=' + imageState.image_id;
                return imageState.image ? '/' + imageState.image : null;
            }

            var imageBox = el('div', { class: 'image-box' });
            function drawImage() {
                clear(imageBox);
                var src = imageSrc();
                imageBox.appendChild(src ? el('img', { class: 'product-thumb', src: src, alt: '' }) : el('p', { class: 'note', text: 'No image yet. The Agross logo is shown instead.' }));
                var file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'image-file' });
                var status = el('p', { class: 'note' });
                file.addEventListener('change', function () {
                    var chosen = file.files && file.files[0];
                    if (!chosen) return;
                    if (chosen.size > 2 * 1024 * 1024) { status.textContent = 'That image is larger than 2 MB.'; status.className = 'error'; return; }
                    var reader = new FileReader();
                    status.textContent = 'Uploading…';
                    reader.onload = function () {
                        var data = String(reader.result).split(',')[1] || '';
                        api('product-image-upload', { method: 'POST', body: { filename: chosen.name, dataBase64: data } }).then(function (result) {
                            if (!result.ok) { status.textContent = result.data.message || 'The image could not be uploaded.'; status.className = 'error'; return; }
                            imageState = { image: null, image_id: result.data.id };
                            if (!fields.image_alt.value) fields.image_alt.value = fields.name.value;
                            dirty = true;
                            drawImage();
                            syncPagePreview();
                        });
                    };
                    reader.readAsDataURL(chosen);
                });
                imageBox.appendChild(el('label', { class: 'file-label' }, [src ? 'Replace image (PNG, JPEG or WebP, up to 2 MB)' : 'Upload image (PNG, JPEG or WebP, up to 2 MB)', file]));
                if (src) {
                    var remove = el('button', { type: 'button', text: 'Remove image' });
                    remove.addEventListener('click', function () { imageState = { image: null, image_id: null }; dirty = true; drawImage(); syncPagePreview(); });
                    imageBox.appendChild(remove);
                }
                imageBox.appendChild(status);
            }

            function save(thenDo) {
                var content = collect();
                var request = isNew && !product
                    ? api('product-create', { method: 'POST', body: { catalogue: fields.catalogue.value, productId: fields.productId.value.trim(), content: content } })
                    : api('product-save', { method: 'POST', body: { id: product.id, version: product.version, content: content } });
                return request.then(function (result) {
                    if (!result.ok) { say(result.data.message || 'The draft could not be saved.', true); return null; }
                    dirty = false;
                    if (isNew && !product) {
                        window.location.assign('/admin/products/' + result.data.id);
                        return null;
                    }
                    return api('product?id=' + encodeURIComponent(product.id)).then(function (fresh) {
                        if (fresh.ok) { product = fresh.data; validation = product.validation; }
                        say('Draft saved.');
                        clear(historyBox);
                        clear(deleteBox);
                        buildHistory(product);
                        refreshStatus();
                        showValidation();
                        refreshPreviews();
                        if (thenDo) thenDo();
                        return product;
                    });
                });
            }

            function act(route, body, doneMessage, confirmText) {
                if (confirmText && !window.confirm(confirmText)) return;
                api(route, { method: 'POST', body: body }).then(function (result) {
                    if (!result.ok) {
                        if (result.data.errors) { validation = { errors: result.data.errors, warnings: validation.warnings }; showValidation(); }
                        say(result.data.message || 'That could not be done.', true);
                        return;
                    }
                    dirty = false;
                    reload();
                    window.setTimeout(function () { say(doneMessage); }, 400);
                });
            }

            var DETAIL_PAGES = { chemical: 'product.html', nonchemical: 'nonchemical-details.html' };
            var PREVIEW_WIDTH = 1000;           // the page is drawn this wide, then scaled down to fit the column
            var managementOpen = false;

            var titleBadges = el('span', { class: 'badges title-badges' });
            var decisionBox = el('div', { class: 'decision', hidden: true });
            var managementBox = el('details', { class: 'card management' });
            var statusBox = el('div', { class: 'management-part' });
            var historyBox = el('div', { class: 'management-part' });
            var deleteBox = el('div', { class: 'management-part danger-part' });
            var actionsBox = el('div', { class: 'buttons sticky' });
            managementBox.addEventListener('toggle', function () { managementOpen = managementBox.open; });

            function refreshStatus() {
                clear(statusBox);
                clear(titleBadges);
                clear(decisionBox);
                decisionBox.hidden = true;
                if (!product) {
                    statusBox.appendChild(el('p', { class: 'note', text: 'New products are saved as drafts. Nothing is public until you publish.' }));
                    actions();
                    return;
                }
                productBadges({ status: product.status, hasChanges: product.hasChanges, needsDecision: product.needsDecision }).forEach(function (node) { titleBadges.appendChild(node); });
                statusBox.appendChild(el('h3', { text: 'Status' }));
                statusBox.appendChild(el('p', {}, productBadges({ status: product.status, hasChanges: product.hasChanges, needsDecision: product.needsDecision })));
                var lines = [];
                if (product.publishedAt) lines.push('Published ' + formatTime(product.publishedAt) + (product.publishedBy ? ' by ' + product.publishedBy : '') + '.');
                lines.push('Last edited ' + formatTime(product.updatedAt) + (product.updatedBy ? ' by ' + product.updatedBy : '') + '.');
                if (product.status === 'published' && product.hasChanges) lines.push('Visitors still see the published version. Your edits are a draft.');
                if (product.status === 'draft') lines.push('Never published. Visitors cannot see this product.');
                if (product.status === 'archived') lines.push('Archived: hidden from grids and search. Visitors who follow an old link see a "no longer available" message.');
                lines.forEach(function (text) { statusBox.appendChild(el('p', { class: 'note', text: text })); });
                if (product.needsDecision) {
                    // Import notes are guidance for the person editing, so they stay above the form.
                    decisionBox.hidden = false;
                    decisionBox.appendChild(el('strong', { text: 'Decision needed' }));
                    (product.importNotes || []).forEach(function (text) { decisionBox.appendChild(el('p', { class: 'note', text: text })); });
                    if (product.importAlternate) {
                        var load = el('button', { type: 'button', text: 'Load the second record into the form' });
                        load.addEventListener('click', function () {
                            if (!window.confirm('Replace the form with the second record from the source data? Nothing is saved until you press Save draft.')) return;
                            fill(product.importAlternate); dirty = true;
                        });
                        decisionBox.appendChild(load);
                    }
                    if (product.canPublish) {
                        var done = el('button', { type: 'button', text: 'Mark decision as made' });
                        done.addEventListener('click', function () { act('product-decision-clear', { id: product.id }, 'Marked as decided.'); });
                        decisionBox.appendChild(done);
                    }
                }
                actions();
            }

            function actions() {
                clear(actionsBox);
                var saveButton = el('button', { type: 'button', class: 'primary', text: 'Save draft' });
                saveButton.addEventListener('click', function () { save(); });
                actionsBox.appendChild(saveButton);
                if (!product) return;
                var preview = el('button', { type: 'button', text: 'Preview' });
                preview.addEventListener('click', function () { pagePreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
                actionsBox.appendChild(preview);
                if (product.canPublish && product.status !== 'archived') {
                    var publish = el('button', { type: 'button', class: 'primary', text: product.status === 'published' ? 'Publish changes' : 'Publish', disabled: product.status === 'published' && !product.hasChanges && !dirty });
                    publish.addEventListener('click', function () {
                        function go() { act('product-publish', { id: product.id }, 'Published. Visitors see this version.', 'Publish this version to the public catalogue?'); }
                        if (dirty) save(go); else go();
                    });
                    actionsBox.appendChild(publish);
                }
                if (product.status === 'published' && product.hasChanges) {
                    var discard = el('button', { type: 'button', text: 'Discard draft changes' });
                    discard.addEventListener('click', function () { act('product-discard', { id: product.id }, 'Draft changes discarded.', 'Throw away your unpublished changes and go back to the published version?'); });
                    actionsBox.appendChild(discard);
                }
                if (product.canPublish) {
                    if (product.status === 'archived') {
                        var restore = el('button', { type: 'button', text: 'Restore' });
                        restore.addEventListener('click', function () { act('product-restore', { id: product.id }, 'Restored.'); });
                        actionsBox.appendChild(restore);
                    } else {
                        var archive = el('button', { type: 'button', text: 'Archive' });
                        archive.addEventListener('click', function () { act('product-archive', { id: product.id }, 'Archived. It is hidden from the grid and search.', 'Archive this product? It disappears from the grid and search.'); });
                        actionsBox.appendChild(archive);
                    }
                }
            }

            // ---- previews (right-hand column) ----------------------------------------------------------

            // The page preview is the real public detail page, opened in "embed" mode (no site header or footer)
            // and starting with the saved draft. It is drawn at desktop width and scaled to fit the column; on a narrow
            // screen it is shown at its natural width instead, which is the phone layout.
            var pageFrame = el('iframe', { class: 'page-preview-frame', title: 'Product page preview' });
            var pageWrap = el('div', { class: 'page-preview-wrap' }, [pageFrame]);
            var pageNote = el('p', { class: 'note' });
            var pageLink = el('a', { class: 'button', target: '_blank', rel: 'noopener', text: 'Open full-size saved draft', hidden: true });
            var pagePreview = el('div', { class: 'card preview-card' }, [
                el('h2', { text: 'Product page preview' }), pageNote, el('div', { class: 'page-preview-scroll' }, [pageWrap]), pageLink
            ]);
            var cardFrame = el('iframe', { class: 'card-preview', sandbox: 'allow-same-origin', title: 'Product card preview' });
            var cardPreview = el('div', { class: 'card preview-card' }, [el('h2', { text: 'Grid card preview' }), cardFrame]);

            function syncPagePreview() {
                var doc = pageFrame.contentDocument;
                if (!product || !doc || doc.documentElement.dataset.productPreview !== product.id) return;

                var content = collect();
                var fieldsToShow = ['name', 'category', 'description', 'technical', 'benefits']
                    .concat(TEXT_INPUTS.map(function (pair) { return pair[0]; }));
                fieldsToShow.forEach(function (name) {
                    var key = name.replace('_', '');
                    var field = doc.getElementById('product-' + key);
                    var heading = doc.getElementById(key + '-heading');
                    var value = content[name].trim();
                    if (name === 'technical' || (name === 'benefits' && product.catalogue === 'nonchemical')) {
                        // Allow the same simple formatting as the saved draft. Escape every other fragment.
                        field.innerHTML = value.split(/(<br\s*\/?>|<\/?(?:b|strong|i|em|u|sub|sup)\s*>)/gi)
                            .map(function (part, index) {
                                return index % 2 ? part : part.replace(/&(?!(?:amp|lt|gt|quot|#39|#\d+);)/g, '&amp;')
                                    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            }).join('');
                    } else {
                        field.textContent = value;
                    }
                    if (heading) heading.style.display = field.style.display = value ? 'block' : 'none';
                });

                var image = doc.getElementById('product-image');
                var src = new URL(imageSrc() || '/assets/agross-logo.png', doc.baseURI).href;
                if (image.dataset.previewSrc !== src) {
                    image.dataset.previewSrc = src;
                    if (image.src !== src) image.src = src;
                }
                image.alt = content.image_alt.trim() || content.name.trim();
                sizePagePreview();
            }

            window.addEventListener('message', function (event) {
                if (event.origin === window.location.origin && event.source === pageFrame.contentWindow &&
                    event.data === 'agross-product-preview-ready') syncPagePreview();
            });

            function sizePagePreview() {
                var wide = window.matchMedia('(min-width: 900px)').matches;
                var available = pageWrap.parentNode.clientWidth;
                var scale = wide ? Math.min(1, available / PREVIEW_WIDTH) : 1;
                var width = wide ? PREVIEW_WIDTH : available;
                var height = 400;
                try { height = Math.max(400, pageFrame.contentDocument.documentElement.scrollHeight); } catch (error) { /* still loading */ }
                pageFrame.style.width = width + 'px';
                pageFrame.style.height = height + 'px';
                pageFrame.style.transform = scale === 1 ? '' : 'scale(' + scale + ')';
                pageWrap.style.width = (width * scale) + 'px';
                pageWrap.style.height = (height * scale) + 'px';
            }

            var sizeTimer = null;
            function watchPageSize() {
                // The page fills itself in after it loads (product data, then the fitted photo), so check a few times.
                var tries = 0;
                window.clearInterval(sizeTimer);
                sizeTimer = window.setInterval(function () {
                    sizePagePreview();
                    if (++tries > 24) window.clearInterval(sizeTimer);
                }, 250);
            }

            function loadPagePreview() {
                if (!product) {
                    pageNote.textContent = 'Save the draft to see how the product page will look.';
                    pageLink.hidden = true;
                    pageWrap.hidden = true;
                    return;
                }
                var address = DETAIL_PAGES[product.catalogue] + '?productId=' + encodeURIComponent(product.productId) + '&preview=' + product.id;
                pageNote.textContent = 'Updates as you edit. Select Save draft to keep your changes.';
                pageLink.href = '/' + address;
                pageLink.hidden = false;
                pageWrap.hidden = false;
                pageFrame.onload = function () { sizePagePreview(); syncPagePreview(); watchPageSize(); };
                pageFrame.src = '/' + address + '&embed=1&t=' + Date.now();
            }

            function loadCardPreview() {
                if (!product) { cardPreview.hidden = true; return; }
                api('product-preview?id=' + encodeURIComponent(product.id)).then(function (result) {
                    if (!result.ok) return;
                    cardPreview.hidden = false;
                    cardFrame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/dist/output.css"><link rel="stylesheet" href="/admin-assets/card-preview.css"></head><body><div class="container"><div class="grid mt-30 gap-30 grid-cols-1">' + result.data.cardHtml + '</div></div></body></html>';
                });
            }

            function refreshPreviews() {
                loadPagePreview();
                loadCardPreview();
            }

            window.addEventListener('resize', function () { sizePagePreview(); });

            // ---- the page ------------------------------------------------------------------------------------

            function build(record) {
                clear(holder);
                var heading = record ? (record.content.name || record.productId) : 'Add product';
                holder.appendChild(el('div', { class: 'page-head title-row' }, [el('h1', { text: heading }), titleBadges]));
                holder.appendChild(decisionBox);
                var identity = el('div', { class: 'grid-form' }, [
                    input('productId', 'Product ID (used in the web address; cannot change later)', { attrs: { maxlength: '80', autocomplete: 'off', placeholder: 'for example: maxx eleven' } }),
                    (function () {
                        var wrap = input('catalogue', 'Catalogue (cannot change later)', { tag: 'select' });
                        fields.catalogue.appendChild(el('option', { value: 'chemical', text: 'Chemical' }));
                        fields.catalogue.appendChild(el('option', { value: 'nonchemical', text: 'Non-chemical' }));
                        return wrap;
                    }()),
                    input('name', 'Name', { attrs: { maxlength: '120' } })
                ]);
                var listing = el('div', { class: 'grid-form' }, [
                    input('category', 'Category', { attrs: { list: 'category-list', maxlength: '120' } }),
                    input('subcategory', 'Subcategory', { attrs: { maxlength: '200' } }),
                    input('type', 'Type', { attrs: { maxlength: '40' } }),
                    (function () {
                        var wrap = input('listing_page', 'Listing', { tag: 'select' });
                        fields.listing_page.appendChild(el('option', { value: '', text: 'Not listed in a grid' }));
                        fields.listing_page.appendChild(el('option', { value: 'chemicals', text: 'Chemical grid' }));
                        fields.listing_page.appendChild(el('option', { value: 'nonchemical', text: 'Non-chemical grid' }));
                        fields.listing_page.addEventListener('change', function () { refreshTabs(''); });
                        return wrap;
                    }()),
                    input('listing_tab', 'Listing tab', { tag: 'select' }),
                    input('display_order', 'Display order (smaller numbers first)', { attrs: { type: 'number', step: '1' } })
                ]);
                var details = el('div', { class: 'grid-form' }, [
                    input('description', 'Description', { tag: 'textarea', wide: true, attrs: { rows: '3' } }),
                    input('technical', 'Technical or composition details (line breaks and simple bold/italic only)', { tag: 'textarea', wide: true, attrs: { rows: '3' } })
                ].concat(TEXT_INPUTS.map(function (pair) { return input(pair[0], pair[1], { attrs: { maxlength: '1000' } }); })).concat([
                    input('benefits', 'Benefits', { tag: 'textarea', wide: true, attrs: { rows: '3' } }),
                    input('aliases', 'Search aliases (one per line; other spellings people may type)', { tag: 'textarea', wide: true, attrs: { rows: '3' } }),
                    input('tags', 'Tags', { attrs: { maxlength: '600' }, wide: true })
                ]));
                var imageCard = el('div', { class: 'card' }, [el('h2', { text: 'Image' }), imageBox, input('image_alt', 'Image description (for people who cannot see it)', { attrs: { maxlength: '200' } })]);
                var datalist = el('datalist', { id: 'category-list' });
                holder.appendChild(datalist);
                api('product-facets').then(function (result) {
                    if (result.ok) result.data.categories.forEach(function (row) { datalist.appendChild(el('option', { value: row.category })); });
                });

                var formColumn = el('div', { class: 'stack editor-form' }, [
                    el('div', { class: 'card' }, [el('h2', { text: 'Identity' }), identity]),
                    el('div', { class: 'card' }, [el('h2', { text: 'Listing' }), listing]),
                    el('div', { class: 'card' }, [el('h2', { text: 'Details' }), details]),
                    imageCard
                ]);
                var previewColumn = el('div', { class: 'stack editor-preview' }, [pagePreview, cardPreview]);
                holder.appendChild(el('div', { class: 'editor-layout' }, [formColumn, previewColumn]));
                holder.appendChild(el('div', { class: 'card', id: 'validation-box' }));
                holder.appendChild(messages);
                holder.appendChild(actionsBox);

                // Status, history and deleting are kept out of the way, below the editor.
                clear(managementBox);
                managementBox.appendChild(el('summary', { text: 'Product management' }));
                managementBox.appendChild(el('div', { class: 'management-body' }, [statusBox, historyBox, deleteBox]));
                managementBox.open = managementOpen;
                holder.appendChild(managementBox);

                if (record) {
                    fields.productId.value = record.productId;
                    fields.productId.readOnly = true;
                    fields.catalogue.value = record.catalogue;
                    fields.catalogue.disabled = true;
                }
                fill(record ? record.content : {});
                dirty = false;
                clear(historyBox);
                clear(deleteBox);
                if (record) { buildHistory(record); }
                refreshStatus();
                refreshPreviews();
            }

            function buildHistory(record) {
                historyBox.appendChild(el('h3', { text: 'History' }));
                if (!record.revisions.length) historyBox.appendChild(el('p', { class: 'note', text: 'No history yet.' }));
                var list = el('ul', { class: 'history' });
                record.revisions.forEach(function (revision) {
                    var item = el('li', { text: '#' + revision.number + ' ' + revision.action.replace(/_/g, ' ') + ', ' + formatTime(revision.at) + (revision.actor ? ' by ' + revision.actor : '') + ' ' });
                    var restore = el('button', { type: 'button', class: 'link', text: 'load into draft' });
                    restore.addEventListener('click', function () {
                        act('product-revision-restore', { id: record.id, number: revision.number }, 'That version is now your draft. Publish it when you are ready.', 'Load version #' + revision.number + ' into the draft? It replaces the current draft.');
                    });
                    item.appendChild(restore);
                    list.appendChild(item);
                });
                historyBox.appendChild(list);

                var canDelete = record.canPublish && (record.status === 'archived' || (record.status === 'draft' && !record.published));
                if (canDelete) {
                    deleteBox.appendChild(el('h3', { text: 'Delete permanently' }));
                    deleteBox.appendChild(el('p', { class: 'note', text: 'This cannot be undone. Normally you should archive instead. Type the product ID to confirm.' }));
                    var confirmInput = el('input', { type: 'text', placeholder: record.productId, autocomplete: 'off' });
                    var del = el('button', { type: 'button', text: 'Delete permanently' });
                    del.addEventListener('click', function () {
                        api('product-delete', { method: 'POST', body: { id: record.id, confirmProductId: confirmInput.value } }).then(function (result) {
                            if (result.ok) window.location.assign('/admin/products'); else say(result.data.message || 'It could not be deleted.', true);
                        });
                    });
                    deleteBox.appendChild(confirmInput);
                    deleteBox.appendChild(del);
                }
            }
        });
    }

    function recruitingPage() {
        start('recruiting', function (main) {
            clear(main).appendChild(el('div', { class: 'page-head' }, [
                el('h1', { text: 'Recruiting' }),
                el('a', { class: 'button', href: '/joinus.html', target: '_blank', rel: 'noopener', text: 'View Join Us page' })
            ]));
            main.appendChild(el('p', { class: 'note', text: 'Open positions appear on the Join Us page. Close a position when you stop accepting applications.' }));
            var content = el('div', { class: 'detail recruiting-layout' });
            main.appendChild(content);
            load();

            async function load() {
                clear(content).appendChild(el('p', { class: 'note', text: 'Loading openings…' }));
                var result = await api('recruiting');
                if (!result.ok) return showError(content, result.data.message || 'Could not load openings.', load);
                render(result.data.openings);
            }

            function render(openings) {
                var activeId;
                var saving = false;
                var listing = el('div', { class: 'stack' });
                var formTitle = el('h2', { text: 'Create opening' });
                var designation = el('input', { type: 'text', required: true, maxlength: 120 });
                var area = el('input', { name: 'area', type: 'text', maxlength: 120, placeholder: 'e.g. Bhopal, Madhya Pradesh' });
                var description = el('textarea', { rows: 7, required: true, maxlength: 5000 });
                var visibility = el('select', {}, [
                    el('option', { value: 'closed', text: 'Closed — hidden from Join Us' }),
                    el('option', { value: 'open', text: 'Open — accepting applications' })
                ]);
                var submit = el('button', { class: 'primary', type: 'submit', text: 'Create opening' });
                var cancel = el('button', { type: 'button', text: 'Cancel edit', hidden: true });
                var message = el('p', { class: 'note recruiting-message', role: 'status' });
                var newOpening = el('button', { type: 'button', text: 'New opening' });
                var form = el('form', { class: 'form' }, [
                    el('label', {}, ['Designation', designation]),
                    el('label', {}, ['Area (optional)', area]),
                    el('label', {}, ['Description', description]),
                    el('label', {}, ['Status', visibility]),
                    el('div', { class: 'buttons' }, [submit, cancel]),
                    message
                ]);
                clear(content).append(
                    el('section', { class: 'card' }, [
                        el('div', { class: 'recruiting-list-head' }, [el('h2', { text: 'Job openings' }), newOpening]),
                        listing
                    ]),
                    el('section', { class: 'card' }, [formTitle, form])
                );
                draw();

                function setForm(opening) {
                    activeId = opening && opening.id;
                    designation.value = opening ? opening.designation : '';
                    area.value = opening && opening.area || '';
                    description.value = opening ? opening.description : '';
                    visibility.value = opening && opening.isOpen ? 'open' : 'closed';
                    formTitle.textContent = opening ? 'Edit opening' : 'Create opening';
                    submit.textContent = opening ? 'Save changes' : 'Create opening';
                    cancel.hidden = !opening;
                }

                function draw() {
                    clear(listing);
                    if (!openings.length) {
                        listing.appendChild(el('p', { class: 'note', text: 'No openings yet. Create your first position to get started.' }));
                        return;
                    }
                    openings.forEach(function (opening) {
                        var edit = el('button', { type: 'button', text: 'Edit', 'aria-label': 'Edit ' + opening.designation });
                        edit.addEventListener('click', function () {
                            if (saving) return;
                            setForm(opening);
                            message.textContent = '';
                            designation.focus();
                        });
                        listing.appendChild(el('div', { class: 'recruiting-row' }, [
                            el('div', {}, [
                                el('strong', { text: opening.designation }),
                                el('small', { class: 'note', text: (opening.area ? opening.area + ' · ' : '') + 'Updated ' + formatTime(opening.updatedAt) })
                            ]),
                            badge(opening.isOpen ? 'accepted' : '', opening.isOpen ? 'Open' : 'Closed'),
                            edit
                        ]));
                    });
                }

                function startNew() {
                    if (saving) return;
                    setForm();
                    message.textContent = '';
                    designation.focus();
                }
                cancel.addEventListener('click', startNew);
                newOpening.addEventListener('click', startNew);

                form.addEventListener('submit', async function (event) {
                    event.preventDefault();
                    if (saving) return;
                    var body = { id: activeId, designation: designation.value, area: area.value, description: description.value, isOpen: visibility.value === 'open' };
                    var controls = [designation, area, description, visibility, submit, cancel];
                    saving = true;
                    controls.forEach(function (control) { control.disabled = true; });
                    message.className = 'note recruiting-message';
                    message.textContent = 'Saving…';
                    var result = await api('recruiting', { method: 'POST', body: body });
                    controls.forEach(function (control) { control.disabled = false; });
                    saving = false;
                    if (!result.ok) {
                        message.className = 'error recruiting-message';
                        message.textContent = result.data.message || 'Could not save the opening.';
                        return;
                    }
                    var saved = result.data.opening;
                    var index = openings.findIndex(function (opening) { return opening.id === saved.id; });
                    if (index < 0) openings.unshift(saved);
                    else openings[index] = saved;
                    openings.sort(function (a, b) { return Number(b.isOpen) - Number(a.isOpen); });
                    draw();
                    setForm(saved);
                    message.textContent = saved.isOpen ? 'Saved. This opening is visible on Join Us.' : 'Saved. This opening is hidden from Join Us.';
                });
            }
        });
    }

    var page = document.body.getAttribute('data-page');
    if (page === 'products') productsPage();
    else if (page === 'recruiting') recruitingPage();
    else if (page === 'product-edit') productEditPage();
    else if (page === 'login') loginPage();
    else if (page === 'password') passwordPage();
    else if (page === 'overview') overviewPage();
    else if (page === 'analytics') analyticsPage();
    else if (page === 'inbox') inboxPage();
    else if (page === 'enquiry') enquiryPage();
}());

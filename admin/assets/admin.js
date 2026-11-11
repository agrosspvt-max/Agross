(function () {
    'use strict';

    var TIME_ZONE = 'Asia/Kolkata';
    var FORM_TYPES = [
        ['contact', 'General Contact'], ['dealership', 'Dealership'],
        ['farming', 'Contract or Custom Farming'], ['recruitment', 'Recruitment']
    ];
    var STATUS_LABELS = { 'new': 'New', in_progress: 'In progress', resolved: 'Resolved' };
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
        var nav = el('nav', {}, [
            el('a', { href: '/admin', 'aria-current': active === 'overview' ? 'page' : false, text: 'Overview' }),
            el('a', { href: '/admin/enquiries', 'aria-current': active === 'inbox' || active === 'enquiry' ? 'page' : false, text: 'Enquiries' })
        ]);
        top.appendChild(nav);
        var signOut = el('button', { type: 'button', text: 'Sign out' });
        signOut.addEventListener('click', function () {
            api('logout', { method: 'POST', body: {} }).then(function () { window.location.assign('/admin/login'); });
        });
        top.appendChild(el('div', { class: 'who' }, [currentUser.displayName, signOut]));
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

    // ---- inbox ---------------------------------------------------------------------

    function inboxPage() {
        start('inbox', function (main) {
            var params = new URLSearchParams(window.location.search);
            var defaults = presetRange('30');
            var from = params.has('from') || params.has('to') ? (params.get('from') || '') : defaults.from;
            var to = params.has('from') || params.has('to') ? (params.get('to') || '') : defaults.to;
            var page = Math.max(1, Number(params.get('page')) || 1);

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
            var statusSelect = select('status', 'Status', Object.keys(STATUS_LABELS).map(function (key) { return [key, STATUS_LABELS[key]]; }), params.get('status'));
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
                data.items.forEach(function (item) {
                    var detail = '/admin/enquiries/' + item.id;
                    var emailCell = el('td', { 'data-label': 'Email' }, [badge(item.emailState, EMAIL_LABELS[item.emailState] || item.emailState)]);
                    body.appendChild(el('tr', {}, [
                        el('td', { 'data-label': 'Submitted', text: formatTime(item.createdAt) }),
                        el('td', { 'data-label': 'Form', text: item.formTitle }),
                        el('td', {}, [el('a', { href: detail, text: item.name }), item.company && item.company !== item.name ? el('small', { text: item.company }) : '']),
                        el('td', { 'data-label': 'Contact' }, [item.email, item.phone ? el('small', { text: item.phone }) : '']),
                        el('td', { 'data-label': 'Status' }, [badge(item.status, STATUS_LABELS[item.status])]),
                        emailCell
                    ]));
                });
                results.appendChild(el('table', {}, [
                    el('thead', {}, [el('tr', {}, ['Submitted', 'Form', 'Name or company', 'Contact', 'Status', 'Email'].map(function (heading) { return el('th', { scope: 'col', text: heading }); }))]),
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
                if (enquiry.sourcePage) {
                    fields.appendChild(el('dt', { text: 'Sent from page' }));
                    fields.appendChild(el('dd', { text: enquiry.sourcePage }));
                }

                var statusMessage = el('p', { class: 'note' });
                var buttons = el('div', { class: 'buttons' }, Object.keys(STATUS_LABELS).map(function (key) {
                    var button = el('button', { type: 'button', 'aria-pressed': enquiry.status === key ? 'true' : 'false', text: STATUS_LABELS[key] });
                    button.addEventListener('click', function () {
                        api('enquiry-status', { method: 'POST', body: { id: enquiry.id, status: key } }).then(function (result) {
                            if (result.ok) load();
                            else statusMessage.textContent = result.data.message || 'The status could not be changed.';
                        });
                    });
                    return button;
                }));
                var statusCard = el('div', { class: 'card' }, [el('h2', { text: 'Follow-up status' }), buttons, statusMessage]);
                if (enquiry.statusChangedAt) {
                    statusMessage.textContent = 'Last changed ' + formatTime(enquiry.statusChangedAt) + (enquiry.statusChangedBy ? ' by ' + enquiry.statusChangedBy : '') + '.';
                }

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

    var page = document.body.getAttribute('data-page');
    if (page === 'login') loginPage();
    else if (page === 'password') passwordPage();
    else if (page === 'overview') overviewPage();
    else if (page === 'inbox') inboxPage();
    else if (page === 'enquiry') enquiryPage();
}());

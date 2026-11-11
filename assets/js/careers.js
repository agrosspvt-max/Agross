(function () {
    'use strict';

    function element(tag, className, text) {
        var node = document.createElement(tag);
        node.className = className;
        node.textContent = text;
        return node;
    }

    function openingUrl(opening) {
        return '/joinus.html?opening=' + encodeURIComponent(opening.id);
    }

    function roleName(opening) {
        return opening.designation + (opening.area ? ' in ' + opening.area : '');
    }

    function openingCard(opening) {
        var card = element('a', 'careers-job', '');
        card.href = openingUrl(opening);
        card.setAttribute('aria-label', 'View details for ' + roleName(opening));
        if (opening.area) card.appendChild(element('p', 'careers-area', opening.area));
        card.append(
            element('h3', 'careers-job-title', opening.designation),
            element('p', 'careers-description careers-preview', opening.description),
            element('span', 'careers-view-link', 'View details →')
        );
        return card;
    }

    function renderOpening(list, openings, openingId) {
        var opening = openings.find(function (item) { return item.id === openingId.toLowerCase(); });
        list.className = openings.length ? 'careers-board has-sidebar' : 'careers-board';

        var panel = element('article', 'careers-detail', '');
        panel.setAttribute('aria-labelledby', 'careers-detail-title');
        var heading = element('div', 'careers-detail-heading', '');
        var title = element('h1', '', opening ? opening.designation : 'Opening unavailable');
        title.id = 'careers-detail-title';
        if (opening && opening.area) heading.appendChild(element('p', 'careers-area', opening.area));
        heading.appendChild(title);
        panel.appendChild(heading);

        if (opening) {
            document.title = opening.designation + ' | Careers at Agross';
            var apply = element('a', 'careers-apply', 'Apply now');
            apply.href = '/Form-4.html?opening=' + encodeURIComponent(opening.id);
            apply.setAttribute('aria-label', 'Apply now for ' + roleName(opening));
            heading.appendChild(apply);

            var description = element('div', 'careers-detail-body', '');
            description.append(
                element('h2', '', 'Job description'),
                element('p', 'careers-description', opening.description)
            );
            panel.appendChild(description);
        } else {
            heading.appendChild(element('p', 'careers-description', 'This position is no longer open.'));
        }
        list.appendChild(panel);
        if (!openings.length) return;

        var sidebar = element('nav', 'careers-sidebar', '');
        sidebar.setAttribute('aria-labelledby', 'careers-sidebar-title');
        var sidebarTitle = element('h2', '', 'Current openings');
        sidebarTitle.id = 'careers-sidebar-title';
        var sidebarList = element('ul', 'careers-sidebar-list', '');
        openings.forEach(function (item) {
            var entry = element('li', '', '');
            var link = element('a', 'careers-sidebar-link', '');
            link.href = openingUrl(item);
            if (item === opening) link.setAttribute('aria-current', 'page');
            if (item.area) link.appendChild(element('span', 'careers-area', item.area));
            link.appendChild(element('span', 'careers-job-title', item.designation));
            entry.appendChild(link);
            sidebarList.appendChild(entry);
        });
        sidebar.append(sidebarTitle, sidebarList);
        list.appendChild(sidebar);
    }

    function showOpenings(list) {
        var status = document.querySelector('[data-careers-status]');
        var openingId = new URLSearchParams(window.location.search).get('opening');
        if (openingId !== null) {
            document.body.classList.add('careers-detail-mode');
            var back = element('a', 'careers-back', '← All current openings');
            back.href = '/joinus.html#allpositions';
            status.before(back);
        }
        status.textContent = 'Loading current openings…';
        status.hidden = false;
        fetch('/api/openings', { headers: { Accept: 'application/json' } })
            .then(function (response) {
                if (!response.ok) throw new Error();
                return response.json();
            })
            .then(function (data) {
                if (openingId !== null) {
                    renderOpening(list, data.openings, openingId);
                } else if (!data.openings.length) {
                    document.querySelector('[data-careers-empty]').hidden = false;
                } else {
                    document.querySelector('[data-careers-list-hint]').hidden = false;
                    data.openings.forEach(function (opening) { list.appendChild(openingCard(opening)); });
                }
                status.hidden = true;
            })
            .catch(function () {
                status.textContent = 'We couldn’t load current openings. Please refresh the page or check back later.';
            });
    }

    var list = document.querySelector('[data-careers-list]');
    if (list) showOpenings(list);

    var form = document.querySelector('[data-careers-application]');
    if (!form) return;
    var notice = document.querySelector('[data-careers-application-status]');
    var params = new URLSearchParams(window.location.search);
    if (!params.has('opening')) {
        notice.hidden = true;
        form.hidden = false;
        return;
    }

    var openingId = params.get('opening');
    notice.textContent = 'Loading the opening…';
    fetch('/api/openings?id=' + encodeURIComponent(openingId), { headers: { Accept: 'application/json' } })
        .then(function (response) {
            if (response.status === 404) throw new Error('closed');
            if (!response.ok) throw new Error();
            return response.json();
        })
        .then(function (data) {
            var opening = data.opening;
            var role = form.querySelector('[data-careers-role]');
            var input = element('input', '', '');
            input.type = 'hidden';
            input.name = 'openingId';
            input.value = opening.id;
            form.prepend(input);
            form.querySelector('[name="profile"]').disabled = true;
            form.querySelector('[data-careers-profile]').hidden = true;
            role.textContent = 'Applying for: ' + opening.designation;
            if (opening.area) role.appendChild(element('span', '', 'Area: ' + opening.area));
            role.hidden = false;
            notice.hidden = true;
            form.hidden = false;
        })
        .catch(function (error) {
            notice.textContent = error.message === 'closed'
                ? 'This position is no longer open. '
                : 'We couldn’t load this opening. Refresh to try again, or ';
            var back = element('a', '', 'see available positions');
            back.href = '/joinus.html';
            notice.append(back, '.');
        });
}());

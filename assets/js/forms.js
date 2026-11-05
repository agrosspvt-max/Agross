(function () {
    'use strict';

    document.querySelectorAll('form[data-enquiry-form]').forEach(function (form) {
        var status = form.querySelector('[data-form-status]');
        var button = form.querySelector('button[type="submit"]');

        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (form.dataset.sending === 'true') return;

            form.dataset.sending = 'true';
            button.disabled = true;
            form.setAttribute('aria-busy', 'true');
            status.hidden = false;
            status.textContent = 'Sending your enquiry…';

            try {
                var response = await fetch(form.action, {
                    method: 'POST',
                    headers: { Accept: 'application/json' },
                    body: new URLSearchParams(new FormData(form))
                });
                var result = await response.json();
                if (!response.ok || result.redirect !== '/thankyou.html') {
                    throw new Error(result.message || 'We could not send your enquiry. Please try again later or email info@agromaxx.in.');
                }
                window.location.assign('/thankyou.html');
            } catch (error) {
                status.textContent = error instanceof TypeError || error instanceof SyntaxError
                    ? 'We could not confirm your enquiry. Please check your connection or email info@agromaxx.in.'
                    : error.message;
                button.disabled = false;
                form.dataset.sending = 'false';
                form.removeAttribute('aria-busy');
            }
        });
    });
}());

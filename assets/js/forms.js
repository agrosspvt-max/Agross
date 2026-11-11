(function () {
    'use strict';

    // One key per page view. A double click or a retry after a lost reply carries the same key,
    // so the server saves the enquiry only once.
    function submissionKey(form) {
        if (!form.dataset.submissionKey) {
            var random = window.crypto && window.crypto.randomUUID
                ? window.crypto.randomUUID()
                : 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
            form.dataset.submissionKey = random;
        }
        return form.dataset.submissionKey;
    }

    function readResume(file) {
        if (!/\.pdf$/i.test(file.name)) throw new Error('Please attach a PDF resume.');
        if (file.size > 2 * 1024 * 1024) throw new Error('Please choose a PDF resume that is 2 MB or smaller.');
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve({ name: file.name, content: String(reader.result).split(',')[1] }); };
            reader.onerror = function () { reject(new Error('The resume could not be read. Please select it again.')); };
            reader.readAsDataURL(file);
        });
    }

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
                var data = new URLSearchParams(new FormData(form));
                data.delete('resume');
                data.set('submissionKey', submissionKey(form));
                var headers = { Accept: 'application/json' };
                var resume = form.querySelector('input[type="file"][name="resume"]')?.files?.[0];
                if (resume) {
                    var values = Object.fromEntries(data);
                    values.resume = await readResume(resume);
                    data = JSON.stringify(values);
                    headers['Content-Type'] = 'application/json';
                }
                var response = await fetch(form.action, {
                    method: 'POST',
                    headers: headers,
                    body: data
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

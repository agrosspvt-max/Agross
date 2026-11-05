'use strict';

const RECIPIENT = 'info@agromaxx.in';
const MAX_BODY_BYTES = 20 * 1024;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const PLACEHOLDERS = new Set(['State', 'SelectState', 'Select State', 'District', 'Select district', 'Select Profile']);

const FORMS = {
    contact: {
        subject: 'Contact Us Request',
        optional: ['website', 'phone'],
        fields: [['name', 'Name', 120], ['email', 'Email', 254], ['website', 'Website', 500], ['phone', 'Phone No', 40], ['message', 'Message', 5000]]
    },
    dealership: {
        subject: 'Dealership Request',
        fields: [['name', 'Name', 120], ['firm', 'Firm Name', 200], ['mobile', 'Mobile No', 40], ['state', 'State', 100], ['district', 'District', 100], ['teshil', 'Tehsil', 150], ['email', 'Email', 254], ['dealers', 'Dealer Type', 100], ['remark', 'Remark', 5000]]
    },
    farming: {
        subject: 'Contract/Custom farming Request',
        fields: [['name', 'Company Name', 200], ['email', 'Email', 254], ['mobile', 'Mobile No', 40], ['authorised', 'Authorised Person', 120], ['produce', 'Produce', 200], ['quantity', 'Approx Quantity', 200], ['address', 'Address', 2000]]
    },
    recruitment: {
        subject: 'Join Us Request',
        fields: [['name', 'Name', 120], ['contact', 'Contact No', 40], ['email', 'Email', 254], ['profile', 'Profile', 150], ['state', 'State', 100], ['address', 'Address', 2000]]
    }
};

function respond(req, res, status, message) {
    if ((req.headers.accept || '').includes('application/json')) {
        return res.status(status).json({ message });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(status).send(message + '\nPlease go back to the form; your submission has not been confirmed.');
}

function success(req, res) {
    if ((req.headers.accept || '').includes('application/json')) {
        return res.status(200).json({ redirect: '/thankyou.html' });
    }
    res.setHeader('Location', '/thankyou.html');
    return res.status(303).end();
}

module.exports = async function enquiry(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return respond(req, res, 405, 'Please submit an enquiry using the website form.');
    }

    // Browser submissions must come from the same website, including preview deployments.
    if (req.headers.origin) {
        try {
            if (new URL(req.headers.origin).host !== req.headers.host) {
                return respond(req, res, 403, 'Please submit this form from the Agross website.');
            }
        } catch {
            return respond(req, res, 403, 'Please submit this form from the Agross website.');
        }
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
        return respond(req, res, 403, 'Please submit this form from the Agross website.');
    }

    const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['application/x-www-form-urlencoded', 'application/json'].includes(contentType)) {
        return respond(req, res, 415, 'This form submission could not be read.');
    }

    // Vercel parses both supported content types into request.body.
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return respond(req, res, 400, 'Please complete the enquiry form.');
    }
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
        return respond(req, res, 413, 'Your enquiry is too long. Please shorten it and try again.');
    }
    if (typeof body.formType !== 'string' || !Object.hasOwn(FORMS, body.formType)) {
        return respond(req, res, 400, 'Please use one of the enquiry forms on the website.');
    }
    // A hidden field catches basic automated submissions without affecting visitors.
    if (body.fax) {
        return success(req, res);
    }

    const form = FORMS[body.formType];
    const values = {};
    for (const [field, label, maxLength] of form.fields) {
        const value = body[field];
        if (form.optional?.includes(field) && (value === undefined || (typeof value === 'string' && !value.trim()))) {
            continue;
        }
        if (typeof value !== 'string' || !value.trim() || PLACEHOLDERS.has(value.trim())) {
            return respond(req, res, 400, 'Please enter a valid ' + label.toLowerCase() + '.');
        }
        values[field] = value.trim();
        if (values[field].length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(values[field])) {
            return respond(req, res, 400, label + ' is too long or contains unsupported characters.');
        }
    }
    if (!EMAIL_PATTERN.test(values.email) || /[\r\n]/.test(values.email)) {
        return respond(req, res, 400, 'Please enter a valid email address.');
    }

    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.FORM_FROM_EMAIL;
    if (!apiKey || !sender || sender.length > 254 || !EMAIL_PATTERN.test(sender)) {
        return respond(req, res, 503, 'We could not send your enquiry right now. Please email info@agromaxx.in directly.');
    }

    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
            body: JSON.stringify({
                sender: { name: 'Agross Website', email: sender },
                to: [{ email: RECIPIENT }],
                replyTo: { email: values.email },
                subject: form.subject,
                textContent: form.subject + '\n\n' + form.fields
                    .filter(([field]) => Object.hasOwn(values, field))
                    .map(([field, label]) => label + ': ' + values[field])
                    .join('\n\n')
            })
        });
        if (!response.ok) {
            console.error('Enquiry email provider rejected the request', { status: response.status });
            return respond(req, res, 502, 'We could not send your enquiry right now. Please try again later or email info@agromaxx.in.');
        }
        const result = await response.json();
        if (!result.messageId) {
            return respond(req, res, 502, 'Your enquiry could not be confirmed. Please email info@agromaxx.in directly.');
        }
        return success(req, res);
    } catch (error) {
        const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
        console.error('Enquiry email request failed', { timeout: timedOut });
        return respond(req, res, timedOut ? 504 : 502, 'Your enquiry could not be confirmed. Please try again later or email info@agromaxx.in.');
    }
};

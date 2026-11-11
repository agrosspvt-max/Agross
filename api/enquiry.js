'use strict';

const crypto = require('node:crypto');
const { isFormType, validate, validateResume } = require('../lib/forms');
const { validId } = require('../lib/recruiting');

const MAX_BODY_BYTES = 20 * 1024;
const SUBMISSION_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const SUBMISSIONS_PER_WINDOW = 10;
const WINDOW_SECONDS = 15 * 60;

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

// Only the path of the page the visitor came from is kept, never its query string.
function sourcePage(req) {
    try {
        const path = new URL(req.headers.referer || '').pathname;
        return path.slice(0, 200);
    } catch {
        return null;
    }
}

function defaultDependencies() {
    // Loaded lazily so tests of the validation rules need no database.
    const { saveEnquiry } = require('../lib/inbox');
    const { deliver } = require('../lib/notify');
    const { ipHash, hit } = require('../lib/security');
    return {
        save: saveEnquiry,
        deliver,
        tooManyRequests: async req => (await hit('enquiry:ip:' + ipHash(req), WINDOW_SECONDS)).count > SUBMISSIONS_PER_WINDOW
    };
}

function createHandler(overrides = {}) {
    return async function enquiry(req, res) {
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
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return respond(req, res, 400, 'Please complete the enquiry form.');
        }
        const { resume: upload, ...body } = req.body;
        if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
            return respond(req, res, 413, 'Your enquiry is too long. Please shorten it and try again.');
        }
        if (!isFormType(body.formType)) {
            return respond(req, res, 400, 'Please use one of the enquiry forms on the website.');
        }
        // A hidden field catches basic automated submissions without affecting visitors.
        if (body.fax) {
            return success(req, res);
        }

        const openingId = body.openingId;
        if (openingId !== undefined && (body.formType !== 'recruitment' || !validId(openingId))) {
            return respond(req, res, 400, 'Please choose an opening from the Join Us page.');
        }
        const checked = validate(body, { hasOpening: Boolean(openingId) });
        if (checked.error) {
            return respond(req, res, 400, checked.error);
        }
        const attachment = validateResume(body.formType, upload);
        if (attachment.error) {
            return respond(req, res, attachment.status || 400, attachment.error);
        }

        const dependencies = { ...defaultDependencies(), ...overrides };
        const submissionKey = typeof body.submissionKey === 'string' && SUBMISSION_KEY_PATTERN.test(body.submissionKey)
            ? body.submissionKey
            : 'server-' + crypto.randomUUID();

        let saved;
        try {
            if (await dependencies.tooManyRequests(req)) {
                res.setHeader('Retry-After', String(WINDOW_SECONDS));
                return respond(req, res, 429, 'Too many submissions from this connection. Please try again later or email info@agromaxx.in.');
            }
            saved = await dependencies.save({ submissionKey, formType: body.formType, values: checked.values, sourcePage: sourcePage(req), resume: attachment.resume, openingId });
        } catch (error) {
            console.error('Enquiry could not be saved', { code: error && error.code });
            return respond(req, res, 503, 'We could not save your enquiry right now. Please try again later or email info@agromaxx.in.');
        }

        if (saved.closedOpening) return respond(req, res, 409, 'This position is no longer open. Please return to Join Us to see available positions.');

        // The enquiry is safe in the database. An email problem only changes the notification's state,
        // which staff can see and retry in the dashboard, so the visitor is still told it was received.
        if (saved.created) {
            try {
                await dependencies.deliver(saved.id);
            } catch (error) {
                console.error('Enquiry notification could not be attempted', { code: error && error.code });
            }
        }
        return success(req, res);
    };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;

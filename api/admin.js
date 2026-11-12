'use strict';

// One function for every /api/admin/<route> call (vercel.json rewrites them here).
// Each route except "login" requires a valid session; changes also require the CSRF token.

const auth = require('../lib/auth');
const inbox = require('../lib/inbox');
const notify = require('../lib/notify');
const adminProducts = require('../lib/admin-products');
const recruiting = require('../lib/recruiting');

const { authenticate, sendError } = auth;
const UUID = /^[0-9a-f-]{36}$/i;

function queryParams(req) {
    if (req.query && typeof req.query === 'object') return req.query;
    return Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
}

function first(value) {
    return Array.isArray(value) ? value[0] : value;
}

function jsonBody(req) {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    return type === 'application/json' && req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
}

async function login(req, res) {
    const body = jsonBody(req);
    if (!body) return sendError(res, 400, 'Enter your username and password.');
    if (!(req.headers.origin && new URL(req.headers.origin).host === req.headers.host)) {
        return sendError(res, 403, 'This request could not be verified. Reload the page and try again.');
    }
    const result = await auth.login(req, body.username, body.password);
    if (!result.ok) {
        if (result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter));
        return sendError(res, result.status, result.message);
    }
    res.setHeader('Set-Cookie', auth.sessionCookie(result.token, auth.SESSION_ABSOLUTE_HOURS * 3600));
    return res.status(200).json({ user: result.user });
}

async function route(req, res, name) {
    const method = req.method;
    const params = queryParams(req);

    if (name === 'login') {
        if (method !== 'POST') return methodNotAllowed(res, 'POST');
        return login(req, res);
    }

    if (name === 'me') {
        if (method !== 'GET') return methodNotAllowed(res, 'GET');
        const session = await authenticate(req, res, { allowPasswordChange: true });
        return session && res.status(200).json({ user: session.user, csrfToken: session.csrfToken });
    }

    if (name === 'logout') {
        if (method !== 'POST') return methodNotAllowed(res, 'POST');
        const session = await authenticate(req, res, { allowPasswordChange: true });
        if (!session) return null;
        await auth.logout(req);
        res.setHeader('Set-Cookie', auth.sessionCookie('', 0));
        return res.status(200).json({ ok: true });
    }

    if (name === 'change-password') {
        if (method !== 'POST') return methodNotAllowed(res, 'POST');
        const session = await authenticate(req, res, { allowPasswordChange: true });
        if (!session) return null;
        const body = jsonBody(req);
        if (!body) return sendError(res, 400, 'Enter your current and new password.');
        const result = await auth.changePassword(session, body.currentPassword, body.newPassword);
        return result.ok ? res.status(200).json({ ok: true }) : sendError(res, result.status, result.message);
    }

    if (name === 'overview') {
        if (method !== 'GET') return methodNotAllowed(res, 'GET');
        const session = await authenticate(req, res, { permission: 'enquiries' });
        if (!session) return null;
        const parsed = inbox.parseFilters({ from: first(params.from), to: first(params.to) });
        if (parsed.error) return sendError(res, 400, parsed.error);
        return res.status(200).json(await inbox.overview(parsed.filters, session.user));
    }

    if (name === 'enquiries') {
        if (method !== 'GET') return methodNotAllowed(res, 'GET');
        const session = await authenticate(req, res, { permission: 'enquiries' });
        if (!session) return null;
        const parsed = inbox.parseFilters({
            from: first(params.from), to: first(params.to), form: first(params.form),
            status: first(params.status), email: first(params.email), q: first(params.q)
        });
        if (parsed.error) return sendError(res, 400, parsed.error);
        await notify.sweepStale();
        return res.status(200).json(await inbox.listEnquiries(parsed.filters, session.user, first(params.page), first(params.pageSize)));
    }

    if (name === 'enquiry') {
        if (method !== 'GET') return methodNotAllowed(res, 'GET');
        const session = await authenticate(req, res, { permission: 'enquiries' });
        if (!session) return null;
        await notify.sweepStale();
        const found = UUID.test(String(first(params.id))) ? await inbox.getEnquiry(first(params.id), session.user) : null;
        return found ? res.status(200).json(found) : sendError(res, 404, 'Enquiry not found.');
    }

    if (name === 'enquiry-resume') {
        if (method !== 'GET') return methodNotAllowed(res, 'GET');
        const session = await authenticate(req, res, { permission: 'enquiries' });
        if (!session) return null;
        const id = first(params.id);
        const resume = UUID.test(String(id)) ? await inbox.getResume(id, session.user) : null;
        if (!resume) return sendError(res, 404, 'Resume not found.');
        const view = first(params.view) === '1';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', (view ? 'inline' : 'attachment') + '; filename="' + resume.filename + '"');
        // Chromium's PDF viewer needs a top-level document without a CSP sandbox.
        res.setHeader('Content-Security-Policy', view ? "frame-ancestors 'none'" : "default-src 'none'; sandbox");
        res.setHeader('Referrer-Policy', 'no-referrer');
        return res.status(200).send(resume.data);
    }

    if (name === 'enquiry-status') {
        if (method !== 'POST') return methodNotAllowed(res, 'POST');
        const session = await authenticate(req, res, { permission: 'enquiries' });
        if (!session) return null;
        const body = jsonBody(req);
        if (!body || !UUID.test(String(body.id))) return sendError(res, 400, 'Choose an enquiry.');
        const result = await inbox.setStatus(body.id, body.status, session.user, { note: body.note, expectedStatus: body.expectedStatus });
        if (!result.ok) return sendError(res, result.status, result.message);
        return res.status(200).json({ ok: true, followUp: result.followUp });
    }

    if (name === 'enquiry-retry') {
        if (method !== 'POST') return methodNotAllowed(res, 'POST');
        const session = await authenticate(req, res, { permission: 'enquiries' });
        if (!session) return null;
        const body = jsonBody(req);
        if (!body || !UUID.test(String(body.id))) return sendError(res, 400, 'Choose an enquiry.');
        const found = await inbox.getEnquiry(body.id, session.user);
        if (!found) return sendError(res, 404, 'Enquiry not found.');
        const state = found.notification.state;
        if (state === 'accepted' || state === 'delivered') return sendError(res, 409, 'This email was already sent.');
        if (state === 'pending' && found.notification.attempts > 0) return sendError(res, 409, 'This email is being sent right now.');
        if (state === 'unconfirmed' && body.confirm !== true) {
            return sendError(res, 409, 'The earlier attempt may have been sent. Retrying could send a duplicate email.', { code: 'confirm_required' });
        }
        const result = await notify.deliver(body.id, { acceptUnconfirmed: body.confirm === true });
        await auth.audit(session.user.id, 'notification_retry', 'enquiry', body.id, { result: result.state });
        return res.status(200).json({ state: result.state });
    }

    if (name === 'recruiting') {
        if (method !== 'GET' && method !== 'POST') return methodNotAllowed(res, 'GET, POST');
        const session = await authenticate(req, res, { permission: 'recruitment' });
        if (!session) return null;
        if (method === 'GET') return res.status(200).json({ openings: await recruiting.adminOpenings() });
        const checked = recruiting.validateOpening(jsonBody(req));
        if (checked.error) return sendError(res, 400, checked.error);
        const opening = await recruiting.saveOpening(checked.opening, session.user.id);
        if (!opening) return sendError(res, 404, 'Opening not found.');
        return res.status(checked.opening.id ? 200 : 201).json({ opening });
    }

    if (name.startsWith('product') || name === 'catalogue-live') {
        if (await adminProducts.handle(name, req, res, { params, first, jsonBody })) return null;
    }

    return sendError(res, 404, 'Not found.');
}

function methodNotAllowed(res, allowed) {
    res.setHeader('Allow', allowed);
    return sendError(res, 405, 'Method not allowed.');
}

module.exports = async function admin(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
        const name = String(first(queryParams(req).route) || '').replace(/[^a-z-]/g, '');
        return await route(req, res, name);
    } catch (error) {
        console.error('Admin request failed', { code: error && error.code, name: error && error.name });
        return sendError(res, 500, 'Something went wrong. Please try again.');
    }
};

'use strict';

// Serves the admin pages. Every page except the sign-in page is checked on the server first;
// someone who knows a URL but is not signed in only ever receives a redirect to the sign-in page.

const fs = require('node:fs');
const path = require('node:path');
const { findSession, hasPermission } = require('../lib/auth');

const VIEWS = path.join(__dirname, '..', 'admin', 'views');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function viewFor(pathname) {
    const clean = pathname.replace(/^\/+|\/+$/g, '');
    if (clean === 'admin') return { file: 'overview.html', permission: 'enquiries' };
    if (clean === 'admin/enquiries') return { file: 'inbox.html', permission: 'enquiries' };
    if (new RegExp('^admin/enquiries/' + UUID + '$', 'i').test(clean)) return { file: 'enquiry.html', permission: 'enquiries' };
    if (clean === 'admin/login') return { file: 'login.html', public: true };
    if (clean === 'admin/password') return { file: 'password.html', passwordPage: true };
    return null;
}

function send(res, status, body, type = 'text/html; charset=utf-8') {
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return res.status(status).send(body);
}

function redirect(res, location) {
    res.setHeader('Location', location);
    return send(res, 302, '', 'text/plain; charset=utf-8');
}

module.exports = async function adminPage(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return send(res, 405, 'Method not allowed.', 'text/plain; charset=utf-8');
    }
    let pathname;
    try {
        // vercel.json rewrites pass the requested admin path in ?p=; fall back to the URL itself.
        const asked = req.query && typeof req.query.p === 'string' ? req.query.p : null;
        pathname = asked !== null
            ? '/admin' + (asked ? '/' + decodeURIComponent(asked) : '')
            : decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    } catch {
        return send(res, 400, 'Bad request.', 'text/plain; charset=utf-8');
    }
    const view = viewFor(pathname);
    if (!view) return send(res, 404, 'Not found.', 'text/plain; charset=utf-8');

    try {
        const session = await findSession(req);
        if (view.public) {
            if (session) return redirect(res, session.user.mustChangePassword ? '/admin/password' : '/admin');
        } else {
            if (!session) return redirect(res, '/admin/login?next=' + encodeURIComponent(pathname));
            if (session.user.mustChangePassword && !view.passwordPage) return redirect(res, '/admin/password');
            if (view.permission && !hasPermission(session.user, view.permission)) {
                return send(res, 403, 'You do not have access to this page.', 'text/plain; charset=utf-8');
            }
        }
        return send(res, 200, fs.readFileSync(path.join(VIEWS, view.file), 'utf8'));
    } catch (error) {
        console.error('Admin page failed', { code: error && error.code });
        return send(res, 500, 'Something went wrong. Please try again.', 'text/plain; charset=utf-8');
    }
};

'use strict';

// Admin sign-in: password hashing, throttling, sessions and request checks.
// Every admin page and API route goes through authenticate().

const crypto = require('node:crypto');
const { query } = require('./db');
const { isHosted, ipHash, sha256, safeEqual, hit, peek, reset } = require('./security');

const ALL_PERMISSIONS = ['accounts', 'enquiries', 'recruitment', 'products_edit', 'products_publish'];

const SCRYPT = { N: 32768, r: 8, p: 1, keyLength: 64 };
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;

const SESSION_ABSOLUTE_HOURS = 12;
const SESSION_IDLE_HOURS = 2;

const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_USER_LIMIT = 5;
const LOGIN_IP_LIMIT = 20;

function scryptAsync(password, salt, params) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password.normalize('NFKC'), salt, params.keyLength,
            { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r }, (error, key) => error ? reject(error) : resolve(key));
    });
}

// Stored as scrypt$N$r$p$salt$hash so the cost can be raised later without a migration.
async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scryptAsync(password, salt, SCRYPT);
    return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const params = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), keyLength: 64 };
    if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) return false;
    const expected = Buffer.from(parts[5], 'base64');
    params.keyLength = expected.length;
    const actual = await scryptAsync(password, Buffer.from(parts[4], 'base64'), params);
    return crypto.timingSafeEqual(actual, expected);
}

let dummyHash = null;
async function dummyVerify(password) {
    // Spend the same time for unknown users as for real ones.
    dummyHash = dummyHash || await hashPassword('not-a-real-password-for-timing-only');
    await verifyPassword(password, dummyHash);
}

function passwordProblem(password, username) {
    if (typeof password !== 'string') return 'Enter a password.';
    if (password.length < MIN_PASSWORD_LENGTH) return 'Use at least ' + MIN_PASSWORD_LENGTH + ' characters.';
    if (password.length > MAX_PASSWORD_LENGTH) return 'That password is too long.';
    if (username && password.toLowerCase() === String(username).toLowerCase()) return 'The password must differ from the username.';
    return null;
}

function cookieName() {
    return isHosted() ? '__Host-agross_admin' : 'agross_admin';
}

function sessionCookie(token, maxAgeSeconds) {
    const attributes = ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=' + maxAgeSeconds];
    if (isHosted()) attributes.push('Secure');
    return cookieName() + '=' + token + '; ' + attributes.join('; ');
}

function readCookie(req, name) {
    for (const part of String(req.headers.cookie || '').split(';')) {
        const index = part.indexOf('=');
        if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
    }
    return null;
}

function publicUser(row) {
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        permissions: row.permissions,
        mustChangePassword: row.must_change_password
    };
}

function hasPermission(user, permission) {
    return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

async function audit(actorId, action, entityType = null, entityId = null, metadata = {}) {
    await query(
        'INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)',
        [actorId, action, entityType, entityId === null ? null : String(entityId), JSON.stringify(metadata)]
    );
}

// Returns { ok: true, token, user } or { ok: false, status, message, retryAfter? }
async function login(req, username, password) {
    const normalized = typeof username === 'string' ? username.trim().toLowerCase().slice(0, 100) : '';
    const supplied = typeof password === 'string' ? password.slice(0, MAX_PASSWORD_LENGTH + 1) : '';
    const userKey = 'login:user:' + normalized;
    const addressKey = 'login:ip:' + ipHash(req);

    const [userState, addressState] = await Promise.all([peek(userKey, LOGIN_WINDOW_SECONDS), peek(addressKey, LOGIN_WINDOW_SECONDS)]);
    if (userState.count >= LOGIN_USER_LIMIT || addressState.count >= LOGIN_IP_LIMIT) {
        const started = userState.count >= LOGIN_USER_LIMIT ? userState.window_start : addressState.window_start;
        const retryAfter = Math.max(1, Math.ceil(LOGIN_WINDOW_SECONDS - (Date.now() - new Date(started).getTime()) / 1000));
        return { ok: false, status: 429, message: 'Too many sign-in attempts. Please wait and try again.', retryAfter };
    }

    const { rows } = normalized
        ? await query('SELECT * FROM admin_users WHERE lower(username) = $1 AND active', [normalized])
        : { rows: [] };
    const user = rows[0];
    let valid = false;
    if (user && supplied) valid = await verifyPassword(supplied, user.password_hash);
    else await dummyVerify(supplied || 'x');

    if (!valid) {
        await Promise.all([hit(userKey, LOGIN_WINDOW_SECONDS), hit(addressKey, LOGIN_WINDOW_SECONDS)]);
        await query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");
        await audit(user ? user.id : null, 'login_failed', 'admin_user', user ? user.id : null, {});
        return { ok: false, status: 401, message: 'The username or password is not correct.' };
    }

    await reset(userKey);
    const token = crypto.randomBytes(32).toString('base64url');
    await query(
        `INSERT INTO admin_sessions (user_id, token_hash, csrf_token, expires_at, ip_hash, user_agent)
         VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, $6)`,
        [user.id, sha256(token), crypto.randomBytes(24).toString('base64url'), SESSION_ABSOLUTE_HOURS, ipHash(req), String(req.headers['user-agent'] || '').slice(0, 200)]
    );
    await query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [user.id]);
    await audit(user.id, 'login', 'admin_user', user.id);
    return { ok: true, token, user: publicUser(user) };
}

async function findSession(req) {
    const token = readCookie(req, cookieName());
    if (!token || token.length > 100) return null;
    const { rows } = await query(
        `SELECT s.id AS session_id, s.csrf_token, s.last_seen_at, u.*
         FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
           AND s.last_seen_at > now() - make_interval(hours => $2) AND u.active`,
        [sha256(token), SESSION_IDLE_HOURS]
    );
    if (!rows[0]) return null;
    if (Date.now() - new Date(rows[0].last_seen_at).getTime() > 60000) {
        await query('UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1', [rows[0].session_id]);
    }
    return { sessionId: rows[0].session_id, csrfToken: rows[0].csrf_token, user: publicUser(rows[0]) };
}

function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return false;
    try {
        return new URL(origin).host === req.headers.host;
    } catch {
        return false;
    }
}

function sendError(res, status, message, extra = {}) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json({ message, ...extra });
}

/*
 * Checks session, (for changes) origin and CSRF token, forced password change and permission.
 * Sends the error response itself and returns null when the request must stop.
 */
async function authenticate(req, res, { permission = null, allowPasswordChange = false } = {}) {
    const session = await findSession(req);
    if (!session) {
        sendError(res, 401, 'Please sign in.');
        return null;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (!sameOrigin(req) || !safeEqual(req.headers['x-csrf-token'] || '', session.csrfToken)) {
            sendError(res, 403, 'This request could not be verified. Reload the page and try again.');
            return null;
        }
    }
    if (session.user.mustChangePassword && !allowPasswordChange) {
        sendError(res, 403, 'Choose a new password before continuing.', { code: 'password_change_required' });
        return null;
    }
    if (permission && !hasPermission(session.user, permission)) {
        sendError(res, 403, 'You do not have access to this.');
        return null;
    }
    return session;
}

async function logout(req) {
    const token = readCookie(req, cookieName());
    if (token) await query('UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
}

async function changePassword(session, currentPassword, newPassword) {
    const { rows } = await query('SELECT * FROM admin_users WHERE id = $1', [session.user.id]);
    const user = rows[0];
    if (!user || typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, user.password_hash))) {
        return { ok: false, status: 400, message: 'The current password is not correct.' };
    }
    const problem = passwordProblem(newPassword, user.username);
    if (problem) return { ok: false, status: 400, message: problem };
    if (newPassword === currentPassword) return { ok: false, status: 400, message: 'Choose a different password.' };
    await query('UPDATE admin_users SET password_hash = $1, must_change_password = false WHERE id = $2', [await hashPassword(newPassword), user.id]);
    await query('UPDATE admin_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [user.id, session.sessionId]);
    await audit(user.id, 'password_changed', 'admin_user', user.id);
    return { ok: true };
}

module.exports = {
    ALL_PERMISSIONS, SESSION_ABSOLUTE_HOURS, MIN_PASSWORD_LENGTH,
    hashPassword, verifyPassword, passwordProblem, sessionCookie, cookieName,
    hasPermission, audit, login, findSession, authenticate, logout, changePassword, sendError
};

'use strict';

// Small security helpers shared by the public and admin endpoints.

const crypto = require('node:crypto');
const { query } = require('./db');

function isHosted() {
    return Boolean(process.env.VERCEL_ENV) || process.env.ADMIN_COOKIE_SECURE === '1';
}

// Raw IP addresses are never stored; only a salted hash is used for throttling.
function ipHash(req) {
    const salt = process.env.IP_HASH_SALT || (isHosted() ? '' : 'local-development-salt');
    if (!salt) throw new Error('IP_HASH_SALT is not set');
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const address = forwarded || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
    return crypto.createHmac('sha256', salt).update(String(address)).digest('hex').slice(0, 32);
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Fixed-window counters in PostgreSQL. Returns the count after this hit.
async function hit(key, windowSeconds) {
    const { rows } = await query(
        `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
         ON CONFLICT (key) DO UPDATE SET
           window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END,
           count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END
         RETURNING count, window_start`,
        [key, windowSeconds]
    );
    return rows[0];
}

// Current count without adding to it.
async function peek(key, windowSeconds) {
    const { rows } = await query(
        `SELECT count, window_start FROM rate_limits
         WHERE key = $1 AND window_start >= now() - make_interval(secs => $2)`,
        [key, windowSeconds]
    );
    return rows[0] || { count: 0, window_start: null };
}

async function reset(key) {
    await query('DELETE FROM rate_limits WHERE key = $1', [key]);
}

module.exports = { isHosted, ipHash, sha256, safeEqual, hit, peek, reset };

'use strict';

// Resets an admin password from a trusted terminal. There is deliberately no public reset page.
// A temporary password is printed once; the person must choose a new one at their next sign-in,
// and every existing session for that account is ended.
//   npm run admin:reset-password -- <username>
const crypto = require('node:crypto');
const { query, closePool } = require('../lib/db');
const { hashPassword, audit } = require('../lib/auth');

async function main() {
    const username = (process.argv[2] || '').trim().toLowerCase();
    if (!username) throw new Error('Usage: npm run admin:reset-password -- <username>');
    const { rows } = await query('SELECT id FROM admin_users WHERE lower(username) = $1', [username]);
    if (!rows[0]) throw new Error('No admin account has that username.');

    const temporary = crypto.randomBytes(15).toString('base64url');
    await query('UPDATE admin_users SET password_hash = $1, must_change_password = true, active = true WHERE id = $2', [await hashPassword(temporary), rows[0].id]);
    await query('UPDATE admin_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [rows[0].id]);
    await query("DELETE FROM rate_limits WHERE key = $1", ['login:user:' + username]);
    await audit(rows[0].id, 'password_reset_by_script', 'admin_user', rows[0].id);
    console.log('Temporary password (shown once, change it at sign-in): ' + temporary);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(closePool);

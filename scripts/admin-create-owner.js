'use strict';

// Creates the first (owner) admin account. The password is typed here and is never stored in a file.
//   npm run admin:create-owner
const { query, closePool } = require('../lib/db');
const { ALL_PERMISSIONS, hashPassword, passwordProblem, audit } = require('../lib/auth');
const { ask, done } = require('./prompt');

async function main() {
    const existing = await query('SELECT count(*)::int AS n FROM admin_users');
    if (existing.rows[0].n > 0) {
        console.error('An admin account already exists. Use "npm run admin:reset-password" to reset its password.');
        process.exitCode = 1;
        return;
    }
    const username = (await ask('Username: ')).trim();
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) throw new Error('Use 3 to 50 letters, numbers, dots, dashes or underscores.');
    const displayName = (await ask('Display name: ')).trim() || username;
    const password = await ask('Password (at least 12 characters): ', { hidden: true });
    const problem = passwordProblem(password, username);
    if (problem) throw new Error(problem);
    if (password !== await ask('Repeat password: ', { hidden: true })) throw new Error('The passwords do not match.');

    const { rows } = await query(
        'INSERT INTO admin_users (username, password_hash, display_name, permissions) VALUES ($1, $2, $3, $4) RETURNING id',
        [username, await hashPassword(password), displayName, ALL_PERMISSIONS]
    );
    await audit(rows[0].id, 'owner_created', 'admin_user', rows[0].id);
    console.log('Owner account "' + username + '" created.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => { done(); return closePool(); });

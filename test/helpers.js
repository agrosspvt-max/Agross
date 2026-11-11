'use strict';

// Shared test setup. Database tests use a separate local database and are skipped when none is running.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://agross@127.0.0.1:5433/agross_test';
process.env.IP_HASH_SALT = 'test-salt';
delete process.env.VERCEL_ENV;
delete process.env.ADMIN_COOKIE_SECURE;
delete process.env.ALLOW_REAL_EMAIL;

const db = require('../lib/db');

async function databaseAvailable() {
    try {
        db.assertLocalDatabase();
        await db.query('SELECT 1');
        await db.migrate();
        return true;
    } catch {
        return false;
    }
}

async function cleanDatabase() {
    await db.query('TRUNCATE enquiries, admin_users, rate_limits, audit_log RESTART IDENTITY CASCADE');
}

function response() {
    return {
        headers: {}, statusCode: 200,
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        send(body) { this.body = body; return this; },
        end() { return this; }
    };
}

module.exports = { db, databaseAvailable, cleanDatabase, response };

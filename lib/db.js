'use strict';

// Shared PostgreSQL access. Local development uses a private local database;
// production uses the connection string held in the DATABASE_URL environment variable.

const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

let pool = null;

function getPool() {
    if (!pool) {
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL is not set');
        }
        // Serverless functions each hold few connections; the provider's pooled endpoint does the rest.
        pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
        pool.on('error', () => {});
    }
    return pool;
}

async function closePool() {
    if (pool) {
        const old = pool;
        pool = null;
        await old.end();
    }
}

function query(text, params) {
    return getPool().query(text, params);
}

async function withTransaction(work) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// Applies db/migrations/*.sql in order, once each.
async function migrate(client = null) {
    const own = !client;
    client = client || await getPool().connect();
    try {
        await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
        const dir = path.join(__dirname, '..', 'db', 'migrations');
        const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(row => row.name));
        const files = fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
        const ran = [];
        for (const file of files) {
            if (applied.has(file)) continue;
            await client.query('BEGIN');
            try {
                await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
                ran.push(file);
            } catch (error) {
                await client.query('ROLLBACK');
                throw new Error('Migration ' + file + ' failed: ' + error.message);
            }
        }
        return ran;
    } finally {
        if (own) client.release();
    }
}

// Development tools refuse to run against anything but a local database, so sample data
// and test helpers can never touch real records.
function assertLocalDatabase() {
    const url = process.env.DATABASE_URL || '';
    let host = '';
    try { host = new URL(url).hostname; } catch { /* handled below */ }
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
        throw new Error('Refusing to run: DATABASE_URL does not point to a local database.');
    }
}

module.exports = { getPool, closePool, query, withTransaction, migrate, assertLocalDatabase };

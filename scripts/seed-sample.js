'use strict';

// Adds clearly fake sample enquiries so the dashboard has something to show.
// Runs only against a local database. Safe to run again.
//   npm run db:seed
const { query, closePool, assertLocalDatabase } = require('../lib/db');
const crypto = require('node:crypto');
const { summarize } = require('../lib/forms');
const { ALL_PERMISSIONS, hashPassword } = require('../lib/auth');

const people = ['Asha Verma', 'Rakesh Patel', 'Meena Joshi', 'Sanjay Rao', 'Lata Nair', 'Imran Khan', 'Divya Menon', 'Vikram Singh', 'Pooja Desai', 'Arun Kumar'];
const samples = {
    contact: i => ({ name: people[i % 10], email: 'sample' + i + '@example.com', phone: '98765' + String(10000 + i), message: 'Sample message ' + i + ': please share product details.' }),
    dealership: i => ({ name: people[i % 10], firm: 'Sample Agro ' + i, mobile: '98765' + String(20000 + i), state: 'Madhya Pradesh', district: 'Bhopal', teshil: 'Huzur', email: 'dealer' + i + '@example.com', dealers: 'New Dealer', remark: 'Sample dealership request ' + i + '.' }),
    farming: i => ({ name: 'Sample Farms ' + i, email: 'farm' + i + '@example.com', mobile: '98765' + String(30000 + i), authorised: people[i % 10], produce: 'Wheat', quantity: (10 + i) + ' tonnes', address: 'Sample village ' + i + ', Raisen' }),
    recruitment: i => ({ name: people[i % 10], contact: '98765' + String(40000 + i), email: 'applicant' + i + '@example.com', profile: 'Sales Officer', state: 'Maharashtra', address: 'Sample town ' + i + ', Pune' })
};
const jobStates = ['delivered', 'delivered', 'accepted', 'accepted', 'failed', 'pending', 'unconfirmed'];
const statuses = ['new', 'new', 'in_progress', 'resolved'];

async function main() {
    assertLocalDatabase();
    const types = Object.keys(samples);
    let created = 0;
    for (let i = 1; i <= 48; i++) {
        const type = types[i % 4];
        const values = samples[type](i);
        const summary = summarize(type, values);
        const daysAgo = Math.floor(i * 0.8);
        const result = await query(
            `INSERT INTO enquiries (submission_key, form_type, display_name, company, email, phone, fields, search_text, source_page, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() - make_interval(days => $11, mins => $12))
             ON CONFLICT (submission_key) DO NOTHING RETURNING id`,
            ['sample-' + String(i).padStart(4, '0') + '-sample-data', type, summary.displayName, summary.company, summary.email, summary.phone,
                JSON.stringify(values), summary.searchText, '/contact.html', statuses[i % 4], daysAgo, (i * 37) % 600]
        );
        if (!result.rows[0]) continue;
        created++;
        const state = jobStates[i % jobStates.length];
        await query(
            `INSERT INTO notification_jobs (enquiry_id, state, attempts, provider_message_id, last_error_code, accepted_at, delivered_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [result.rows[0].id, state, state === 'pending' ? 0 : 1,
                ['accepted', 'delivered'].includes(state) ? '<sample-' + i + '@agross.local>' : null,
                state === 'failed' ? 'http_401' : state === 'unconfirmed' ? 'timeout' : null,
                ['accepted', 'delivered'].includes(state) ? new Date() : null, state === 'delivered' ? new Date() : null]
        );
    }
    console.log('Added ' + created + ' sample enquiries.');

    // A throwaway sign-in for the local sample database only (never used outside this computer).
    const existing = await query('SELECT count(*)::int AS n FROM admin_users');
    if (existing.rows[0].n === 0) {
        const password = crypto.randomBytes(12).toString('base64url');
        await query('INSERT INTO admin_users (username, password_hash, display_name, permissions) VALUES ($1, $2, $3, $4)',
            ['demo', await hashPassword(password), 'Demo Owner', ALL_PERMISSIONS]);
        console.log('Local sample sign-in -> username: demo   password: ' + password);
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(closePool);

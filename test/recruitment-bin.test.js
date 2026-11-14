'use strict';

// The Recruitment Bin: rejecting an application moves it out of the active lists, keeps it for 30 days with a Restore,
// and a scheduled cleanup then deletes it for good. Runs against the local test database.
const { test, before, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { db, databaseAvailable, cleanDatabase, response } = require('./helpers');
const auth = require('../lib/auth');
const inbox = require('../lib/inbox');
const bin = require('../lib/recruitment-bin');
const admin = require('../api/admin');
const adminPage = require('../api/admin-page');
const cleanup = require('../api/recruitment-bin-cleanup');

let available = false;
before(async () => { available = await databaseAvailable(); });
beforeEach(async () => {
    if (!available) return;
    await cleanDatabase();
    await db.query('TRUNCATE enquiry_purge_tally');
});
afterEach(() => { mock.restoreAll(); delete process.env.CRON_SECRET; });
after(() => db.closePool());

const PASSWORD = 'correct horse battery';
const ORIGIN = { host: 'admin.test', origin: 'http://admin.test' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

async function call(handler, { method = 'GET', route, query = {}, body, headers = {}, cookie, csrf } = {}) {
    const res = response();
    const all = { ...ORIGIN, 'content-type': 'application/json', 'user-agent': 'test', ...headers };
    if (cookie) all.cookie = cookie;
    if (csrf) all['x-csrf-token'] = csrf;
    if (method === 'GET') delete all.origin;
    await handler({ method, headers: all, query: { ...(route ? { route } : {}), ...query }, body, url: '/', socket: { remoteAddress: '203.0.113.9' } }, res);
    return res;
}

// Signs in through the real endpoint and returns helpers for that person.
async function person(username, permissions) {
    await db.query('INSERT INTO admin_users (username, password_hash, display_name, permissions) VALUES ($1, $2, $1, $3)', [username, await auth.hashPassword(PASSWORD), permissions]);
    const login = await call(admin, { method: 'POST', route: 'login', body: { username, password: PASSWORD } });
    assert.equal(login.statusCode, 200, JSON.stringify(login.body));
    const cookie = login.headers['set-cookie'].split(';')[0];
    const csrf = (await call(admin, { route: 'me', cookie })).body.csrfToken;
    return {
        get: (route, query) => call(admin, { route, query, cookie }),
        post: (route, body) => call(admin, { method: 'POST', route, body, cookie, csrf }),
        page: p => call(adminPage, { query: { p }, cookie }),
        cookie
    };
}

let counter = 0;
async function apply(values = {}, { resume = true } = {}) {
    const n = ++counter;
    const saved = await inbox.saveEnquiry({
        submissionKey: 'bin-test-' + String(n).padStart(8, '0') + '-0123456789', formType: 'recruitment',
        values: { name: 'Applicant ' + n, contact: '90000000' + n, email: 'applicant' + n + '@example.com', profile: 'Sales', state: 'MP', address: 'Bhopal', ...values },
        sourcePage: 'joinus.html', resume: resume ? { filename: 'cv-' + n + '.pdf', data: PDF } : undefined
    });
    return saved.id;
}

async function enquiry(type, extra = {}) {
    const n = ++counter;
    const values = type === 'contact' ? { name: 'Person ' + n, email: 'p' + n + '@example.com', message: 'Hello' }
        : { name: 'Dealer ' + n, firm: 'Firm ' + n, mobile: '9100000' + n, state: 'MP', district: 'Bhopal', teshil: 'T', email: 'd' + n + '@example.com', dealers: 'x', remark: 'r' };
    return (await inbox.saveEnquiry({ submissionKey: 'bin-other-' + String(n).padStart(8, '0') + '-0123456789', formType: type, values: { ...values, ...extra }, sourcePage: 'x' })).id;
}

const row = id => db.query('SELECT * FROM enquiries WHERE id = $1', [id]).then(result => result.rows[0]);
const setDeadline = (id, sql) => db.query('UPDATE enquiries SET bin_expires_at = ' + sql + ' WHERE id = $1', [id]);
const skip = t => { if (!available) { t.skip('no test database'); return true; } return false; };
const names = res => res.body.items.map(item => item.id);

async function staff() {
    return {
        hr: await person('hr', ['enquiries', 'recruitment']),
        plain: await person('plain', ['enquiries']),
        onlyRecruiting: await person('recruiting-only', ['recruitment'])
    };
}

test('rejecting moves the application to the Bin, saving the note and the 30-day deadline together', async t => {
    if (skip(t)) return;
    const { hr } = await staff();
    const fetchCalls = mock.method(global, 'fetch', async () => { throw new Error('no email may be sent'); });
    const a = await apply();
    const b = await apply();
    const contactId = await enquiry('contact');
    const before = (await hr.get('overview')).body;

    // The list editor and the detail page both send the status they saw, with the note.
    const viaList = await hr.post('enquiry-status', { id: a, status: 'rejected', note: '  Not a fit.  ', expectedStatus: 'new' });
    assert.equal(viaList.statusCode, 200, JSON.stringify(viaList.body));
    const detailFirst = (await hr.get('enquiry', { id: b })).body;
    const viaDetail = await hr.post('enquiry-status', { id: b, status: 'rejected', expectedStatus: detailFirst.status });
    assert.equal(viaDetail.statusCode, 200, JSON.stringify(viaDetail.body));

    const saved = await row(a);
    assert.equal(saved.status, 'rejected');
    assert.deepEqual(saved.status_notes, { rejected: 'Not a fit.' });
    assert.equal(saved.bin_previous_status, 'new');
    const days = (await db.query("SELECT (bin_expires_at - bin_rejected_at) = interval '30 days' AS thirty, bin_rejected_at = status_changed_at AS same_moment FROM enquiries WHERE id = $1", [a])).rows[0];
    assert.deepEqual(days, { thirty: true, same_moment: true }, 'the clock starts at the rejection');
    assert.equal(new Date(viaList.body.followUp.bin.deleteAfter).getTime(), saved.bin_expires_at.getTime());

    // Gone from every active view at once.
    for (const query of [{}, { form: 'recruitment' }, { q: 'applicant' }, { q: 'applicant', form: 'recruitment' }, { status: 'rejected' }]) {
        const list = (await hr.get('enquiries', query)).body;
        assert.ok(!names({ body: list }).includes(a) && !names({ body: list }).includes(b), JSON.stringify(query));
    }
    assert.deepEqual(names(await hr.get('enquiries')), [contactId], 'only the non-recruitment enquiry is left');
    // Counts: workload falls, history stays.
    const after = (await hr.get('overview')).body;
    assert.equal(before.new - after.new, 2);
    assert.equal(after.total, before.total);
    const recruitment = after.byForm.find(form => form.type === 'recruitment');
    assert.deepEqual([recruitment.count, recruitment.active, recruitment.rejected], [2, 0, 2]);
    assert.equal(after.rejected, 2);

    // No email to the applicant, and the history records no applicant text.
    assert.equal(fetchCalls.mock.callCount(), 0);
    const audit = (await db.query("SELECT metadata FROM audit_log WHERE action = 'enquiry_moved_to_bin' ORDER BY id")).rows;
    assert.equal(audit.length, 2);
    assert.deepEqual(audit[0].metadata, { status: 'rejected', noteChanged: true, previousStatus: 'new', days: 30 });
    assert.doesNotMatch(JSON.stringify(audit), /Not a fit|Applicant|example\.com/);
});

test('other enquiry types keep their workflow and are never put in the Bin', async t => {
    if (skip(t)) return;
    const { hr } = await staff();
    const contactId = await enquiry('contact');
    const dealerId = await enquiry('dealership');
    for (const id of [contactId, dealerId]) {
        assert.equal((await hr.post('enquiry-status', { id, status: 'rejected' })).statusCode, 400);
        assert.equal((await hr.post('enquiry-status', { id, status: 'resolved', note: 'Done.' })).statusCode, 200);
    }
    assert.equal((await hr.get('enquiries', { status: 'resolved' })).body.total, 2);
    assert.equal((await row(contactId)).bin_expires_at, null);
    await setDeadline(await apply(), "now() - interval '1 day'").catch(() => {});
    assert.equal((await bin.purgeExpired()).deleted, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM enquiries WHERE form_type <> $1', ['recruitment'])).rows[0].n, 2);
    // The database refuses to mark one of them rejected.
    await assert.rejects(db.query("UPDATE enquiries SET status = 'rejected' WHERE id = $1", [contactId]), /enquiries_status_check|enquiries_bin_matches_status/);
});

test('the Bin shows name, role, rejection date and deletion date, and needs the recruitment permission', async t => {
    if (skip(t)) return;
    const { hr, plain, onlyRecruiting } = await staff();
    const a = await apply({ name: 'Asha Rao', profile: 'Field Officer' });
    const general = await apply({ name: 'Ravi Kumar', profile: 'General application' });
    await hr.post('enquiry-status', { id: a, status: 'rejected', note: 'Role filled.' });
    await hr.post('enquiry-status', { id: general, status: 'rejected' });

    const listed = (await hr.get('bin')).body;
    assert.equal(listed.retentionDays, 30);
    assert.deepEqual(listed.items.map(item => [item.name, item.role]).sort(), [['Asha Rao', 'Field Officer'], ['Ravi Kumar', 'General application']]);
    const item = listed.items.find(entry => entry.id === a);
    assert.ok(item.rejectedAt && item.deleteAfter && item.hasResume && item.hasNote);
    assert.equal(Math.round((new Date(item.deleteAfter) - new Date(item.rejectedAt)) / 86400000), 30);
    assert.equal(bin.roleOf('   '), 'General application');
    assert.equal(bin.roleOf(undefined), 'General application');

    // Anyone without both permissions gets nothing: the list, the application, its PDF and Restore.
    for (const who of [plain, onlyRecruiting]) {
        assert.equal((await who.get('bin')).statusCode, 403);
        assert.equal((await who.post('enquiry-restore', { id: a })).statusCode, who === plain ? 404 : 403);
    }
    assert.equal((await plain.get('enquiry', { id: a })).statusCode, 404);
    assert.equal((await plain.get('enquiry-resume', { id: a })).statusCode, 404);
    assert.equal((await hr.page('bin')).statusCode, 200);
    assert.equal((await plain.page('bin')).statusCode, 403);
    assert.equal((await onlyRecruiting.page('bin')).statusCode, 403);
    assert.equal((await call(adminPage, { query: { p: 'bin' } })).statusCode, 302);
    assert.equal((await call(admin, { route: 'bin' })).statusCode, 401);

    // Staff can open it, read the note and view or download the PDF while it is in the Bin.
    const detail = (await hr.get('enquiry', { id: a })).body;
    assert.equal(detail.status, 'rejected');
    assert.deepEqual(detail.statusNotes, { rejected: 'Role filled.' });
    assert.ok(detail.bin.deleteAfter && detail.resumeFilename);
    for (const view of ['1', undefined]) {
        const pdf = await hr.get('enquiry-resume', { id: a, view });
        assert.equal(pdf.statusCode, 200);
        assert.equal(pdf.headers['content-type'], 'application/pdf');
        assert.equal(pdf.headers['content-disposition'].startsWith(view ? 'inline' : 'attachment'), true);
        assert.deepEqual(pdf.body, PDF);
    }
    // An empty Bin is just an empty list.
    await db.query('DELETE FROM enquiries');
    assert.deepEqual((await hr.get('bin')).body.items, []);
});

test('asking for the same rejection again keeps the original deadline', async t => {
    if (skip(t)) return;
    const { hr } = await staff();
    const id = await apply();
    assert.equal((await hr.post('enquiry-status', { id, status: 'rejected', note: 'First.', expectedStatus: 'new' })).statusCode, 200);
    await setDeadline(id, "now() + interval '10 days'");
    const original = (await row(id)).bin_expires_at;
    const rejectedAt = (await row(id)).bin_rejected_at;

    // The page retries after a slow answer: same request, and a request that still expects the earlier status.
    for (const body of [{ id, status: 'rejected', note: 'First.', expectedStatus: 'new' }, { id, status: 'rejected', note: 'First.' }]) {
        const retry = await hr.post('enquiry-status', body);
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(new Date(retry.body.followUp.bin.deleteAfter).getTime(), original.getTime());
    }
    // A changed note is saved, but the deadline and the rejection time do not move.
    assert.equal((await hr.post('enquiry-status', { id, status: 'rejected', note: 'Edited.' })).statusCode, 200);
    const now = await row(id);
    assert.equal(now.bin_expires_at.getTime(), original.getTime());
    assert.equal(now.bin_rejected_at.getTime(), rejectedAt.getTime());
    assert.deepEqual(now.status_notes, { rejected: 'Edited.' });
    assert.equal(now.bin_previous_status, 'new');
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE action = 'enquiry_moved_to_bin'")).rows[0].n, 1, 'one move, however many retries');
    // Any other status has to wait for Restore.
    const other = await hr.post('enquiry-status', { id, status: 'in_progress' });
    assert.equal(other.statusCode, 409);
    assert.equal(other.body.code, 'in_bin');
});

test('Restore returns the previous status, clears the deadline and keeps the notes and PDF', async t => {
    if (skip(t)) return;
    const { hr } = await staff();
    const id = await apply();
    assert.equal((await hr.post('enquiry-status', { id, status: 'shortlisted', note: 'Strong.' })).statusCode, 200);
    assert.equal((await hr.post('enquiry-status', { id, status: 'rejected', note: 'Changed our mind.', expectedStatus: 'shortlisted' })).statusCode, 200);
    assert.equal((await row(id)).bin_previous_status, 'shortlisted');
    await setDeadline(id, "now() + interval '5 days'");

    const restored = await hr.post('enquiry-restore', { id });
    assert.equal(restored.statusCode, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.status, 'shortlisted');
    const back = await row(id);
    assert.deepEqual([back.status, back.bin_expires_at, back.bin_rejected_at, back.bin_previous_status], ['shortlisted', null, null, null]);
    assert.deepEqual(back.status_notes, { shortlisted: 'Strong.', rejected: 'Changed our mind.' });
    assert.equal((await db.query('SELECT count(*)::int n FROM enquiry_resumes WHERE enquiry_id = $1', [id])).rows[0].n, 1);
    assert.deepEqual(names(await hr.get('bin')), []);
    assert.deepEqual(names(await hr.get('enquiries', { form: 'recruitment' })), [id]);
    assert.equal((await hr.get('enquiry-resume', { id })).statusCode, 200);
    assert.equal((await hr.post('enquiry-restore', { id })).statusCode, 404, 'a second Restore has nothing to restore');
    assert.equal((await db.query("SELECT metadata FROM audit_log WHERE action = 'enquiry_restored_from_bin'")).rows[0].metadata.status, 'shortlisted');

    // A later rejection starts a fresh 30 days, whatever was left of the old period.
    assert.equal((await hr.post('enquiry-status', { id, status: 'rejected', expectedStatus: 'shortlisted' })).statusCode, 200);
    const again = (await db.query("SELECT bin_expires_at > now() + interval '29 days 23 hours' AS fresh, bin_expires_at - bin_rejected_at = interval '30 days' AS thirty FROM enquiries WHERE id = $1", [id])).rows[0];
    assert.deepEqual(again, { fresh: true, thirty: true });

    // When the earlier status is not known (an application rejected before the Bin existed), it returns to In progress.
    await db.query('UPDATE enquiries SET bin_previous_status = NULL WHERE id = $1', [id]);
    assert.equal((await hr.post('enquiry-restore', { id })).body.status, 'in_progress');
});

test('at the deadline the application is unavailable at once; the next cleanup deletes it and its records', async t => {
    if (skip(t)) return;
    const { hr } = await staff();
    process.env.CRON_SECRET = 'a-long-enough-cron-secret-for-tests';
    const logs = [];
    mock.method(console, 'info', (...args) => logs.push(JSON.stringify(args)));
    mock.method(console, 'error', (...args) => logs.push(JSON.stringify(args)));
    const cron = () => call(cleanup, { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } });

    const doomed = await apply({ name: 'Doomed Person', email: 'doomed.person@example.com' });
    const kept = await apply();
    const restoredInTime = await apply();
    for (const id of [doomed, kept, restoredInTime]) assert.equal((await hr.post('enquiry-status', { id, status: 'rejected', note: 'Private note.' })).statusCode, 200);
    await db.query("INSERT INTO notification_events (job_id, event) SELECT id, 'queued' FROM notification_jobs WHERE enquiry_id = $1", [doomed]);
    const overviewBefore = (await hr.get('overview')).body;

    // Before the deadline: nothing is deleted.
    await setDeadline(doomed, "now() + interval '1 hour'");
    const early = await cron();
    assert.equal(early.statusCode, 200);
    assert.equal(early.body.deleted, 0);
    assert.equal((await row(doomed)).status, 'rejected');
    assert.equal(names(await hr.get('bin')).length, 3);

    // In time: one is restored and one is left alone.
    assert.equal((await hr.post('enquiry-restore', { id: restoredInTime })).statusCode, 200);

    // After the deadline, before any cleanup has run: gone from view, from Restore and from the PDF.
    await setDeadline(doomed, "now() - interval '1 minute'");
    assert.deepEqual(names(await hr.get('bin')), [kept]);
    assert.equal((await hr.get('enquiry', { id: doomed })).statusCode, 404);
    assert.equal((await hr.get('enquiry-resume', { id: doomed })).statusCode, 404);
    assert.equal((await hr.post('enquiry-restore', { id: doomed })).statusCode, 404);
    assert.equal((await hr.post('enquiry-status', { id: doomed, status: 'rejected' })).statusCode, 404);
    assert.ok(await row(doomed), 'the row waits for the cleanup');

    // The cleanup deletes it with everything that holds applicant data, and nothing else.
    const run = await cron();
    assert.deepEqual([run.statusCode, run.body.ok, run.body.deleted, run.body.overdue], [200, true, 1, 0]);
    assert.equal(await row(doomed), undefined);
    for (const table of ['enquiry_resumes', 'notification_jobs']) assert.equal((await db.query('SELECT count(*)::int n FROM ' + table + ' WHERE enquiry_id = $1', [doomed])).rows[0].n, 0, table);
    assert.equal((await db.query('SELECT count(*)::int n FROM notification_events')).rows[0].n, 0);
    assert.ok(await row(kept), 'still inside its 30 days');
    assert.equal((await row(restoredInTime)).status, 'new', 'restored in time, so never selected');
    assert.equal((await db.query('SELECT count(*)::int n FROM enquiry_resumes')).rows[0].n, 2);

    // Running it again, or after a missed run, changes nothing more.
    assert.equal((await cron()).body.deleted, 0);
    assert.equal((await bin.purgeExpired()).deleted, 0);

    // History stays meaningful: the submission still counts as received, as a count with no applicant data.
    const overviewAfter = (await hr.get('overview')).body;
    assert.equal(overviewAfter.total, overviewBefore.total);
    assert.equal(overviewAfter.byForm.find(form => form.type === 'recruitment').count, 3);
    assert.equal(overviewAfter.rejected, 2, 'the deleted one and the one still in the Bin');
    assert.deepEqual((await db.query('SELECT form_type, purged FROM enquiry_purge_tally')).rows, [{ form_type: 'recruitment', purged: 1 }]);
    assert.equal((await hr.get('overview', { from: '2000-01-01', to: '2000-01-02' })).body.total, 0, 'a date range that excludes it does not count it');

    // No applicant details in the logs, the audit history or the response.
    const everything = JSON.stringify([logs, (await db.query('SELECT * FROM audit_log')).rows, run.body, (await db.query('SELECT * FROM enquiry_purge_tally')).rows]);
    assert.doesNotMatch(everything, /Doomed Person|doomed\.person|Private note|example\.com|9000000/);
});

test('a row being restored is skipped by the cleanup, never deleted underneath it', async t => {
    if (skip(t)) return;
    const { hr } = await staff();
    const id = await apply();
    await hr.post('enquiry-status', { id, status: 'rejected' });
    await setDeadline(id, "now() - interval '1 minute'");
    await db.withTransaction(async client => {
        await client.query('SELECT 1 FROM enquiries WHERE id = $1 FOR UPDATE', [id]);
        assert.equal((await bin.purgeExpired()).deleted, 0, 'locked rows are left for the next run');
    });
    assert.ok(await row(id));
    assert.equal((await bin.purgeExpired()).deleted, 1);
});

test('the scheduled endpoint needs the secret, uses no admin session and fails closed', async t => {
    if (skip(t)) return;
    const id = await apply();
    await db.query("UPDATE enquiries SET status = 'rejected', bin_rejected_at = now() - interval '31 days', bin_expires_at = now() - interval '1 day' WHERE id = $1", [id]);
    const withHeader = value => call(cleanup, { headers: value === undefined ? {} : { authorization: value } });

    // Without CRON_SECRET configured nothing is allowed, even a request that sends "Bearer undefined" or nothing.
    for (const value of [undefined, 'Bearer undefined', 'Bearer ']) assert.equal((await withHeader(value)).statusCode, 401);
    process.env.CRON_SECRET = 'a-long-enough-cron-secret-for-tests';
    for (const value of [undefined, 'Bearer wrong-secret', 'a-long-enough-cron-secret-for-tests', 'Bearer a-long-enough-cron-secret-for-tests ']) {
        assert.equal((await withHeader(value)).statusCode, 401, String(value));
    }
    assert.equal((await call(cleanup, { method: 'POST', headers: { authorization: 'Bearer a-long-enough-cron-secret-for-tests' } })).statusCode, 405);
    assert.ok(await row(id), 'nothing was deleted by a refused call');

    // Vercel's scheduler sends only the header: no cookie, no sign-in, no admin visit.
    assert.equal((await db.query('SELECT count(*)::int n FROM admin_sessions')).rows[0].n, 0);
    const run = await withHeader('Bearer a-long-enough-cron-secret-for-tests');
    assert.equal(run.statusCode, 200);
    assert.equal(run.headers['cache-control'], 'no-store');
    assert.equal(run.body.deleted, 1);
    assert.equal(await row(id), undefined);

    // A failure is reported without details, and nothing is half deleted: break the count table so the delete fails.
    const second = await apply({ name: 'Failing Person', email: 'failing.person@example.com' });
    await db.query("UPDATE enquiries SET status = 'rejected', bin_rejected_at = now() - interval '31 days', bin_expires_at = now() - interval '1 day' WHERE id = $1", [second]);
    const logged = [];
    mock.method(console, 'error', (...args) => logged.push(JSON.stringify(args)));
    await db.query('ALTER TABLE enquiry_purge_tally RENAME TO enquiry_purge_tally_broken');
    try {
        const failed = await withHeader('Bearer a-long-enough-cron-secret-for-tests');
        assert.deepEqual([failed.statusCode, failed.body], [500, { ok: false }]);
        assert.ok(await row(second), 'the application is still there: the delete and the count are one statement');
        assert.doesNotMatch(logged.join(''), /Failing Person|failing\.person|example\.com|enquiry_purge_tally/);
    } finally {
        await db.query('ALTER TABLE enquiry_purge_tally_broken RENAME TO enquiry_purge_tally');
    }
    assert.equal((await withHeader('Bearer a-long-enough-cron-secret-for-tests')).body.deleted, 1, 'the next run catches up');
});

test('the cron entry and function limits are configured in vercel.json', () => {
    const config = require('../vercel.json');
    assert.deepEqual(config.crons, [{ path: '/api/recruitment-bin-cleanup', schedule: '30 21 * * *' }]);
    // Hobby plans allow one run a day: five fields, a fixed minute and hour, every day.
    assert.match(config.crons[0].schedule, /^\d+ \d+ \* \* \*$/);
    assert.ok(config.functions['api/recruitment-bin-cleanup.js'].maxDuration >= 10);
});

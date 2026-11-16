'use strict';

// Job openings with formatted text and custom sections: what is accepted, what is stored and what the public page gets.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, databaseAvailable, cleanDatabase, response } = require('./helpers');
const auth = require('../lib/auth');
const rich = require('../lib/rich-text');
const recruiting = require('../lib/recruiting');
const admin = require('../api/admin');
const openingsApi = require('../api/openings');

let available = false;
before(async () => { available = await databaseAvailable(); });
beforeEach(async () => { if (available) await cleanDatabase(); });
after(() => db.closePool());

// ---- text rules, no database ---------------------------------------------------------------------

test('formatted text is cleaned into runs, merging equal neighbours and dropping empty paragraphs', () => {
    const checked = rich.cleanRich([
        [{ t: '  Lead ' }, { t: 'the ', b: true }, { t: 'field', b: true }, { t: ' team', i: true, b: false }],
        [{ t: '   ' }],
        [{ t: 'Second\nline', i: true }, { t: '\n\n\n\nafter' }, { t: '  ' }]
    ], { maxChars: 5000 });
    assert.deepEqual(checked.value, [
        [{ t: 'Lead ' }, { t: 'the field', b: true }, { t: ' team', i: true }],
        [{ t: 'Second\nline', i: true }, { t: '\n\nafter' }]
    ]);
    assert.equal(checked.plain, 'Lead the field team\n\nSecond\nline\n\nafter');
});

test('headings are one line and bold unless a part is made regular', () => {
    const heading = rich.cleanHeading([{ t: 'Key ' }, { t: 'Responsibilities', b: false, i: true }, { t: '\nsplit' }], { maxChars: 120 });
    assert.deepEqual(heading.value, [{ t: 'Key ', b: true }, { t: 'Responsibilities', b: false, i: true }, { t: ' split', b: true }]);
    assert.equal(heading.plain, 'Key Responsibilities split');
});

test('anything that is not plain runs of text is refused', () => {
    const bad = [
        'text', null, [{}], [{ t: 5 }], [{ t: 'x', b: 'yes' }], [{ t: 'x', i: 1 }], [[{ t: 'x' }]], [{ t: 'a\u0000b' }], [{ t: 'a\u0007b' }], [{ t: '\ud800' }],
        Array.from({ length: 401 }, () => ({ t: 'x' }))
    ];
    for (const input of bad) assert.ok(rich.cleanRuns(input).error, JSON.stringify(input).slice(0, 40));
    assert.ok(rich.cleanRich('text', { maxChars: 10 }).error);
    assert.ok(rich.cleanRich([[{ t: 'x'.repeat(11) }]], { maxChars: 10 }).error);
    assert.ok(rich.cleanRich(Array.from({ length: 101 }, () => [{ t: 'x' }]), { maxChars: 5000 }).error);
    assert.ok(rich.cleanHeading([{ t: 'x'.repeat(121) }], { maxChars: 120 }).error);
});

test('markup and scripts are just words: nothing is parsed or removed, so there is nothing to run', () => {
    const attack = '<script>alert(1)</script> <img src=x onerror=alert(2)> <b>not bold</b> javascript:alert(3) &lt;';
    const heading = rich.cleanHeading([{ t: attack }], { maxChars: 500 });
    const body = rich.cleanRich([[{ t: attack, b: true }]], { maxChars: 5000 });
    assert.equal(heading.value[0].t, attack);
    assert.equal(body.value[0][0].t, attack);
    assert.deepEqual(Object.keys(body.value[0][0]).sort(), ['b', 't'], 'only the three known keys are ever stored');
    assert.deepEqual(rich.cleanRuns([{ t: 'x', b: true, onclick: 'alert(1)', style: 'x', html: '<i>' }]).runs, [{ t: 'x', b: true, i: false }]);
});

test('older plain descriptions become paragraphs, and previews are short plain text', () => {
    assert.deepEqual(rich.plainToRich('First line\nstill first\n\n  \nSecond'), [[{ t: 'First line\nstill first' }], [{ t: 'Second' }]]);
    assert.deepEqual(rich.plainToRich(''), []);
    assert.equal(rich.excerptOf('Short text'), 'Short text');
    const long = ('word '.repeat(80)).trim();
    const excerpt = rich.excerptOf(long, 100);
    assert.ok(excerpt.length <= 101 && excerpt.endsWith('…') && !/\s…$/.test(excerpt));
    assert.equal(rich.excerptOf('One\n\nTwo\n  three'), 'One Two three');
});

// ---- the opening as the editor submits it ----------------------------------------------------------

const heading = text => [{ t: text, b: true }];
const paragraph = (text, extra = {}) => [[{ t: text, ...extra }]];
const post = (extra = {}) => ({ designation: 'Field Officer', area: 'Bhopal', intro: paragraph('Lead the team.'), isOpen: true, sections: [], ...extra });

test('empty sections are left out, partial ones are reported against their section and field, order is kept', () => {
    const checked = recruiting.validateOpening(post({ sections: [
        { heading: heading('Qualifications'), body: paragraph('Degree.') },
        { heading: [], body: [] },
        { heading: heading('Benefits'), body: paragraph('Insurance.') },
        { heading: [{ t: '  ', b: true }], body: [[{ t: '  ' }]] }
    ] }));
    assert.deepEqual(checked.opening.sections.map(section => section.heading[0].t), ['Qualifications', 'Benefits']);

    const partial = recruiting.validateOpening(post({ sections: [
        { heading: heading('Fine'), body: paragraph('Fine.') },
        { heading: heading('No description'), body: [] },
        { heading: [], body: paragraph('No heading') },
        { heading: heading('x'.repeat(121)), body: paragraph('Long heading') },
        { heading: heading('Bad'), body: [[{ t: 'a\u0000b' }]] }
    ] }));
    assert.deepEqual(partial.errors.sections, {
        1: { body: 'Add a description for this section.' },
        2: { heading: 'Add a heading for this section.' },
        3: { heading: 'Use at most 120 characters.' },
        4: { body: 'The text contains unsupported characters.' }
    });
    assert.equal(partial.error, 'Fix the sections marked below.');
    assert.equal(recruiting.validateOpening(post({ intro: [] })).errors.intro, 'Enter a description.');
    assert.ok(recruiting.validateOpening(post({ sections: Array.from({ length: 31 }, () => ({ heading: [], body: [] })) })).error);
    assert.ok(recruiting.validateOpening(post({ sections: 'x' })).error);
    assert.ok(recruiting.validateOpening(post({ sections: [null] })).errors.sections[0]);
});

// ---- saving, reopening and the public page -------------------------------------------------------------

const PASSWORD = 'correct horse battery';
async function owner(permissions = auth.ALL_PERMISSIONS, username = 'owner') {
    await db.query('INSERT INTO admin_users (username, password_hash, display_name, permissions) VALUES ($1, $2, $1, $3)', [username, await auth.hashPassword(PASSWORD), permissions]);
    const send = async (handler, { method = 'GET', route, query = {}, body, cookie, csrf } = {}) => {
        const res = response();
        const headers = { host: 'admin.test', origin: 'http://admin.test', 'content-type': 'application/json', 'user-agent': 'test' };
        if (cookie) headers.cookie = cookie;
        if (csrf) headers['x-csrf-token'] = csrf;
        if (method === 'GET') delete headers.origin;
        await handler({ method, headers, query: { ...(route ? { route } : {}), ...query }, body, url: '/', socket: { remoteAddress: '203.0.113.9' } }, res);
        return res;
    };
    const login = await send(admin, { method: 'POST', route: 'login', body: { username, password: PASSWORD } });
    const cookie = login.headers['set-cookie'].split(';')[0];
    const csrf = (await send(admin, { route: 'me', cookie })).body.csrfToken;
    return {
        save: body => send(admin, { method: 'POST', route: 'recruiting', body, cookie, csrf }),
        list: () => send(admin, { route: 'recruiting', cookie }),
        publicList: () => send(openingsApi),
        publicOne: id => send(openingsApi, { query: { id } })
    };
}

test('an opening with three sections reopens with the same text, order and formatting, and shows on the public page', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const sections = [
        { heading: [{ t: 'Key ', b: true }, { t: 'Responsibilities', b: false, i: true }], body: [[{ t: 'Visit ' }, { t: 'farms', b: true, i: true }, { t: ' weekly.\nReport back.' }], [{ t: 'Second paragraph.' }]] },
        { heading: heading('Qualifications'), body: paragraph('Degree in agriculture.') },
        { heading: heading('Benefits'), body: paragraph('Travel allowance.', { i: true }) }
    ];
    const saved = await o.save(post({ intro: [[{ t: 'Join ' }, { t: 'our', b: true }, { t: ' team', i: true }], [{ t: 'Second intro paragraph.' }]], sections }));
    assert.equal(saved.statusCode, 201, JSON.stringify(saved.body));
    const id = saved.body.opening.id;

    // Reopened in Admin.
    const reopened = (await o.list()).body.openings.find(opening => opening.id === id);
    assert.deepEqual(reopened.sections, [
        { heading: [{ t: 'Key ', b: true }, { t: 'Responsibilities', b: false, i: true }], body: [[{ t: 'Visit ' }, { t: 'farms', b: true, i: true }, { t: ' weekly.\nReport back.' }], [{ t: 'Second paragraph.' }]] },
        sections[1], { heading: heading('Benefits'), body: paragraph('Travel allowance.', { i: true }) }
    ]);
    assert.deepEqual(reopened.intro, [[{ t: 'Join ' }, { t: 'our', b: true }, { t: ' team', i: true }], [{ t: 'Second intro paragraph.' }]]);
    assert.equal(reopened.description, 'Join our team\n\nSecond intro paragraph.', 'the plain description follows the formatted one');

    // The public page: main description first, then the sections in order with their formatting.
    const detail = (await o.publicOne(id)).body.opening;
    assert.deepEqual(detail.intro, reopened.intro);
    assert.deepEqual(detail.sections, reopened.sections);
    assert.equal(detail.excerpt, 'Join our team Second intro paragraph.');
    assert.equal((await o.publicList()).body.openings[0].excerpt, detail.excerpt, 'the list preview is the plain excerpt');

    // Removing the middle section keeps the other two in order.
    const edited = await o.save(post({ id, intro: reopened.intro, sections: [reopened.sections[0], reopened.sections[2]] }));
    assert.equal(edited.statusCode, 200);
    assert.deepEqual((await o.publicOne(id)).body.opening.sections.map(section => section.heading[0].t), ['Key ', 'Benefits']);

    // Closing hides it, however many sections it has.
    assert.equal((await o.save(post({ id, intro: reopened.intro, sections: reopened.sections, isOpen: false }))).statusCode, 200);
    assert.equal((await o.publicOne(id)).statusCode, 404);
    assert.deepEqual((await o.publicList()).body, { openings: [] });
    assert.equal((await o.list()).body.openings[0].sections.length, 3, 'closing does not delete the sections');
});

test('an opening saved before sections existed stays readable and editable, with its own description', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const { rows: [old] } = await db.query(
        "INSERT INTO job_openings (designation, area, description, is_open) VALUES ('Old Role', 'Indore', E'First paragraph.\\nStill the first.\\n\\nSecond paragraph.', true) RETURNING id");
    const publicDetail = (await o.publicOne(old.id)).body.opening;
    assert.equal(publicDetail.description, 'First paragraph.\nStill the first.\n\nSecond paragraph.');
    assert.deepEqual(publicDetail.intro, [[{ t: 'First paragraph.\nStill the first.' }], [{ t: 'Second paragraph.' }]]);
    assert.deepEqual(publicDetail.sections, []);
    const adminView = (await o.list()).body.openings.find(opening => opening.id === old.id);
    assert.deepEqual([adminView.sections, adminView.intro], [[], publicDetail.intro]);

    // Editing it in the new editor adds formatting and sections.
    const saved = await o.save(post({ id: old.id, designation: 'Old Role', intro: [[{ t: 'First paragraph.', b: true }]], sections: [{ heading: heading('Extra'), body: paragraph('More.') }] }));
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.opening.description, 'First paragraph.');

    // An older editor that sends only plain text neither loses the sections nor shows stale formatting.
    const plainOnly = await o.save({ id: old.id, designation: 'Old Role', description: 'Plain edit.', isOpen: true });
    assert.equal(plainOnly.statusCode, 200);
    const after = (await o.publicOne(old.id)).body.opening;
    assert.deepEqual(after.intro, [[{ t: 'Plain edit.' }]]);
    assert.equal(after.sections.length, 1);
    // A description changed behind the formatted copy's back (an older version of the code) wins over the stale copy.
    await db.query("UPDATE job_openings SET description = 'Changed by the old code.' WHERE id = $1", [old.id]);
    assert.deepEqual((await o.publicOne(old.id)).body.opening.intro, [[{ t: 'Changed by the old code.' }]]);
});

test('a failed save names the section and field, and stores nothing', async t => {
    if (!available) return t.skip('no test database');
    const o = await owner();
    const failed = await o.save(post({ sections: [
        { heading: heading('Fine'), body: paragraph('Fine.') },
        { heading: heading('Half done'), body: [] }
    ] }));
    assert.equal(failed.statusCode, 400);
    assert.deepEqual(failed.body.errors, { sections: { 1: { body: 'Add a description for this section.' } } });
    assert.equal((await db.query('SELECT count(*)::int n FROM job_openings')).rows[0].n, 0);
    const noIntro = await o.save(post({ intro: [[{ t: '   ' }]] }));
    assert.deepEqual([noIntro.statusCode, noIntro.body.errors.intro], [400, 'Enter a description.']);
});

test('only people with the recruiting permission save openings, and script text is stored and returned as plain text', async t => {
    if (!available) return t.skip('no test database');
    const hr = await owner(['recruitment'], 'hr');
    const accounts = await owner(['accounts'], 'accountant');
    assert.equal((await accounts.save(post())).statusCode, 403);
    assert.equal((await accounts.list()).statusCode, 403);

    const attack = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const saved = await hr.save(post({
        intro: paragraph(attack), sections: [{ heading: [{ t: attack, b: true }], body: paragraph(attack, { b: true }) }]
    }));
    assert.equal(saved.statusCode, 201);
    const { opening } = (await hr.publicOne(saved.body.opening.id)).body;
    assert.equal(opening.intro[0][0].t, attack);
    assert.equal(opening.sections[0].heading[0].t, attack);
    assert.equal(opening.sections[0].body[0][0].t, attack);
    // The only way the public page shows content is as text (see assets/js/careers.js), so none of this is ever parsed.
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'assets', 'js', 'careers.js'), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    // Anything outside text runs is refused, not cleaned.
    assert.equal((await hr.save(post({ intro: '<b>x</b>' }))).statusCode, 400);
    assert.equal((await hr.save(post({ intro: [[{ t: 'x', html: '<b>x</b>' }]] }))).statusCode, 201, 'unknown keys are dropped');
});

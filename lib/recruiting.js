'use strict';

const { query, withTransaction } = require('./db');
const { cleanRich, cleanHeading, plainFromRich, plainToRich, excerptOf } = require('./rich-text');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = value => typeof value === 'string' && UUID.test(value);

// The main description as formatted paragraphs. Openings saved before formatting existed have only the plain
// description, and so does one whose plain text no longer matches its formatted copy (for example after an edit
// made by an older version of the editor); both are shown as plain paragraphs.
function introOf(row) {
    return row.intro && plainFromRich(row.intro) === row.description ? row.intro : plainToRich(row.description);
}

function present(row) {
    return {
        id: row.id, designation: row.designation, area: row.area, description: row.description,
        excerpt: excerptOf(row.description), intro: introOf(row), sections: row.sections || []
    };
}

async function publicOpenings(id) {
    const { rows } = await query(
        'SELECT id, designation, area, description, intro, sections FROM job_openings WHERE is_open' +
        (id ? ' AND id = $1' : ' ORDER BY created_at DESC, id'),
        id ? [id] : []
    );
    return rows.map(present);
}

const ADMIN_COLUMNS = 'id, designation, area, description, intro, sections, is_open AS "isOpen", updated_at AS "updatedAt"';

async function adminOpenings() {
    const { rows } = await query('SELECT ' + ADMIN_COLUMNS + ' FROM job_openings ORDER BY is_open DESC, created_at DESC, id');
    return rows.map(row => ({ ...present(row), isOpen: row.isOpen, updatedAt: row.updatedAt }));
}

const MAX_SECTIONS = 30;
const DESCRIPTION_LIMIT = 5000;
const HEADING_LIMIT = 120;

/*
 * Checks an opening submitted by the editor. The main description is `intro` (formatted paragraphs); an older
 * client may send plain `description` text instead. `sections` is an ordered list of { heading, body }: a section with
 * neither is dropped, and one with only one of them is reported against that section and field.
 * Returns { opening } or { error, errors? } where errors = { intro?, sections: { [index]: { heading?, body? } } }.
 */
function validateOpening(body) {
    if (!body || typeof body.designation !== 'string' || typeof body.isOpen !== 'boolean' ||
        (typeof body.description !== 'string' && body.intro === undefined)) {
        return { error: 'Enter a designation, description and status.' };
    }
    if (body.id !== undefined && !validId(body.id)) return { error: 'Choose a valid opening.' };
    const designation = body.designation.trim();
    const area = typeof body.area === 'string' ? body.area.trim() : '';
    if (!designation || designation.length > 120 || /[\x00-\x1f\x7f]/.test(designation)) {
        return { error: 'Enter a designation on one line, up to 120 characters.' };
    }
    if ((body.area != null && typeof body.area !== 'string') || area.length > 120 || /[\x00-\x1f\x7f]/.test(area)) {
        return { error: 'Enter an area on one line, up to 120 characters.' };
    }

    const errors = {};
    const introInput = body.intro !== undefined ? body.intro : (typeof body.description === 'string' ? plainToRich(body.description) : []);
    const intro = cleanRich(introInput, { maxChars: DESCRIPTION_LIMIT });
    if (intro.error) errors.intro = intro.error;
    else if (!intro.plain) errors.intro = 'Enter a description.';

    let sections;
    if (body.sections !== undefined) {
        if (!Array.isArray(body.sections) || body.sections.length > MAX_SECTIONS) return { error: 'Use at most ' + MAX_SECTIONS + ' sections.' };
        sections = [];
        const problems = {};
        body.sections.forEach((section, index) => {
            if (!section || typeof section !== 'object' || Array.isArray(section)) {
                problems[index] = { heading: 'This section could not be read. Remove it and add it again.' };
                return;
            }
            const heading = cleanHeading(section.heading === undefined ? [] : section.heading, { maxChars: HEADING_LIMIT });
            const text = cleanRich(section.body === undefined ? [] : section.body, { maxChars: DESCRIPTION_LIMIT });
            const found = {};
            if (heading.error) found.heading = heading.error;
            if (text.error) found.body = text.error;
            const hasHeading = !heading.error && Boolean(heading.plain);
            const hasBody = !text.error && Boolean(text.plain);
            if (!heading.error && !text.error && !hasHeading && !hasBody) return; // completely empty: left out
            if (!heading.error && !hasHeading) found.heading = 'Add a heading for this section.';
            if (!text.error && !hasBody) found.body = 'Add a description for this section.';
            if (found.heading || found.body) problems[index] = found;
            else sections.push({ heading: heading.value, body: text.value });
        });
        if (Object.keys(problems).length) errors.sections = problems;
    }

    if (errors.intro || errors.sections) {
        return { error: errors.intro || 'Fix the sections marked below.', errors };
    }
    return { opening: { id: body.id, designation, area: area || null, description: intro.plain, intro: intro.value, sections, isOpen: body.isOpen } };
}

async function saveOpening(opening, actorId) {
    const { id, designation, area, description, intro, sections, isOpen } = opening;
    return withTransaction(async client => {
        const fields = ' RETURNING ' + ADMIN_COLUMNS;
        // A client that sends no sections leaves the saved ones alone; a client that sends none for intro has plain text only.
        const values = [designation, area, description, isOpen, intro ? JSON.stringify(intro) : null, sections ? JSON.stringify(sections) : null];
        const { rows: [saved] } = id
            ? await client.query('UPDATE job_openings SET designation = $1, area = $2, description = $3, is_open = $4, intro = $5::jsonb, sections = COALESCE($6::jsonb, sections), updated_at = now() WHERE id = $7' + fields, [...values, id])
            : await client.query("INSERT INTO job_openings (designation, area, description, is_open, intro, sections) VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::jsonb, '[]'::jsonb))" + fields, values);
        if (!saved) return null;
        await client.query(
            "INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, 'job_opening', $3, $4)",
            [actorId, id ? 'job_opening_updated' : 'job_opening_created', saved.id, JSON.stringify({ isOpen, sections: (saved.sections || []).length })]
        );
        return { ...present(saved), isOpen: saved.isOpen, updatedAt: saved.updatedAt };
    });
}

module.exports = { validId, publicOpenings, adminOpenings, validateOpening, saveOpening };

'use strict';

// Saving enquiries and reading them back for the admin inbox and overview.
// Every date is an India Standard Time calendar day.

const { query, withTransaction } = require('./db');
const { FORM_TYPES, FORMS, summarize, labelledFields } = require('./forms');
const { hasPermission } = require('./auth');

const STATUSES = ['new', 'in_progress', 'resolved'];
const RECRUITMENT_STATUSES = ['shortlisted', 'rejected'];
const MAX_STATUS_NOTE_LENGTH = 2000;
const EMAIL_STATES = ['pending', 'accepted', 'delivered', 'failed', 'unconfirmed'];
const MAX_PAGE_SIZE = 100;

/*
 * Saves the enquiry and its pending notification job in one transaction.
 * The same submissionKey always returns the same enquiry, so retries and double clicks
 * create one record and one job.
 */
async function saveEnquiry({ submissionKey, formType, values, sourcePage, resume, openingId }) {
    return withTransaction(async client => {
        if (openingId) {
            // A retry can still confirm an earlier submission after a position closes.
            const opening = await client.query('SELECT designation, is_open FROM job_openings WHERE id = $1 FOR SHARE', [openingId]);
            if (!opening.rows[0]?.is_open) {
                const retry = await client.query('SELECT id FROM enquiries WHERE submission_key = $1', [submissionKey]);
                return retry.rows[0] ? { id: retry.rows[0].id, created: false } : { closedOpening: true };
            }
            values = { ...values, profile: opening.rows[0].designation };
        }
        const summary = summarize(formType, values);
        const inserted = await client.query(
            `INSERT INTO enquiries (submission_key, form_type, display_name, company, email, phone, fields, search_text, source_page, job_opening_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (submission_key) DO NOTHING RETURNING id`,
            [submissionKey, formType, summary.displayName, summary.company, summary.email, summary.phone, JSON.stringify(values), summary.searchText, sourcePage || null, openingId || null]
        );
        if (inserted.rows[0]) {
            const { id } = inserted.rows[0];
            if (resume && formType === 'recruitment') {
                await client.query('INSERT INTO enquiry_resumes (enquiry_id, filename, data) VALUES ($1, $2, $3)', [id, resume.filename, resume.data]);
            }
            await client.query('INSERT INTO notification_jobs (enquiry_id) VALUES ($1)', [id]);
            return { id, created: true };
        }
        const existing = await client.query('SELECT id FROM enquiries WHERE submission_key = $1', [submissionKey]);
        return { id: existing.rows[0].id, created: false };
    });
}

function isValidDate(text) {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const date = new Date(text + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function visibleForms(user) {
    return hasPermission(user, 'recruitment') ? FORM_TYPES : FORM_TYPES.filter(type => type !== 'recruitment');
}

// Turns validated filters into SQL. Recruitment is hidden from anyone without that permission.
function buildWhere(filters, user) {
    const clauses = [];
    const params = [];
    const add = value => { params.push(value); return '$' + params.length; };

    clauses.push('e.form_type = ANY(' + add(visibleForms(user)) + ')');
    if (filters.from) clauses.push('e.created_at >= (' + add(filters.from) + "::date)::timestamp AT TIME ZONE 'Asia/Kolkata'");
    if (filters.to) clauses.push('e.created_at < ((' + add(filters.to) + "::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')");
    if (filters.form) clauses.push('e.form_type = ' + add(filters.form));
    if (filters.status) clauses.push('e.status = ' + add(filters.status));
    if (filters.email) {
        // A job being sent right now still counts as pending for staff.
        clauses.push(filters.email === 'pending' ? "j.state IN ('pending', 'sending')" : 'j.state = ' + add(filters.email));
    }
    if (filters.q) {
        const escaped = filters.q.toLowerCase().replace(/[\\%_]/g, match => '\\' + match);
        clauses.push('e.search_text LIKE ' + add('%' + escaped + '%'));
    }
    return { sql: clauses.join(' AND '), params };
}

// Returns { filters } or { error } for the query string values.
function parseFilters(input) {
    const filters = {};
    for (const key of ['from', 'to']) {
        if (input[key]) {
            if (!isValidDate(input[key])) return { error: 'Dates must look like 2026-11-05.' };
            filters[key] = input[key];
        }
    }
    if (filters.from && filters.to && filters.from > filters.to) return { error: 'The start date is after the end date.' };
    if (input.form) {
        if (!FORM_TYPES.includes(input.form)) return { error: 'Unknown form type.' };
        filters.form = input.form;
    }
    if (input.status) {
        if (!STATUSES.includes(input.status) && !RECRUITMENT_STATUSES.includes(input.status)) return { error: 'Unknown status.' };
        filters.status = input.status;
    }
    if (input.email) {
        if (!EMAIL_STATES.includes(input.email)) return { error: 'Unknown email state.' };
        filters.email = input.email;
    }
    if (input.q) filters.q = String(input.q).trim().slice(0, 100);
    return { filters };
}

async function listEnquiries(filters, user, page = 1, pageSize = 25) {
    pageSize = Math.min(Math.max(Number(pageSize) || 25, 1), MAX_PAGE_SIZE);
    page = Math.max(Number(page) || 1, 1);
    const where = buildWhere(filters, user);
    const from = 'FROM enquiries e JOIN notification_jobs j ON j.enquiry_id = e.id WHERE ' + where.sql;
    const showAttachments = (!filters.form || filters.form === 'recruitment') && hasPermission(user, 'recruitment');
    const resumeExists = showAttachments
        ? "e.form_type = 'recruitment' AND EXISTS (SELECT 1 FROM enquiry_resumes r WHERE r.enquiry_id = e.id)"
        : 'FALSE';
    const [count, rows] = await Promise.all([
        query('SELECT count(*)::int AS total ' + from, where.params),
        query(
            `SELECT e.id, e.created_at, e.form_type, e.display_name, e.company, e.email, e.phone, e.status,
                    CASE WHEN e.form_type = 'recruitment' THEN e.fields->>'profile' END AS designation,
                    j.state AS email_state, j.last_error_code, (${resumeExists}) AS has_resume ${from}
             ORDER BY e.created_at DESC, e.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
            where.params
        )
    ]);
    return {
        total: count.rows[0].total, page, pageSize, showAttachments,
        items: rows.rows.map(row => ({
            id: row.id, createdAt: row.created_at, formType: row.form_type, formTitle: FORMS[row.form_type].title,
            name: row.display_name, company: row.company, email: row.email, phone: row.phone, hasResume: row.has_resume,
            // The position a recruitment applicant applied for (from the opening, or as they typed it).
            designation: row.designation || null,
            status: row.status, emailState: row.email_state === 'sending' ? 'pending' : row.email_state, emailError: row.last_error_code
        }))
    };
}

async function overview(filters, user) {
    const where = buildWhere({ from: filters.from, to: filters.to }, user);
    const { rows } = await query(
        `SELECT e.form_type, count(*)::int AS total, (count(*) FILTER (WHERE e.status = 'new'))::int AS new_count
         FROM enquiries e JOIN notification_jobs j ON j.enquiry_id = e.id WHERE ${where.sql} GROUP BY e.form_type`,
        where.params
    );
    const byForm = {};
    for (const type of visibleForms(user)) byForm[type] = 0;
    let total = 0;
    let newCount = 0;
    for (const row of rows) {
        byForm[row.form_type] = row.total;
        total += row.total;
        newCount += row.new_count;
    }
    return { total, new: newCount, byForm: Object.entries(byForm).map(([type, count]) => ({ type, title: FORMS[type].title, count })) };
}

async function getEnquiry(id, user) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
    const { rows } = await query(
        `SELECT e.*, j.id AS job_id, j.state AS email_state, j.attempts, j.provider_message_id, j.last_error_code,
                j.accepted_at, j.delivered_at, u.display_name AS status_changed_by_name, r.filename AS resume_filename
         FROM enquiries e JOIN notification_jobs j ON j.enquiry_id = e.id
         LEFT JOIN admin_users u ON u.id = e.status_changed_by
         LEFT JOIN enquiry_resumes r ON r.enquiry_id = e.id
         WHERE e.id = $1 AND e.form_type = ANY($2)`,
        [id, visibleForms(user)]
    );
    const row = rows[0];
    if (!row) return null;
    const events = await query('SELECT at, event, detail FROM notification_events WHERE job_id = $1 ORDER BY at, id', [row.job_id]);
    return {
        id: row.id, createdAt: row.created_at, formType: row.form_type, formTitle: FORMS[row.form_type].title,
        sourcePage: row.source_page, status: row.status, statusChangedAt: row.status_changed_at, statusChangedBy: row.status_changed_by_name,
        statusNotes: row.status_notes || {},
        fields: labelledFields(row.form_type, row.fields),
        resumeFilename: row.resume_filename,
        notification: {
            state: row.email_state === 'sending' ? 'pending' : row.email_state, attempts: row.attempts,
            messageId: row.provider_message_id, errorCode: row.last_error_code, acceptedAt: row.accepted_at, deliveredAt: row.delivered_at,
            history: events.rows.map(event => ({ at: event.at, event: event.event, detail: event.detail }))
        }
    };
}

async function getResume(id, user) {
    if (!hasPermission(user, 'recruitment')) return null;
    const { rows } = await query(
        `SELECT r.filename, r.data FROM enquiry_resumes r JOIN enquiries e ON e.id = r.enquiry_id
         WHERE e.id = $1 AND e.form_type = 'recruitment'`, [id]
    );
    return rows[0] || null;
}

async function setStatus(id, status, user, { note, expectedStatus } = {}) {
    const recruitmentStatus = RECRUITMENT_STATUSES.includes(status);
    if (!STATUSES.includes(status) && !recruitmentStatus) return { ok: false, status: 400, message: 'Unknown status.' };
    if (note !== undefined && (typeof note !== 'string' || note.length > MAX_STATUS_NOTE_LENGTH || note.includes('\0') || !note.isWellFormed())) {
        return { ok: false, status: 400, message: 'Enter a valid note of up to 2,000 characters.' };
    }
    return withTransaction(async client => {
        const { rows: [row] } = await client.query(
            `SELECT e.form_type, e.status, e.status_notes, e.status_changed_at, u.display_name AS status_changed_by_name
             FROM enquiries e LEFT JOIN admin_users u ON u.id = e.status_changed_by
             WHERE e.id = $1 AND e.form_type = ANY($2) FOR UPDATE OF e`,
            [id, visibleForms(user)]
        );
        if (!row) return { ok: false, status: 404, message: 'Enquiry not found.' };
        if (recruitmentStatus && row.form_type !== 'recruitment') {
            return { ok: false, status: 400, message: 'This status is only available for recruitment enquiries.' };
        }
        if (expectedStatus !== undefined && expectedStatus !== row.status) {
            return { ok: false, status: 409, message: 'The status changed since you opened this enquiry. Reload the page before saving.' };
        }

        const statusChanged = row.status !== status;
        const statusNotes = row.status_notes;
        const text = note?.trim();
        const noteChanged = text !== undefined && text !== (statusNotes[status] || '');
        let statusChangedAt = row.status_changed_at;
        if (noteChanged) {
            if (text) statusNotes[status] = text;
            else delete statusNotes[status];
        }
        if (statusChanged || noteChanged) {
            const updated = await client.query(
                `UPDATE enquiries SET status = $2, status_notes = $4,
                    status_changed_by = CASE WHEN status <> $2 THEN $3 ELSE status_changed_by END,
                    status_changed_at = CASE WHEN status <> $2 THEN now() ELSE status_changed_at END
                 WHERE id = $1 RETURNING status_changed_at`,
                [id, status, user.id, JSON.stringify(statusNotes)]
            );
            statusChangedAt = updated.rows[0].status_changed_at;
            await client.query(
                `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
                 VALUES ($1, $2, 'enquiry', $3, $4)`,
                [user.id, statusChanged ? 'enquiry_status_changed' : 'enquiry_note_changed', id, JSON.stringify({ status, noteChanged })]
            );
        }
        return { ok: true, followUp: {
            status, statusNotes, statusChangedAt,
            statusChangedBy: statusChanged ? user.displayName : row.status_changed_by_name
        } };
    });
}

module.exports = { STATUSES, EMAIL_STATES, saveEnquiry, parseFilters, listEnquiries, overview, getEnquiry, getResume, setStatus, visibleForms };

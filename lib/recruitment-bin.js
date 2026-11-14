'use strict';

// The Recruitment Bin. A rejected application leaves the active lists at once and waits here for 30 days, so an
// accidental rejection can be undone. When the 30 days end it is unavailable straight away (viewing and restoring both
// check the stored deadline, so they never depend on the cleanup having run) and the next cleanup deletes it for good.
//
// An application is in the Bin while bin_expires_at is in the future, and active while bin_expires_at is null.
// Nothing here logs applicant details: logs and the audit history carry IDs and counts only.

const { query, withTransaction } = require('./db');
const { hasPermission } = require('./auth');

const BIN_DAYS = 30;
// Statuses an application can return to. A rejected application's earlier status is kept so Restore can use it.
const RESTORE_STATUSES = ['new', 'in_progress', 'resolved', 'shortlisted'];
const FALLBACK_STATUS = 'in_progress';
const GENERAL_APPLICATION = 'General application';

// SQL conditions on the enquiries table (aliased e).
const ACTIVE = 'e.bin_expires_at IS NULL';
const AVAILABLE = '(e.bin_expires_at IS NULL OR e.bin_expires_at > now())';

// Staff who can read applications (the route checks the enquiries permission) and have the recruitment permission.
function canUseBin(user) {
    return hasPermission(user, 'recruitment');
}

function roleOf(profile) {
    return typeof profile === 'string' && profile.trim() ? profile.trim() : GENERAL_APPLICATION;
}

// Applications in the Bin, most recently rejected first.
async function listBin(user) {
    if (!canUseBin(user)) return null;
    const { rows } = await query(
        `SELECT e.id, e.display_name, e.fields->>'profile' AS role, e.bin_rejected_at, e.bin_expires_at,
                (e.status_notes ? 'rejected') AS has_note,
                EXISTS (SELECT 1 FROM enquiry_resumes r WHERE r.enquiry_id = e.id) AS has_resume
         FROM enquiries e
         WHERE e.form_type = 'recruitment' AND e.bin_expires_at > now()
         ORDER BY e.bin_rejected_at DESC, e.id`
    );
    return {
        retentionDays: BIN_DAYS,
        items: rows.map(row => ({
            id: row.id, name: row.display_name, role: roleOf(row.role), rejectedAt: row.bin_rejected_at,
            deleteAfter: row.bin_expires_at, hasNote: row.has_note, hasResume: row.has_resume
        }))
    };
}

// Returns an application to the active list with the status it had before it was rejected, and clears the deadline.
// Its notes and attachment were never touched. Fails once the deadline has passed, whether or not the cleanup has run.
async function restore(id, user) {
    if (!canUseBin(user)) return { ok: false, status: 404, message: 'Application not found.' };
    return withTransaction(async client => {
        const { rows: [row] } = await client.query(
            `SELECT e.bin_previous_status FROM enquiries e
             WHERE e.id = $1 AND e.form_type = 'recruitment' AND e.bin_expires_at > now() FOR UPDATE OF e`, [id]);
        if (!row) {
            return { ok: false, status: 404, message: 'This application is no longer in the Recruitment Bin. It may already have been restored or deleted.' };
        }
        const status = RESTORE_STATUSES.includes(row.bin_previous_status) ? row.bin_previous_status : FALLBACK_STATUS;
        await client.query(
            `UPDATE enquiries SET status = $2, bin_rejected_at = NULL, bin_expires_at = NULL, bin_previous_status = NULL,
                    status_changed_by = $3, status_changed_at = now() WHERE id = $1`, [id, status, user.id]);
        await client.query(
            "INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, 'enquiry_restored_from_bin', 'enquiry', $2, $3)",
            [user.id, id, JSON.stringify({ status })]);
        return { ok: true, status };
    });
}

/*
 * Permanently deletes applications whose 30 days have ended: the row (details, notes and search text) and, through the
 * database's cascades, the PDF, the email notification record and its history. The count per submission day is kept
 * so historical totals stay meaningful. Safe to run twice or after a missed run: it only ever deletes rows that are
 * past their stored deadline, and a row restored in time has no deadline and is never selected. Rows locked by a
 * restore in progress are skipped and picked up next time.
 * Returns counts only.
 */
async function purgeExpired({ batchSize = 100, maxBatches = 50 } = {}) {
    let deleted = 0;
    for (let batch = 0; batch < maxBatches; batch++) {
        const { rows: [result] } = await query(
            `WITH doomed AS (
                 SELECT id FROM enquiries
                 WHERE form_type = 'recruitment' AND bin_expires_at IS NOT NULL AND bin_expires_at <= now()
                 ORDER BY bin_expires_at, id LIMIT $1 FOR UPDATE SKIP LOCKED),
             gone AS (
                 DELETE FROM enquiries e USING doomed d
                 WHERE e.id = d.id AND e.bin_expires_at IS NOT NULL AND e.bin_expires_at <= now()
                 RETURNING e.form_type, (e.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day),
             tally AS (
                 INSERT INTO enquiry_purge_tally (day, form_type, purged)
                 SELECT day, form_type, count(*)::int FROM gone GROUP BY day, form_type
                 ON CONFLICT (day, form_type) DO UPDATE SET purged = enquiry_purge_tally.purged + EXCLUDED.purged
                 RETURNING 1)
             SELECT (SELECT count(*) FROM gone)::int AS deleted`, [batchSize]);
        deleted += result.deleted;
        if (result.deleted < batchSize) break;
    }
    if (deleted) {
        await query(
            "INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata) VALUES (NULL, 'recruitment_bin_purged', 'enquiries', NULL, $1)",
            [JSON.stringify({ deleted })]);
    }
    const { rows: [left] } = await query(
        `SELECT count(*) FILTER (WHERE bin_expires_at <= now())::int AS overdue, count(*) FILTER (WHERE bin_expires_at > now())::int AS in_bin
         FROM enquiries WHERE bin_expires_at IS NOT NULL`);
    return { deleted, overdue: left.overdue, inBin: left.in_bin };
}

module.exports = { BIN_DAYS, RESTORE_STATUSES, FALLBACK_STATUS, GENERAL_APPLICATION, ACTIVE, AVAILABLE, canUseBin, roleOf, listBin, restore, purgeExpired };

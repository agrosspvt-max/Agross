'use strict';

// Email notifications for saved enquiries, sent through the existing Brevo account.
// The enquiry is always saved first; a failure here only changes the job's state.

const { query } = require('./db');
const { FORMS, labelledFields } = require('./forms');
const { isHosted } = require('./security');

const RECIPIENT = 'info@agromaxx.in';
const SEND_TIMEOUT_MS = 10000;
const LOCK_SECONDS = 45;

// Local development and tests must never reach the real Brevo account by accident.
function brevoConfig() {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.FORM_FROM_EMAIL;
    const base = process.env.BREVO_API_URL || (isHosted() || process.env.ALLOW_REAL_EMAIL === '1' ? 'https://api.brevo.com' : null);
    return { apiKey, sender, base };
}

function buildEmail(enquiry, sender) {
    const form = FORMS[enquiry.form_type];
    const rows = labelledFields(enquiry.form_type, enquiry.fields);
    return {
        sender: { name: 'Agross Website', email: sender },
        to: [{ email: RECIPIENT }],
        replyTo: { email: enquiry.email },
        subject: form.subject,
        headers: { 'X-Agross-Enquiry': enquiry.id },
        tags: ['website-enquiry'],
        textContent: form.subject + '\n\n' + rows.map(row => row.label + ': ' + row.value).join('\n\n')
    };
}

// Outcome is one of:
//   accepted     Brevo returned a message ID
//   failed       Brevo clearly did not take it (safe to retry)
//   unconfirmed  the result is unknown (timeout or unreadable answer); a retry could send a duplicate
async function sendEmail(enquiry) {
    const { apiKey, sender, base } = brevoConfig();
    if (!apiKey || !sender || sender.length > 254) return { outcome: 'failed', code: 'not_configured' };
    if (!base) return { outcome: 'failed', code: 'real_email_disabled_locally' };
    try {
        const response = await fetch(base + '/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
            body: JSON.stringify(buildEmail(enquiry, sender))
        });
        if (!response.ok) return { outcome: 'failed', code: 'http_' + response.status };
        let result;
        try { result = await response.json(); } catch { return { outcome: 'unconfirmed', code: 'unreadable_response' }; }
        if (!result || typeof result.messageId !== 'string' || !result.messageId) return { outcome: 'unconfirmed', code: 'no_message_id' };
        return { outcome: 'accepted', messageId: result.messageId };
    } catch (error) {
        const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        return { outcome: timedOut ? 'unconfirmed' : 'failed', code: timedOut ? 'timeout' : 'network_error' };
    }
}

async function logEvent(jobId, event, detail = null) {
    await query('INSERT INTO notification_events (job_id, event, detail) VALUES ($1, $2, $3)', [jobId, event, detail]);
}

// A function that died mid-send leaves a job locked in "sending"; that outcome is unknown.
async function sweepStale() {
    await query(
        `UPDATE notification_jobs SET state = 'unconfirmed', last_error_code = 'interrupted', updated_at = now()
         WHERE state = 'sending' AND locked_until < now()`
    );
}

/*
 * Sends the notification for one enquiry. Only one caller can hold a job at a time.
 * `acceptUnconfirmed` must be true to resend a job whose earlier outcome is unknown.
 * Returns { state, claimed }.
 */
async function deliver(enquiryId, { acceptUnconfirmed = false } = {}) {
    await sweepStale();
    const claim = await query(
        `UPDATE notification_jobs
         SET state = 'sending', attempts = attempts + 1, locked_until = now() + make_interval(secs => $3), updated_at = now()
         WHERE enquiry_id = $1 AND (state IN ('pending', 'failed') OR (state = 'unconfirmed' AND $2))
         RETURNING id`,
        [enquiryId, acceptUnconfirmed, LOCK_SECONDS]
    );
    if (!claim.rows[0]) {
        const current = await query('SELECT state FROM notification_jobs WHERE enquiry_id = $1', [enquiryId]);
        return { state: current.rows[0] ? current.rows[0].state : null, claimed: false };
    }
    const jobId = claim.rows[0].id;
    const { rows } = await query('SELECT * FROM enquiries WHERE id = $1', [enquiryId]);
    const result = await sendEmail(rows[0]);
    await logEvent(jobId, 'attempt_' + result.outcome, result.code || null);

    if (result.outcome === 'accepted') {
        await query(
            `UPDATE notification_jobs SET state = 'accepted', provider_message_id = $2, last_error_code = NULL,
             accepted_at = now(), locked_until = NULL, updated_at = now() WHERE id = $1`,
            [jobId, result.messageId]
        );
    } else {
        await query(
            `UPDATE notification_jobs SET state = $2, last_error_code = $3, locked_until = NULL, updated_at = now() WHERE id = $1`,
            [jobId, result.outcome, result.code]
        );
    }
    return { state: result.outcome, claimed: true };
}

function normalizeMessageId(value) {
    return String(value || '').trim().replace(/^<|>$/g, '').toLowerCase();
}

/*
 * Applies a Brevo transactional webhook event. "Delivered" is recorded only for a delivered event.
 * Brevo has used both "message-id" and "messageId" in examples, so both are accepted.
 */
async function applyWebhookEvent(payload) {
    const event = String(payload && (payload.event || payload.type) || '').toLowerCase();
    const messageId = normalizeMessageId(payload && (payload['message-id'] || payload.messageId));
    if (!event || !messageId) return { matched: false };
    const { rows } = await query(
        `SELECT id, state FROM notification_jobs WHERE lower(trim(both '<>' from provider_message_id)) = $1`,
        [messageId]
    );
    if (!rows[0]) return { matched: false };
    const job = rows[0];
    if (event === 'delivered') {
        await query(`UPDATE notification_jobs SET state = 'delivered', delivered_at = now(), last_error_code = NULL, updated_at = now() WHERE id = $1`, [job.id]);
        await logEvent(job.id, 'delivered');
    } else if (['hard_bounce', 'soft_bounce', 'blocked', 'invalid', 'invalid_email', 'error', 'deferred'].includes(event)) {
        // A bounce after acceptance means the email did not arrive.
        if (job.state !== 'delivered') {
            await query(`UPDATE notification_jobs SET state = 'failed', last_error_code = $2, updated_at = now() WHERE id = $1`, [job.id, event]);
        }
        await logEvent(job.id, 'provider_' + event);
    } else {
        await logEvent(job.id, 'provider_' + event);
    }
    return { matched: true };
}

module.exports = { RECIPIENT, brevoConfig, buildEmail, sendEmail, deliver, sweepStale, applyWebhookEvent };

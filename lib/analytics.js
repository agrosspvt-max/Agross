'use strict';

// GA4 traffic reports for the admin dashboard.
// The last successful report for each date range is saved in the analytics_cache table, and
// one shared refresh lease (row 0) makes sure only one Agross instance requests a Core report at a time.
// Every write that follows a Google call requires the current, unexpired lease ID in the same
// statement, so a late or expired refresh can never overwrite a newer report or cooldown.

const crypto = require('node:crypto');
const { JWT } = require('google-auth-library');
const { query } = require('./db');

// A saved report younger than this is shown without asking Google again.
const FRESH_SECONDS = 5 * 60;
// A saved report is shown when Google cannot be reached, for up to this long.
const MAX_STALE_SECONDS = 24 * 60 * 60;
// Longer than the 20-second admin function limit, so a running holder always writes before it expires.
const LEASE_SECONDS = 25;
// Wait after a timeout (Google may still be working on the abandoned request) or a 429 without Retry-After.
const COOLDOWN_SECONDS = 60;
// Ignore a Retry-After longer than this, so one odd header cannot lock the dashboard out for days.
const MAX_COOLDOWN_SECONDS = 60 * 60;
// Both steps must finish inside the 20-second admin function limit.
const TOKEN_TIMEOUT_MS = 5 * 1000;
const REPORT_TIMEOUT_MS = 13 * 1000;
const REALTIME_CACHE_MS = 30 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const INDIA_TIME = 'Asia/Kolkata';
const minuteFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const hostFilter = { filter: { fieldName: 'hostName', inListFilter: { values: ['agross.in', 'www.agross.in'] } } };
const realtimeFilter = { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'web' } } };
const activityMetrics = [{ name: 'activeUsers' }, { name: 'screenPageViews' }];
const PAGE_LIMIT = 25;
let client;
let realtimeFetch;
let realtimeSaved;
let realtimePagesFetch;
let realtimePagesSaved;

function failureDetails(error) {
    const status = error.response?.status ?? error.status;
    const code = [error.cause?.code, error.code, error.cause?.name, error.name]
        .find(value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value));
    const body = error.response?.data?.error;
    const googleStatus = body?.status;
    // Google API errors carry a machine-readable reason (for example SERVICE_DISABLED); the token
    // endpoint answers with an OAuth error string instead (for example invalid_grant).
    let reason = Array.isArray(body?.details) ? body.details.map(detail => detail?.reason).find(Boolean) : undefined;
    if (!reason && typeof body?.message === 'string' && /has not been used in project|it is disabled/i.test(body.message)) reason = 'SERVICE_DISABLED';
    const oauthError = typeof body === 'string' ? body : undefined;
    const safe = (value, pattern) => (typeof value === 'string' && pattern.test(value) ? value : undefined);
    return {
        status: Number.isInteger(status) ? status : undefined,
        code,
        googleStatus: safe(googleStatus, /^[A-Z_]{1,40}$/),
        reason: safe(reason, /^[A-Z_]{1,60}$/) || safe(error.reason, /^[a-z_]{1,40}$/),
        oauthError: safe(oauthError, /^[a-z_]{1,40}$/),
        // Which step failed and how long each took, so a slow sign-in and a slow report can be told apart.
        phase: safe(error.phase, /^(token|report)$/),
        tokenMs: Number.isInteger(error.tokenMs) ? error.tokenMs : undefined,
        reportMs: Number.isInteger(error.reportMs) ? error.reportMs : undefined
    };
}

// A setup mistake found before anything is sent to Google. The reason says which one; never the value.
function setupError(reason) {
    return Object.assign(new Error('GA4 setup problem: ' + reason), { code: 'GA4_SETUP', reason });
}

// No report can be shown yet: a timeout, a rate limit or another refresh. Says how long to wait.
function unavailable(notice) {
    return Object.assign(new Error('Google Analytics report unavailable: ' + notice.kind), {
        code: 'GA4_UNAVAILABLE', kind: notice.kind, retryAfter: notice.retryAfter, refreshingDays: notice.refreshingDays
    });
}

// Seconds to wait after a 429: Google's Retry-After (seconds or an HTTP date), else the default.
function retryAfterSeconds(error) {
    const headers = error.response?.headers;
    const header = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after'];
    const value = typeof header === 'string' ? header.trim() : '';
    let seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
    if (!Number.isFinite(seconds) || seconds < 1) seconds = COOLDOWN_SECONDS;
    return Math.min(seconds, MAX_COOLDOWN_SECONDS);
}

function cooldownFor(error, details) {
    if (details.status === 429) return { kind: 'rate_limit', retryAfter: retryAfterSeconds(error) };
    if (details.code === 'TimeoutError') return { kind: 'timeout', retryAfter: COOLDOWN_SECONDS };
    return null;
}

function configuration() {
    const property = process.env.GA_PROPERTY_ID?.trim();
    const credentials = process.env.GA_SERVICE_ACCOUNT_JSON;
    if (!property || !credentials) return null;
    if (/^G-/i.test(property)) throw setupError('measurement_id_as_property');
    if (!/^\d+$/.test(property)) throw setupError('property_id_format');
    if (!client) {
        let key;
        try {
            key = JSON.parse(credentials);
        } catch {
            throw setupError('credentials_not_json');
        }
        if (!key || key.type !== 'service_account' || !key.client_email || !key.private_key) {
            throw setupError('credentials_not_service_account');
        }
        client = new JWT({
            email: key.client_email,
            key: key.private_key,
            scopes: ['https://www.googleapis.com/auth/analytics.readonly']
        });
    }
    return { property, client };
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Timed out after ' + ms + ' ms'), { name: 'TimeoutError' })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function queryReports(config, days) {
    if (days === 1) return queryLastDay(config);
    const dateRanges = [{ startDate: days + 'daysAgo', endDate: 'yesterday' }];
    const visitorsAndVisits = [{ name: 'totalUsers' }, { name: 'sessions' }];
    function top(dimensions, metric) {
        return {
            dimensions: dimensions.map(name => ({ name })),
            metrics: [{ name: metric }],
            orderBys: [{ metric: { metricName: metric }, desc: true }],
            limit: '10'
        };
    }
    const requests = [
        { metrics: [...visitorsAndVisits, { name: 'screenPageViews' }] },
        { dimensions: [{ name: 'date' }], metrics: visitorsAndVisits, orderBys: [{ dimension: { dimensionName: 'date' } }] },
        top(['sessionSourceMedium'], 'sessions'),
        top(['country'], 'totalUsers'),
        top(['country', 'region'], 'totalUsers')
    ].map(report => ({ ...report, dateRanges, dimensionFilter: hostFilter }));
    const data = await requestGoogleReport(config, 'batchRunReports', { requests });
    if (!Array.isArray(data.reports) || data.reports.length !== requests.length) {
        throw new Error('Incomplete GA4 report');
    }

    const [total, trend, sources, countries, regions] = data.reports.map(report => report.rows || []);
    const dimension = (row, index) => row.dimensionValues[index].value;
    const metric = (row, index) => Number(row?.metricValues[index]?.value || 0);
    const counts = row => ({ visitors: metric(row, 0), visits: metric(row, 1) });
    const timeZone = data.reports[0].metadata?.timeZone || INDIA_TIME;
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const rowsByDate = new Map(trend.map(row => [dimension(row, 0), counts(row)]));
    const daily = Array.from({ length: days }, (_, index) => {
        const day = new Date(today + 'T00:00:00Z');
        day.setUTCDate(day.getUTCDate() - days + index);
        const date = day.toISOString().slice(0, 10);
        return { date, ...(rowsByDate.get(date.replaceAll('-', '')) || counts()) };
    });
    return {
        totals: { ...counts(total[0]), pageViews: metric(total[0], 2) },
        daily,
        sources: sources.map(row => ({ source: dimension(row, 0), visits: metric(row, 0) })),
        countries: countries.map(row => ({ country: dimension(row, 0), visitors: metric(row, 0) })),
        regions: regions.map(row => ({ country: dimension(row, 0), region: dimension(row, 1), visitors: metric(row, 0) })),
        timeZone
    };
}

async function requestGoogleReport({ property, client }, method, request) {
    const signInStarted = Date.now();
    try {
        await withTimeout(client.getAccessToken(), TOKEN_TIMEOUT_MS);
    } catch (error) {
        throw Object.assign(error, { phase: 'token', tokenMs: Date.now() - signInStarted });
    }
    const tokenMs = Date.now() - signInStarted;
    const reportStarted = Date.now();
    try {
        const { data } = await client.request({
            url: 'https://analyticsdata.googleapis.com/v1beta/properties/' + property + ':' + method,
            method: 'POST', data: request, timeout: REPORT_TIMEOUT_MS, retry: false
        });
        console.info('Google Analytics report loaded', { method, tokenMs, reportMs: Date.now() - reportStarted });
        return data;
    } catch (error) {
        throw Object.assign(error, { phase: 'report', tokenMs, reportMs: Date.now() - reportStarted });
    }
}

function activityTotals(data) {
    const metrics = data.rows?.[0]?.metricValues;
    return { activeUsers: Number(metrics?.[0]?.value ?? 0), pageViews: Number(metrics?.[1]?.value ?? 0) };
}

// GA4 exposes dateHourMinute as a string in the property's reporting time zone. Match whole
// hours and list the included minutes for partial hours so GA4 can deduplicate users over the window.
function lastDayFilters(start, end) {
    const hours = [];
    const dates = new Set();
    for (let time = start; time < end;) {
        const parts = Object.fromEntries(minuteFormat.formatToParts(time).map(({ type, value }) => [type, value]));
        dates.add(parts.year + '-' + parts.month + '-' + parts.day);
        const first = Number(parts.minute);
        const length = Math.min(60 - first, (end - time) / MINUTE_MS);
        const minutes = first === 0 && length === 60 ? '[0-5][0-9]' :
            '(?:' + Array.from({ length }, (_, i) => String(first + i).padStart(2, '0')).join('|') + ')';
        hours.push(parts.year + parts.month + parts.day + parts.hour + minutes);
        time += length * MINUTE_MS;
    }
    const days = [...dates];
    return {
        dateRanges: [{ startDate: days[0], endDate: days.at(-1) }],
        timeFilter: {
            filter: {
                fieldName: 'dateHourMinute',
                stringFilter: { matchType: 'FULL_REGEXP', value: '^(?:' + hours.join('|') + ')$' }
            }
        }
    };
}

function lastDayRequest(end) {
    const { dateRanges, timeFilter } = lastDayFilters(end - DAY_MS, end);
    return {
        dateRanges,
        metrics: activityMetrics,
        dimensionFilter: { andGroup: { expressions: [hostFilter, timeFilter] } }
    };
}

async function queryLastDay(config) {
    const end = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
    const data = await requestGoogleReport(config, 'runReport', lastDayRequest(end));
    return { totals: activityTotals(data), windowEnd: new Date(end).toISOString() };
}

async function realtimeReport() {
    const config = configuration();
    if (!config) return { configured: false };
    if (realtimeSaved && realtimeSaved.until > Date.now()) return realtimeSaved.report;
    if (!realtimeFetch) {
        realtimeFetch = requestGoogleReport(config, 'runRealtimeReport', {
            metrics: activityMetrics,
            dimensionFilter: realtimeFilter
        }).then(data => {
            const report = { configured: true, totals: activityTotals(data), fetchedAt: new Date().toISOString() };
            realtimeSaved = { report, until: Date.now() + REALTIME_CACHE_MS };
            return report;
        }).finally(() => { realtimeFetch = null; });
    }
    return realtimeFetch;
}

async function queryPages(config, method, request, dimension) {
    const data = await requestGoogleReport(config, method, {
        ...request,
        dimensions: [{ name: dimension }],
        metricFilter: { filter: { fieldName: 'screenPageViews', numericFilter: { operation: 'GREATER_THAN', value: { int64Value: '0' } } } },
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: String(PAGE_LIMIT)
    });
    const pages = (data.rows || []).map(row => ({
        page: row.dimensionValues[0].value,
        activeUsers: Number(row.metricValues[0].value),
        pageViews: Number(row.metricValues[1].value)
    }));
    const report = { pages, rowCount: data.rowCount ?? pages.length, fetchedAt: new Date().toISOString() };
    const totalViews = data.totals?.[0]?.metricValues[1]?.value;
    if (totalViews !== undefined) report.pageViews = Number(totalViews);
    else if (request.metricAggregations && report.rowCount === 0) report.pageViews = 0;
    return report;
}

async function pageViewsReport(range, windowEnd) {
    const config = configuration();
    if (!config) return { configured: false };
    if (range === 'realtime') {
        if (realtimePagesSaved?.until > Date.now()) return realtimePagesSaved.report;
        if (!realtimePagesFetch) {
            realtimePagesFetch = queryPages(config, 'runRealtimeReport', {
                metrics: activityMetrics, dimensionFilter: realtimeFilter
            }, 'unifiedScreenName').then(report => {
                realtimePagesSaved = { report, until: Date.now() + REALTIME_CACHE_MS };
                return report;
            }).finally(() => { realtimePagesFetch = null; });
        }
        return realtimePagesFetch;
    }

    const days = Number(range);
    const end = Date.parse(windowEnd);
    // A saved daily report can be 24 hours old, and its last day is a calendar date in GA4.
    const maxWindowAge = days === 1 ? (MAX_STALE_SECONDS + 60) * 1000 : 3 * DAY_MS;
    if (!Number.isFinite(end) || end % MINUTE_MS || end > Date.now() || end < Date.now() - maxWindowAge ||
        (days !== 1 && new Date(end).toISOString().slice(0, 10) !== windowEnd)) {
        throw Object.assign(new Error('Choose a current analytics report.'), { code: 'GA4_PAGES_WINDOW' });
    }
    const request = days === 1 ? lastDayRequest(end) : {
        dateRanges: [{ startDate: new Date(end - (days - 1) * DAY_MS).toISOString().slice(0, 10), endDate: windowEnd }],
        metrics: activityMetrics,
        dimensionFilter: hostFilter,
        metricAggregations: ['TOTAL']
    };
    const leaseId = await claimLease(days);
    if (!leaseId) {
        const { shared } = await readState(days);
        throw unavailable(shared.cooldown_left
            ? { kind: shared.cooldown_reason || 'rate_limit', retryAfter: shared.cooldown_left }
            : { kind: 'refreshing', retryAfter: Math.max(1, shared.lease_left || 1), refreshingDays: shared.refreshing_days || undefined });
    }
    let report;
    try {
        report = await queryPages(config, 'runReport', request, 'pagePath');
    } catch (error) {
        const details = failureDetails(error);
        const notice = cooldownFor(error, details);
        if (notice) {
            await startCooldown(leaseId, notice.retryAfter, notice.kind);
            console.error('Google Analytics page breakdown request failed', details);
            throw unavailable(notice);
        }
        await releaseLease(leaseId);
        throw error;
    }
    await releaseLease(leaseId);
    return report;
}

// ---- saved reports and the shared refresh lease -----------------------------------------
// All times are the database's own clock (now()), never an instance's.

// The shared refresh state (row 0) and the saved report for one range, with ages worked out by the database.
async function readState(days) {
    const { rows } = await query(
        `SELECT range_days, report, fetched_at,
                fetched_at > now() - make_interval(secs => $2) AS fresh,
                fetched_at > now() - make_interval(secs => $3) AS usable,
                refreshing_days, cooldown_reason,
                CASE WHEN lease_until > now() THEN LEAST($4, ceil(extract(epoch FROM lease_until - now()))::int) END AS lease_left,
                CASE WHEN cooldown_until > now() THEN ceil(extract(epoch FROM cooldown_until - now()))::int END AS cooldown_left
         FROM analytics_cache WHERE range_days IN (0, $1)`,
        [days, FRESH_SECONDS, MAX_STALE_SECONDS, LEASE_SECONDS]
    );
    const shared = rows.find(row => row.range_days === 0);
    const saved = rows.find(row => row.range_days === days);
    if (!shared || !saved) throw new Error('analytics_cache rows are missing; apply the database migrations');
    return { shared, saved };
}

// Claims the one refresh lease shared by the historical ranges. Returns the new lease ID, or null when
// another refresh holds an unexpired lease or a cooldown is running.
async function claimLease(days) {
    const { rows } = await query(
        `UPDATE analytics_cache
         SET lease_id = $1, lease_until = now() + make_interval(secs => $2), refreshing_days = $3
         WHERE range_days = 0
           AND (lease_until IS NULL OR lease_until <= now())
           AND (cooldown_until IS NULL OR cooldown_until <= now())
         RETURNING lease_id`,
        [crypto.randomUUID(), LEASE_SECONDS, days]
    );
    return rows[0]?.lease_id || null;
}

// Saves the report and releases the lease in one statement, only while the lease is still ours
// and unexpired. Returns the saved fetch time, or null when the lease was lost (nothing is written).
async function saveReport(leaseId, days, report) {
    const { rows } = await query(
        `WITH released AS (
             UPDATE analytics_cache SET lease_id = NULL, lease_until = NULL, refreshing_days = NULL
             WHERE range_days = 0 AND lease_id = $1 AND lease_until > now()
             RETURNING 1)
         UPDATE analytics_cache SET report = $3, fetched_at = now()
         WHERE range_days = $2 AND EXISTS (SELECT 1 FROM released)
         RETURNING fetched_at`,
        [leaseId, days, JSON.stringify(report)]
    );
    return rows[0]?.fetched_at || null;
}

// Starts a cooldown for historical ranges and releases the lease, only while the lease is still ours.
async function startCooldown(leaseId, seconds, reason) {
    const { rowCount } = await query(
        `UPDATE analytics_cache
         SET cooldown_until = now() + make_interval(secs => $2), cooldown_reason = $3,
             lease_id = NULL, lease_until = NULL, refreshing_days = NULL
         WHERE range_days = 0 AND lease_id = $1 AND lease_until > now()`,
        [leaseId, seconds, reason]
    );
    return rowCount === 1;
}

// Releases the lease without saving anything, only while it is still ours.
async function releaseLease(leaseId) {
    const { rowCount } = await query(
        `UPDATE analytics_cache SET lease_id = NULL, lease_until = NULL, refreshing_days = NULL
         WHERE range_days = 0 AND lease_id = $1 AND lease_until > now()`,
        [leaseId]
    );
    return rowCount === 1;
}

function leaseLost(days, step) {
    console.warn('Google Analytics refresh lease lost; nothing was written', { days, step });
}

function savedReport(saved, extra = {}) {
    return { configured: true, ...saved.report, fetchedAt: new Date(saved.fetched_at).toISOString(), ...extra };
}

// This request may not ask Google now: a cooldown is running or another refresh holds the lease.
// Shows the saved report (up to 24 hours old) with how long to wait, or says why there is none.
function waitResult({ shared, saved }) {
    const notice = shared.cooldown_left
        ? { kind: shared.cooldown_reason || 'rate_limit', retryAfter: shared.cooldown_left }
        : { kind: 'refreshing', retryAfter: Math.max(1, shared.lease_left || 1), refreshingDays: shared.refreshing_days || undefined };
    if (saved.usable) return savedReport(saved, { stale: true, notice });
    throw unavailable(notice);
}

// Called after a Google failure while holding the lease.
async function refreshFailed(error, days, leaseId) {
    const details = failureDetails(error);
    console.error('Google Analytics request failed', { days, ...details });
    const notice = cooldownFor(error, details);

    const written = notice ? await startCooldown(leaseId, notice.retryAfter, notice.kind) : await releaseLease(leaseId);
    if (!written) leaseLost(days, notice ? 'cooldown' : 'release');

    const { saved } = await readState(days);
    if (notice) {
        if (saved.usable) return savedReport(saved, { stale: true, notice });
        throw unavailable(notice);
    }
    // Other temporary failures: keep showing the saved report. Setup mistakes (4xx) are reported instead.
    if (saved.usable && (details.status === undefined || details.status >= 500)) {
        return savedReport(saved, { stale: true, notice: { kind: 'unavailable' } });
    }
    throw error;
}

async function refresh(config, days, leaseId) {
    let state;
    try {
        // Another instance may have saved this range between our first read and our claim.
        state = await readState(days);
    } catch (error) {
        await releaseLease(leaseId).catch(() => {});
        throw error;
    }
    if (state.saved.fresh) {
        if (!(await releaseLease(leaseId))) leaseLost(days, 'release');
        return savedReport(state.saved);
    }

    let data;
    try {
        data = await queryReports(config, days);
    } catch (error) {
        return refreshFailed(error, days, leaseId);
    }
    const fetchedAt = await saveReport(leaseId, days, data);
    if (!fetchedAt) {
        // A newer refresh owns the lease now. The report is still genuine, so this request
        // shows it, but it is not saved and cannot replace what the newer refresh saves.
        leaseLost(days, 'save');
        return { configured: true, ...data, fetchedAt: new Date().toISOString() };
    }
    return { configured: true, ...data, fetchedAt: new Date(fetchedAt).toISOString() };
}

async function trafficReport(days) {
    const config = configuration();
    if (!config) return { configured: false };
    let state = await readState(days);
    if (state.saved.fresh) return savedReport(state.saved);
    if (state.shared.cooldown_left || state.shared.lease_left) return waitResult(state);

    const leaseId = await claimLease(days);
    if (!leaseId) {
        // Lost the race to another instance, or a cooldown started in between.
        state = await readState(days);
        if (state.saved.fresh) return savedReport(state.saved);
        return waitResult(state);
    }
    return refresh(config, days, leaseId);
}

module.exports = {
    trafficReport, realtimeReport, pageViewsReport, failureDetails,
    // The lease-guarded steps, for tests.
    _lease: { claimLease, saveReport, startCooldown, releaseLease, readState }
};

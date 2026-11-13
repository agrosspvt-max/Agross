'use strict';

const { JWT } = require('google-auth-library');

const CACHE_MS = 5 * 60 * 1000;
const MAX_STALE_MS = 24 * 60 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 60 * 1000;
// Leave time for authentication and the response within the 20-second admin function limit.
const REPORT_TIMEOUT_MS = 15 * 1000;
const cache = new Map();
let client;
let quotaResetAt = 0;

function failureDetails(error) {
    const status = error.response?.status ?? error.status;
    const code = [error.cause?.code, error.code, error.cause?.name, error.name]
        .find(value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value));
    const googleStatus = error.response?.data?.error?.status;
    return {
        status: Number.isInteger(status) ? status : undefined,
        code,
        googleStatus: typeof googleStatus === 'string' && /^[A-Z_]{1,40}$/.test(googleStatus) ? googleStatus : undefined
    };
}

function quotaError() {
    return Object.assign(new Error('Google Analytics request limit reached'), {
        status: 429,
        code: 'GA4_RATE_LIMIT',
        retryAfter: Math.max(1, Math.ceil((quotaResetAt - Date.now()) / 1000))
    });
}

function recordQuotaLimit(error) {
    const header = error.response?.headers?.get?.('retry-after');
    const now = Date.now();
    const retryAt = /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header);
    quotaResetAt = Math.max(quotaResetAt, Number.isFinite(retryAt) && retryAt > now ? retryAt : now + QUOTA_COOLDOWN_MS);
}

function configuration() {
    const property = process.env.GA_PROPERTY_ID?.trim();
    const credentials = process.env.GA_SERVICE_ACCOUNT_JSON;
    if (!property || !credentials) return null;
    if (!/^\d+$/.test(property)) throw new Error('Invalid GA4 property ID');
    if (!client) {
        const key = JSON.parse(credentials);
        if (key.type !== 'service_account' || !key.client_email || !key.private_key) {
            throw new Error('Invalid GA4 service account credentials');
        }
        client = new JWT({
            email: key.client_email,
            key: key.private_key,
            scopes: ['https://www.googleapis.com/auth/analytics.readonly']
        });
    }
    return { property, client };
}

async function queryReports({ property, client }, days) {
    const dateRanges = [{ startDate: days + 'daysAgo', endDate: 'yesterday' }];
    const dimensionFilter = {
        filter: { fieldName: 'hostName', inListFilter: { values: ['agross.in', 'www.agross.in'] } }
    };
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
        { metrics: visitorsAndVisits },
        { dimensions: [{ name: 'date' }], metrics: visitorsAndVisits, orderBys: [{ dimension: { dimensionName: 'date' } }] },
        top(['sessionSourceMedium'], 'sessions'),
        top(['country'], 'totalUsers'),
        top(['country', 'region'], 'totalUsers')
    ].map(report => ({ ...report, dateRanges, dimensionFilter }));

    const { data } = await client.request({
        url: 'https://analyticsdata.googleapis.com/v1beta/properties/' + property + ':batchRunReports',
        method: 'POST', data: { requests }, timeout: REPORT_TIMEOUT_MS, retry: false
    });
    if (!Array.isArray(data.reports) || data.reports.length !== requests.length) {
        throw new Error('Incomplete GA4 report');
    }

    const [total, trend, sources, countries, regions] = data.reports.map(report => report.rows || []);
    const dimension = (row, index) => row.dimensionValues[index].value;
    const metric = (row, index) => Number(row?.metricValues[index]?.value || 0);
    const counts = row => ({ visitors: metric(row, 0), visits: metric(row, 1) });
    const timeZone = data.reports[0].metadata?.timeZone || 'Asia/Kolkata';
    const updatedAt = new Date();
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(updatedAt);
    const rowsByDate = new Map(trend.map(row => [dimension(row, 0), counts(row)]));
    const daily = Array.from({ length: days }, (_, index) => {
        const day = new Date(today + 'T00:00:00Z');
        day.setUTCDate(day.getUTCDate() - days + index);
        const date = day.toISOString().slice(0, 10);
        return { date, ...(rowsByDate.get(date.replaceAll('-', '')) || counts()) };
    });
    return {
        totals: counts(total[0]),
        daily,
        sources: sources.map(row => ({ source: dimension(row, 0), visits: metric(row, 0) })),
        countries: countries.map(row => ({ country: dimension(row, 0), visitors: metric(row, 0) })),
        regions: regions.map(row => ({ country: dimension(row, 0), region: dimension(row, 1), visitors: metric(row, 0) })),
        timeZone,
        updatedAt: updatedAt.toISOString()
    };
}

async function trafficReport(days) {
    const config = configuration();
    if (!config) return { configured: false };
    const entry = cache.get(days);
    const now = Date.now();
    if (entry?.pending) return entry.pending;
    if (entry?.expiresAt > now) return entry.report;

    const stale = entry?.report && now - Date.parse(entry.report.updatedAt) < MAX_STALE_MS
        ? { ...entry.report, stale: true }
        : null;
    if (quotaResetAt > now) {
        if (stale) return stale;
        throw quotaError();
    }

    const pending = queryReports(config, days).then(data => {
        const report = { configured: true, ...data };
        cache.set(days, { report, expiresAt: Date.now() + CACHE_MS });
        return report;
    }).catch(error => {
        const details = failureDetails(error);
        if (stale) cache.set(days, entry);
        else cache.delete(days);
        if (details.status === 429) {
            console.error('Google Analytics request failed', details);
            recordQuotaLimit(error);
            if (stale) return stale;
            throw quotaError();
        }
        if (stale && (details.status >= 500 || details.status === undefined)) {
            console.error('Google Analytics request failed', details);
            return stale;
        }
        throw error;
    });
    cache.set(days, { pending });
    return pending;
}

module.exports = { trafficReport, failureDetails };

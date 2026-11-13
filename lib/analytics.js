'use strict';

const { JWT } = require('google-auth-library');

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
let client;

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
        method: 'POST', data: { requests }, timeout: 8000, retry: false
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
    if (entry?.pending || entry?.expiresAt > Date.now()) return entry.pending || entry.report;

    const pending = queryReports(config, days).then(data => {
        const report = { configured: true, ...data };
        cache.set(days, { report, expiresAt: Date.now() + CACHE_MS });
        return report;
    }).catch(error => {
        cache.delete(days);
        throw error;
    });
    cache.set(days, { pending });
    return pending;
}

module.exports = { trafficReport };

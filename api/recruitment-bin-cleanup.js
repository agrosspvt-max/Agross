'use strict';

// Scheduled cleanup of the Recruitment Bin. Vercel calls this once a day (see "crons" in vercel.json), whether or
// not anyone has opened the admin, and it deletes applications whose 30 days have ended.
//
// Vercel sends CRON_SECRET as "Authorization: Bearer <secret>". Without a matching secret this does nothing: it never
// uses an admin session, and it fails closed when CRON_SECRET is not set. Delivery is best effort and can repeat or
// skip a run, so the cleanup only ever deletes what is past its stored deadline and is safe to run any number of times.
// The response and the logs carry counts only, never applicant details.

const { safeEqual } = require('../lib/security');
const { purgeExpired } = require('../lib/recruitment-bin');

module.exports = async function recruitmentBinCleanup(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).json({ ok: false });
    }
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        console.error('Recruitment Bin cleanup refused: CRON_SECRET is not set');
        return res.status(401).json({ ok: false });
    }
    if (!safeEqual(String(req.headers.authorization || ''), 'Bearer ' + secret)) {
        return res.status(401).json({ ok: false });
    }
    try {
        const result = await purgeExpired();
        console.info('Recruitment Bin cleanup', result);
        return res.status(200).json({ ok: true, ...result });
    } catch (error) {
        console.error('Recruitment Bin cleanup failed', { code: error && error.code, name: error && error.name });
        return res.status(500).json({ ok: false });
    }
};

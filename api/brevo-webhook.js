'use strict';

// Receives delivery events from Brevo. Delivery is recorded only when Brevo says so.
// Brevo must be configured to send the shared secret as "Authorization: Bearer <secret>"
// (or as ?token=<secret> on the webhook URL). Configuring it is a live-account step.

const { safeEqual } = require('../lib/security');
const { applyWebhookEvent } = require('../lib/notify');

module.exports = async function brevoWebhook(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ message: 'POST only.' });
    }
    const secret = process.env.BREVO_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ message: 'Webhook is not configured.' });

    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const url = new URL(req.url || '/', 'http://localhost');
    const supplied = bearer || url.searchParams.get('token') || '';
    if (!supplied || !safeEqual(supplied, secret)) return res.status(401).json({ message: 'Not authorised.' });

    const events = Array.isArray(req.body) ? req.body : [req.body];
    try {
        let matched = 0;
        for (const event of events.slice(0, 50)) {
            if (event && typeof event === 'object' && (await applyWebhookEvent(event)).matched) matched++;
        }
        return res.status(200).json({ received: events.length, matched });
    } catch (error) {
        console.error('Brevo webhook could not be applied', { code: error && error.code });
        return res.status(500).json({ message: 'Could not record the event.' });
    }
};

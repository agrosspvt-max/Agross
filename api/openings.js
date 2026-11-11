'use strict';

const { validId, publicOpenings } = require('../lib/recruiting');

module.exports = async function openings(req, res) {
    // Closed roles should stop showing as soon as the admin saves.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ message: 'Method not allowed.' });
    }
    const id = req.query?.id;
    if (id !== undefined && !validId(id)) return res.status(404).json({ message: 'This opening is no longer available.' });
    try {
        const rows = await publicOpenings(id);
        if (id && !rows.length) return res.status(404).json({ message: 'This opening is no longer available.' });
        return res.status(200).json(id ? { opening: rows[0] } : { openings: rows });
    } catch (error) {
        console.error('Openings could not be loaded', { code: error && error.code });
        return res.status(503).json({ message: 'Could not load openings. Please try again later.' });
    }
};

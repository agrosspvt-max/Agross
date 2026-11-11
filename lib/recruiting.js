'use strict';

const { query, withTransaction } = require('./db');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = value => typeof value === 'string' && UUID.test(value);

async function publicOpenings(id) {
    const { rows } = await query(
        'SELECT id, designation, area, description FROM job_openings WHERE is_open' +
        (id ? ' AND id = $1' : ' ORDER BY created_at DESC, id'),
        id ? [id] : []
    );
    return rows;
}

async function adminOpenings() {
    const { rows } = await query(
        'SELECT id, designation, area, description, is_open AS "isOpen", updated_at AS "updatedAt" ' +
        'FROM job_openings ORDER BY is_open DESC, created_at DESC, id'
    );
    return rows;
}

function validateOpening(body) {
    if (!body || typeof body.designation !== 'string' || typeof body.description !== 'string' || typeof body.isOpen !== 'boolean') {
        return { error: 'Enter a designation, description and status.' };
    }
    if (body.id !== undefined && !validId(body.id)) return { error: 'Choose a valid opening.' };
    const designation = body.designation.trim();
    const description = body.description.replace(/\r\n?/g, '\n').trim();
    const area = typeof body.area === 'string' ? body.area.trim() : '';
    if (!designation || designation.length > 120 || /[\x00-\x1f\x7f]/.test(designation)) {
        return { error: 'Enter a designation on one line, up to 120 characters.' };
    }
    if ((body.area != null && typeof body.area !== 'string') || area.length > 120 || /[\x00-\x1f\x7f]/.test(area)) {
        return { error: 'Enter an area on one line, up to 120 characters.' };
    }
    if (!description || description.length > 5000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(description)) {
        return { error: 'Enter a description up to 5,000 characters without unsupported characters.' };
    }
    return { opening: { id: body.id, designation, area: area || null, description, isOpen: body.isOpen } };
}

async function saveOpening(opening, actorId) {
    const { id, designation, area, description, isOpen } = opening;
    return withTransaction(async client => {
        const fields = ' RETURNING id, designation, area, description, is_open AS "isOpen", updated_at AS "updatedAt"';
        const values = [designation, area, description, isOpen];
        const { rows: [saved] } = id
            ? await client.query('UPDATE job_openings SET designation = $1, area = $2, description = $3, is_open = $4, updated_at = now() WHERE id = $5' + fields, [...values, id])
            : await client.query('INSERT INTO job_openings (designation, area, description, is_open) VALUES ($1, $2, $3, $4)' + fields, values);
        if (!saved) return null;
        await client.query(
            "INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, 'job_opening', $3, $4)",
            [actorId, id ? 'job_opening_updated' : 'job_opening_created', saved.id, JSON.stringify({ isOpen })]
        );
        return saved;
    });
}

module.exports = { validId, publicOpenings, adminOpenings, validateOpening, saveOpening };

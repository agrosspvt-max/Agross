'use strict';

// The four public enquiry forms: field lists, validation and the summary shown in the admin inbox.

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const PLACEHOLDERS = new Set(['State', 'SelectState', 'Select State', 'District', 'Select district', 'Select Profile']);
const MAX_RESUME_BYTES = 2 * 1024 * 1024;

// Each field: [key, label, maximum length]
const FORMS = {
    contact: {
        title: 'General Contact',
        subject: 'Contact Us Request',
        optional: ['website', 'phone'],
        fields: [['name', 'Name', 120], ['email', 'Email', 254], ['website', 'Website', 500], ['phone', 'Phone No', 40], ['message', 'Message', 5000]]
    },
    dealership: {
        title: 'Dealership',
        subject: 'Dealership Request',
        fields: [['name', 'Name', 120], ['firm', 'Firm Name', 200], ['mobile', 'Mobile No', 40], ['state', 'State', 100], ['district', 'District', 100], ['teshil', 'Tehsil', 150], ['email', 'Email', 254], ['dealers', 'Dealer Type', 100], ['remark', 'Remark', 5000]]
    },
    farming: {
        title: 'Contract or Custom Farming',
        subject: 'Contract/Custom farming Request',
        fields: [['name', 'Company Name', 200], ['email', 'Email', 254], ['mobile', 'Mobile No', 40], ['authorised', 'Authorised Person', 120], ['produce', 'Produce', 200], ['quantity', 'Approx Quantity', 200], ['address', 'Address', 2000]]
    },
    recruitment: {
        title: 'Recruitment',
        subject: 'Join Us Request',
        fields: [['name', 'Name', 120], ['contact', 'Contact No', 40], ['email', 'Email', 254], ['profile', 'Profile', 150], ['state', 'State', 100], ['address', 'Address', 2000]]
    }
};

const FORM_TYPES = Object.keys(FORMS);

function isFormType(value) {
    return typeof value === 'string' && Object.hasOwn(FORMS, value);
}

// Returns { values } or { error }. Never trusts the client's types.
function validate(body, { hasOpening = false } = {}) {
    const form = FORMS[body.formType];
    const values = {};
    for (const [field, label, maxLength] of form.fields) {
        if (field === 'profile' && hasOpening) continue; // Set from the opening when saving.
        const value = body[field];
        if (form.optional?.includes(field) && (value === undefined || (typeof value === 'string' && !value.trim()))) {
            continue;
        }
        if (typeof value !== 'string' || !value.trim() || PLACEHOLDERS.has(value.trim())) {
            return { error: 'Please enter a valid ' + label.toLowerCase() + '.' };
        }
        values[field] = value.trim();
        if (values[field].length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(values[field])) {
            return { error: label + ' is too long or contains unsupported characters.' };
        }
    }
    if (!EMAIL_PATTERN.test(values.email) || /[\r\n]/.test(values.email)) {
        return { error: 'Please enter a valid email address.' };
    }
    return { values };
}

function validateResume(formType, upload) {
    if (upload === undefined || (formType === 'recruitment' && upload === '')) return {};
    if (formType !== 'recruitment') return { error: 'Only the Join Us form accepts attachments.' };
    if (!upload || typeof upload.name !== 'string' || !/\.pdf$/i.test(upload.name) || typeof upload.content !== 'string') {
        return { error: 'Please attach a PDF resume.' };
    }
    const tooLarge = { status: 413, error: 'Please choose a PDF resume that is 2 MB or smaller.' };
    if (upload.content.length > 4 * Math.ceil(MAX_RESUME_BYTES / 3)) return tooLarge;
    const data = Buffer.from(upload.content, 'base64');
    if (data.length > MAX_RESUME_BYTES) return tooLarge;
    if (data.toString('base64') !== upload.content ||
        !/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(data.subarray(0, 12).toString('latin1')) ||
        !/%%EOF[\x00\t\n\f\r ]*$/.test(data.subarray(-1024).toString('latin1'))) {
        return { error: 'Please attach a valid PDF resume.' };
    }
    const name = upload.name.split(/[\\/]/).pop().slice(0, -4).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100);
    return { resume: { filename: (name || 'resume') + '.pdf', data } };
}

// Columns used by the inbox list and search.
function summarize(formType, values) {
    const phone = values.phone || values.mobile || values.contact || null;
    let company = null;
    if (formType === 'dealership') company = values.firm || null;
    if (formType === 'farming') company = values.name || null;
    const displayName = formType === 'dealership' && values.firm ? values.name + ' (' + values.firm + ')' : values.name;
    const searchText = [values.name, values.firm, values.email, phone, values.profile].filter(Boolean).join(' ').toLowerCase();
    return { displayName, company, email: values.email, phone, searchText };
}

// Ordered { key, label, value } rows for the detail page and the notification email.
function labelledFields(formType, values) {
    return FORMS[formType].fields
        .filter(([key]) => Object.hasOwn(values, key))
        .map(([key, label]) => ({ key, label, value: values[key] }));
}

module.exports = { EMAIL_PATTERN, FORMS, FORM_TYPES, isFormType, validate, validateResume, summarize, labelledFields };

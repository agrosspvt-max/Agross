'use strict';

// The product content model: cleaning, validation, the public JSON shape and the listing-page cards.
// Pure functions only; the database code lives in catalogue-store.js.

const LISTING_PAGES = {
    chemicals: {
        title: 'Chemical grid', template: 'chemicals.html',
        gridClass: 'grid mt-30 gap-30 grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2'
    },
    nonchemical: {
        title: 'Non-chemical grid', template: 'nonchemical.html',
        gridClass: 'grid mt-30 gap-30 grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4'
    }
};

const CATALOGUES = {
    chemical: { title: 'Chemical', detailPage: 'product.html', defaultListing: 'chemicals' },
    nonchemical: { title: 'Non-chemical', detailPage: 'nonchemical-details.html', defaultListing: 'nonchemical' }
};

const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9 -]{0,79}$/;
const LEGACY_IMAGE_PATTERN = /^products\/[^/\\<>"']+\.(png|jpe?g|webp)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// field -> maximum length
const TEXT_FIELDS = {
    name: 120, category: 120, subcategory: 200, type: 40, description: 2000,
    target_crops: 1000, target_pests: 1000, target_diseases: 1000, target_insects: 1000, target_weeds: 1000, target: 1000,
    application: 300, dose: 300, packing: 300, tags: 600, image_alt: 200
};
const RICH_FIELDS = { technical: 2000, benefits: 3000 };

const FIELD_LABELS = {
    name: 'Name', category: 'Category', subcategory: 'Subcategory', type: 'Type', description: 'Description',
    technical: 'Technical details', target_crops: 'Target crops', target_pests: 'Target pests', target_diseases: 'Target diseases',
    target_insects: 'Target insects', target_weeds: 'Target weeds', target: 'Target', benefits: 'Benefits', application: 'Application',
    dose: 'Dose', packing: 'Packing', tags: 'Tags', image_alt: 'Image description', aliases: 'Search aliases',
    listing_page: 'Listing', listing_tab: 'Listing tab', display_order: 'Display order', image: 'Image', image_id: 'Image'
};

// Public JSON names (kept as they are in chemical.json / nonchemical.json).
const PUBLIC_NAMES = {
    technical: 'technical', target_crops: 'targetcrops', target_pests: 'targetpests', target_diseases: 'targetdiseases',
    target_insects: 'targetinsects', target_weeds: 'targetweeds', target: 'target', benefits: 'benefits',
    application: 'application', dose: 'dose', packing: 'packing', category: 'category', subcategory: 'subcategory',
    type: 'type', tags: 'tags', description: 'description'
};

function decodeEntities(text) {
    return String(text).replace(/&(amp|lt|gt|quot|#39);/g, (match, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]);
}

function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Only line breaks and simple emphasis are allowed in the rich fields; everything else becomes plain text.
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'sub', 'sup']);

function sanitizeRich(input) {
    const text = String(input);
    const parts = text.split(/(<br\s*\/?>|<\/?(?:b|strong|i|em|u|sub|sup)\s*>)/gi);
    const open = [];
    let out = '';
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i % 2 === 0) {
            // Plain text: escape it, keeping entities that are already well formed.
            out += part.replace(/&(?!(?:amp|lt|gt|quot|#39|#\d+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        } else if (/^<br/i.test(part)) {
            out += '<br>';
        } else {
            const closing = part[1] === '/';
            const tag = part.replace(/[<>/\s]/g, '').toLowerCase();
            if (!closing) { open.push(tag); out += '<' + tag + '>'; }
            else if (open.lastIndexOf(tag) !== -1) {
                // Close anything left open inside this tag first, so nesting stays valid.
                while (open.length) { const top = open.pop(); out += '</' + top + '>'; if (top === tag) break; }
            }
        }
    }
    while (open.length) out += '</' + open.pop() + '>';
    return out;
}

function emptyContent() {
    const content = { aliases: [], listing_page: null, listing_tab: null, display_order: null, image: null, image_id: null };
    for (const field of [...Object.keys(TEXT_FIELDS), ...Object.keys(RICH_FIELDS)]) content[field] = '';
    return content;
}

// Turns anything an editor (or the import) sends into clean content. Never throws.
function cleanContent(input = {}) {
    const content = emptyContent();
    for (const field of Object.keys(TEXT_FIELDS)) {
        if (typeof input[field] === 'string') content[field] = input[field].replace(/\r\n?/g, '\n').trim();
    }
    for (const field of Object.keys(RICH_FIELDS)) {
        if (typeof input[field] === 'string') content[field] = sanitizeRich(input[field].replace(/\r\n?/g, '\n').trim());
    }
    if (Array.isArray(input.aliases)) {
        const seen = new Set();
        for (const alias of input.aliases) {
            if (typeof alias !== 'string') continue;
            const value = alias.trim();
            if (value && !seen.has(value.toLowerCase())) { seen.add(value.toLowerCase()); content.aliases.push(value); }
        }
    }
    content.listing_page = Object.hasOwn(LISTING_PAGES, input.listing_page) ? input.listing_page : null;
    content.listing_tab = typeof input.listing_tab === 'string' && input.listing_tab ? input.listing_tab : null;
    if (!content.listing_page) content.listing_tab = null;
    const order = Number(input.display_order);
    content.display_order = input.display_order === null || input.display_order === '' || input.display_order === undefined || !Number.isFinite(order) ? null : Math.round(order);
    content.image = typeof input.image === 'string' && input.image ? input.image.trim() : null;
    content.image_id = typeof input.image_id === 'string' && input.image_id ? input.image_id.trim() : null;
    if (content.image_id) content.image = content.image && LEGACY_IMAGE_PATTERN.test(content.image) ? content.image : null;
    return content;
}

// Returns { errors: { field: message }, warnings: [message] }. Errors block publishing; warnings do not.
function validateContent(content, { tabs = [], knownCategories = [] } = {}) {
    const errors = {};
    const warnings = [];
    for (const [field, max] of Object.entries({ ...TEXT_FIELDS, ...RICH_FIELDS })) {
        if (content[field] && content[field].length > max) errors[field] = FIELD_LABELS[field] + ' is longer than ' + max + ' characters.';
        else if (CONTROL_CHARS.test(content[field] || '')) errors[field] = FIELD_LABELS[field] + ' contains unsupported characters.';
    }
    if (!content.name) errors.name = 'Enter a name.';
    if (!content.category) errors.category = 'Enter a category.';
    if (content.aliases.length > 20 || content.aliases.some(alias => alias.length > 60)) errors.aliases = 'Use at most 20 aliases of up to 60 characters.';
    if (content.listing_page && content.listing_tab && !tabs.some(tab => tab.listing_page === content.listing_page && tab.key === content.listing_tab)) {
        errors.listing_tab = 'Choose a tab that belongs to this grid.';
    }
    if (content.image && !LEGACY_IMAGE_PATTERN.test(content.image)) errors.image = 'The image path is not valid.';
    if (content.image_id && !UUID_PATTERN.test(content.image_id)) errors.image = 'The uploaded image is not valid.';
    if ((content.image || content.image_id) && !content.image_alt) errors.image_alt = 'Describe the image for people who cannot see it.';
    if (!content.image && !content.image_id) warnings.push('No image yet. The product will show the Agross logo as a placeholder.');
    if (content.listing_page && !content.listing_tab) warnings.push('No tab chosen: the product appears only under "All" in its grid.');
    if (!content.listing_page) warnings.push('Not listed in any grid. It stays reachable by its link and in search.');
    if (content.category && knownCategories.length && !knownCategories.some(known => known.toLowerCase() === content.category.toLowerCase())) {
        warnings.push('"' + content.category + '" is a new category for this catalogue.');
    }
    if (!content.technical) warnings.push('No technical details yet.');
    return { errors, warnings };
}

function imageUrl(content) {
    return content.image_id ? '/api/image?id=' + content.image_id : (content.image || '');
}

// The record served to visitors: same names as the original JSON files, empty fields left out.
function toPublic(catalogue, productId, content) {
    const record = { productId, image: imageUrl(content), name: content.name };
    for (const [field, publicName] of Object.entries(PUBLIC_NAMES)) {
        if (content[field]) record[publicName] = content[field];
    }
    if (content.aliases.length) record.aliases = content.aliases;
    if (content.image_alt) record.imageAlt = content.image_alt;
    record.catalogue = catalogue;
    return record;
}

// ---- listing pages -----------------------------------------------------------------

const CARD_LABEL_CLASS = 'inline-block text-white hover:text-primary-color ease-in duration-300';

function productHref(catalogue, productId) {
    return CATALOGUES[catalogue].detailPage + '?productId=' + encodeURIComponent(productId);
}

function renderCard(catalogue, productId, content) {
    const href = escapeHtml(productHref(catalogue, productId));
    const src = escapeHtml(imageUrl(content) || 'assets/agross-logo.png');
    const label = escapeHtml(content.name);
    return [
        '                        <div class="relative background11">',
        '                            <a href="' + href + '" class="block">',
        '                                <img src="' + src + '"',
        '                                    class="imagep mb-25 rounded-sm md:rounded-md lg:rounded-lg" alt="portfolio-image">',
        '                            </a>',
        '                            <h3',
        '                                class="font-bold text-18px md:text-20px lg:text-22px mb-10 lg:mb-12 text-center text-container">',
        '                                <a href="' + href + '"',
        '                                    class="' + CARD_LABEL_CLASS + '">',
        '                                    ' + label,
        '                                </a>',
        '                            </h3>',
        '                        </div>'
    ].join('\n');
}

const TAB_SPAN_CLASS = 'text-black-color text-15px lg:text-16px rounded-sm font-semibold bg-[#F5F0E8] relative pl-20 md:pl-25 pr-20 md:pr-25 pt-12 pb-12 hover:text-white cursor-pointer block z-1 ease-in duration-300 before:absolute before:left-0 before:right-0 before:top-0 before:bottom-0 before:opacity-0 before:invisible before:ease-in before:duration-300 before:-z-1 before:rounded-sm before:bg-secondary-gradient-color hover:before:opacity-100 hover:before:visible';

function renderTabButton(id, label, current) {
    return [
        '                    <li class="tab-link ' + (current ? 'current ' : '') + 'mb-12 last:mb-0 lg:mb-0 ' + (current ? '' : 'inline-block ') + 'ml-5 mr-5' + (current ? ' inline-block' : '') + '" data-tab="' + id + '">',
        '                        <span',
        '                            class="' + TAB_SPAN_CLASS + '">',
        '                            ' + escapeHtml(label),
        '                        </span>',
        '                    </li>'
    ].join('\n');
}

function renderTabContent(id, gridClass, cards, current) {
    return [
        '                <div id="' + id + '" class="tab-content' + (current ? ' current' : '') + '">',
        '                    <div',
        '                        class="' + gridClass + '">',
        cards.join('\n'),
        '                    </div>',
        '                </div>'
    ].join('\n');
}

/*
 * Builds the tab buttons and grids for one listing page.
 *   products: [{ catalogue, productId, content }] that are published
 *   tabs: [{ key, label, display_order }] for this page
 * A grid lists every product placed on the page under "All", and the same products again under their tab.
 */
function renderListing(pageKey, products, tabs) {
    const gridClass = LISTING_PAGES[pageKey].gridClass;
    const placed = products
        .filter(product => product.content.listing_page === pageKey)
        .sort((a, b) => {
            const left = a.content.display_order === null ? Infinity : a.content.display_order;
            const right = b.content.display_order === null ? Infinity : b.content.display_order;
            return (left - right) || a.content.name.localeCompare(b.content.name) || a.productId.localeCompare(b.productId);
        });
    const orderedTabs = [...tabs].sort((a, b) => a.display_order - b.display_order);
    const buttons = [renderTabButton('tab-1', 'All', true)];
    const contents = [renderTabContent('tab-1', gridClass, placed.map(p => renderCard(p.catalogue, p.productId, p.content)), true)];
    orderedTabs.forEach((tab, index) => {
        const id = 'tab-' + (index + 2);
        const inTab = placed.filter(p => p.content.listing_tab === tab.key);
        buttons.push(renderTabButton(id, tab.label, false));
        contents.push(renderTabContent(id, gridClass, inTab.map(p => renderCard(p.catalogue, p.productId, p.content)), false));
    });
    return [
        '                <ul class="tabs text-center mb-25 md:mb-35 lg:mb-30 xl:mb-50">',
        buttons.join('\n'),
        '                </ul>',
        contents.join('\n')
    ].join('\n');
}

const START_MARKER = '<!-- catalogue:start -->';
const END_MARKER = '<!-- catalogue:end -->';

// Replaces the region between the markers in a listing page template.
function fillTemplate(template, regionHtml) {
    const start = template.indexOf(START_MARKER);
    const end = template.indexOf(END_MARKER);
    if (start === -1 || end === -1 || end < start) throw new Error('Listing template has no catalogue markers');
    return template.slice(0, start + START_MARKER.length) + '\n' + regionHtml + '\n                ' + template.slice(end);
}

module.exports = {
    LISTING_PAGES, CATALOGUES, PRODUCT_ID_PATTERN, LEGACY_IMAGE_PATTERN, UUID_PATTERN, TEXT_FIELDS, RICH_FIELDS, FIELD_LABELS,
    decodeEntities, escapeHtml, sanitizeRich, emptyContent, cleanContent, validateContent, imageUrl, toPublic,
    productHref, renderCard, renderListing, fillTemplate, START_MARKER, END_MARKER
};

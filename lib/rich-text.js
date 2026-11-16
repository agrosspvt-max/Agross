'use strict';

// Formatted text for job openings. Text is stored and exchanged as data, never as HTML:
//
//   Rich      = Paragraph[]              (the main description and each section description)
//   Paragraph = Run[]
//   Run       = { t: string, b?: true, i?: true }   t may contain "\n" for a line break inside a paragraph
//   Heading   = Run[] on one line, with an explicit b: true or false on every run (headings start bold)
//
// Because nothing here is markup, pasted or submitted text can only ever be shown as text: the public page builds
// elements with the DOM and sets text, so a script tag in a description is just words.

const MAX_PARAGRAPHS = 100;
const MAX_RUNS = 400;
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/;

function cleanText(text) {
    return text.replace(/\r\n?/g, '\n').replace(/​/g, '').replace(/ /g, ' ').replace(/\t/g, ' ');
}

function fail(message) {
    return { error: message };
}

// Checks and tidies one list of runs. Returns { runs } or { error }.
function cleanRuns(input, { singleLine = false, heading = false } = {}) {
    if (!Array.isArray(input) || input.length > MAX_RUNS) return fail('The text is not in a supported format.');
    const runs = [];
    for (const run of input) {
        if (!run || typeof run !== 'object' || Array.isArray(run) || typeof run.t !== 'string') return fail('The text is not in a supported format.');
        for (const flag of ['b', 'i']) {
            if (run[flag] !== undefined && typeof run[flag] !== 'boolean') return fail('The text is not in a supported format.');
        }
        let text = cleanText(run.t);
        if (!text.isWellFormed() || CONTROL.test(text)) return fail('The text contains unsupported characters.');
        if (singleLine) text = text.replace(/\n+/g, ' ');
        if (!text) continue;
        const bold = heading ? run.b !== false : run.b === true;
        const italic = run.i === true;
        const last = runs[runs.length - 1];
        if (last && last.b === bold && last.i === italic) last.t += text;
        else runs.push({ t: text, b: bold, i: italic });
    }
    // Trim the ends, and keep at most one blank line's worth of line breaks inside.
    for (const run of runs) run.t = run.t.replace(/\n{3,}/g, '\n\n');
    while (runs.length && !runs[0].t.replace(/^[\s]+/, '')) runs.shift();
    if (runs.length) runs[0].t = runs[0].t.replace(/^\s+/, '');
    while (runs.length && !runs[runs.length - 1].t.replace(/\s+$/, '')) runs.pop();
    if (runs.length) runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, '');
    return { runs };
}

// The stored shape: b and i only when true, except headings, which always say whether they are bold.
function compact(runs, heading) {
    return runs.map(run => {
        const out = { t: run.t };
        if (heading) out.b = run.b;
        else if (run.b) out.b = true;
        if (run.i) out.i = true;
        return out;
    });
}

function plainOfRuns(runs) {
    return runs.map(run => run.t).join('');
}

function plainFromRich(paragraphs) {
    return paragraphs.map(plainOfRuns).join('\n\n');
}

// Returns { value, plain } or { error }. Paragraphs with no text are dropped.
function cleanRich(input, { maxChars }) {
    if (!Array.isArray(input) || input.length > MAX_PARAGRAPHS * 2) return fail('The text is not in a supported format.');
    const paragraphs = [];
    for (const paragraph of input) {
        const checked = cleanRuns(paragraph);
        if (checked.error) return checked;
        if (checked.runs.length) paragraphs.push(compact(checked.runs, false));
    }
    if (paragraphs.length > MAX_PARAGRAPHS) return fail('Use at most ' + MAX_PARAGRAPHS + ' paragraphs.');
    const plain = plainFromRich(paragraphs);
    if (plain.length > maxChars) return fail('Use at most ' + maxChars.toLocaleString('en-US') + ' characters.');
    return { value: paragraphs, plain };
}

function cleanHeading(input, { maxChars }) {
    const checked = cleanRuns(input, { singleLine: true, heading: true });
    if (checked.error) return checked;
    const plain = plainOfRuns(checked.runs);
    if (plain.length > maxChars) return fail('Use at most ' + maxChars + ' characters.');
    return { value: compact(checked.runs, true), plain };
}

// Text that was typed before formatting existed: blank lines separate paragraphs, single line breaks stay.
function plainToRich(text) {
    return cleanText(String(text || '')).split(/\n[ \t]*\n/).map(part => part.trim()).filter(Boolean).map(part => [{ t: part }]);
}

// A short plain-text preview: one line, cut at a word.
function excerptOf(plain, max = 200) {
    const flat = plain.replace(/\s+/g, ' ').trim();
    if (flat.length <= max) return flat;
    const cut = flat.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
}

module.exports = { MAX_PARAGRAPHS, cleanRuns, cleanRich, cleanHeading, plainFromRich, plainOfRuns, plainToRich, excerptOf };

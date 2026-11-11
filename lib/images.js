'use strict';

// Checks uploaded product images by their content (never by file name) and reads their size.

const MAX_BYTES = 2 * 1024 * 1024;
const MIN_SIDE = 100;
const MAX_SIDE = 4000;

function pngSize(b) {
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
    if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { type: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegSize(b) {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 9 < b.length) {
        if (b[offset] !== 0xff) { offset++; continue; }
        const marker = b[offset + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { offset += marker === 0xff ? 1 : 2; continue; }
        const length = b.readUInt16BE(offset + 2);
        const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isFrame) return { type: 'image/jpeg', height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) };
        if (length < 2) return null;
        offset += 2 + length;
    }
    return null;
}

function webpSize(b) {
    if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { type: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { type: 'image/webp', width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
    return null;
}

// Returns { type, width, height } or { error }.
function inspectImage(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return { error: 'Choose an image file.' };
    if (buffer.length > MAX_BYTES) return { error: 'The image is larger than ' + MAX_BYTES / 1024 / 1024 + ' MB. Please reduce its size.' };
    const info = pngSize(buffer) || jpegSize(buffer) || webpSize(buffer);
    if (!info) return { error: 'Only PNG, JPEG and WebP images are accepted.' };
    if (!info.width || !info.height) return { error: 'The image size could not be read.' };
    if (info.width < MIN_SIDE || info.height < MIN_SIDE) return { error: 'The image is too small. Use at least ' + MIN_SIDE + ' pixels on each side.' };
    if (info.width > MAX_SIDE || info.height > MAX_SIDE) return { error: 'The image is too large. Use at most ' + MAX_SIDE + ' pixels on each side.' };
    return info;
}

module.exports = { MAX_BYTES, inspectImage };

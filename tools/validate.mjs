#!/usr/bin/env node
// Waze Chat Plus sticker pack validator (spec: docs/sticker-packs.md, format 1).
// One file, Node.js 20+, no dependency. With the `sharp` package installed it also checks pixels (transparency, margin).
//
//   node validate.mjs path/to/pack-root      a pack
//   node validate.mjs packs                  every pack found under a folder (also showcase.json / blocked.json when there)
//   node validate.mjs                        the current folder
//
// Exit code 1 when there is an error; warnings don't fail.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LOCALES = ('af ar bg ca cs da de el en-AU en-GB es es-419 et eu fa-IR fi fr gl he hi hr hu id it ja ka ko lt lv ms nl no pl pt-BR ' +
    'pt-PT ro ru sk sl sv th tr uk vi zh zh-TW').split(' ');
const BASE_LOCALES = ['af', 'ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 'fr', 'gl', 'he', 'hi', 'hr', 'hu', 'id',
    'it', 'ja', 'ka', 'ko', 'lt', 'lv', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'];
const BLOCK_REASONS = ['illegal', 'sexual', 'violence', 'hate', 'harassment', 'spam', 'copyright', 'other'];
const LIMITS = { sticker: 512, thumb: 128, stickerBytes: 100 * 1024, animatedBytes: 500 * 1024, thumbBytes: 20 * 1024, frames: 120, seconds: 10 };

let sharp = null;

try {
    sharp = (await import('sharp')).default;
} catch {
    // pixel checks are skipped
}

let errors = 0;
let warnings = 0;

/** Prints one problem; `where` is a path relative to the checked folder. */
function report(kind, where, message) {
    if (kind == 'error') errors++;
    else warnings++;

    console.log((kind == 'error' ? '  ERROR   ' : '  warning ') + where + ': ' + message);
}

/** Reads and parses a JSON file; null (with an error reported) when it can't. */
function readJson(path, where, maxBytes) {
    let size = statSync(path).size;

    if (size > maxBytes) {
        report('error', where, 'larger than ' + Math.round(maxBytes / 1024) + ' KB');
        return null;
    }

    try {
        return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
    } catch (error) {
        report('error', where, 'invalid JSON (' + error.message + ')');
        return null;
    }
}

/** Checks a text field: a string, within the length, plain (no control characters or line breaks). */
function checkText(value, where, field, min, max, required = true) {
    if (value === undefined) {
        if (required) report('error', where, field + ' is required');
        return false;
    }

    if (typeof value != 'string') {
        report('error', where, field + ' must be a string');
        return false;
    }

    if (value.length < min || value.length > max) {
        report('error', where, field + ' must have ' + min + '–' + max + ' characters (has ' + value.length + ')');
        return false;
    }

    if (/[\u0000-\u001f\u007f]/.test(value)) {
        report('error', where, field + ' has control characters or line breaks');
        return false;
    }

    if (/[<>]/.test(value)) report('warning', where, field + ' has < or >: texts are plain text, never HTML');

    return true;
}

/** Checks a keywords list (up to 10 words of 1–30 characters). */
function checkKeywords(value, where) {
    if (value === undefined) return;

    if (!Array.isArray(value)) {
        report('error', where, 'keywords must be a list');
        return;
    }

    if (value.length > 10) report('error', where, 'keywords has ' + value.length + ' words (up to 10)');

    value.forEach(word => checkText(word, where, 'keyword', 1, 30));
}

/** Reads the structure of a WebP file: size, animation, frames, duration (null when it isn't a valid WebP). */
function readWebp(buffer) {
    if (buffer.length < 20 || buffer.toString('latin1', 0, 4) != 'RIFF' || buffer.toString('latin1', 8, 12) != 'WEBP') return null;

    let info = { width: 0, height: 0, animated: false, frames: 0, duration: 0, hasAlpha: false };
    let position = 12;

    while (position + 8 <= buffer.length) {
        let tag = buffer.toString('latin1', position, position + 4);
        let size = buffer.readUInt32LE(position + 4);
        let data = position + 8;

        if (tag == 'VP8X') {
            let flags = buffer[data];

            info.animated = (flags & 0x02) != 0;
            info.hasAlpha = (flags & 0x10) != 0;
            info.width = 1 + (buffer[data + 4] | (buffer[data + 5] << 8) | (buffer[data + 6] << 16));
            info.height = 1 + (buffer[data + 7] | (buffer[data + 8] << 8) | (buffer[data + 9] << 16));
        } else if (tag == 'ANMF') {
            info.frames++;
            info.duration += buffer[data + 12] | (buffer[data + 13] << 8) | (buffer[data + 14] << 16);
        } else if (!info.width && tag == 'VP8 ') {
            info.width = buffer.readUInt16LE(data + 6) & 0x3fff;
            info.height = buffer.readUInt16LE(data + 8) & 0x3fff;
        } else if (!info.width && tag == 'VP8L') {
            let bits = buffer.readUInt32LE(data + 1);

            info.width = (bits & 0x3fff) + 1;
            info.height = ((bits >> 14) & 0x3fff) + 1;
            info.hasAlpha = ((bits >> 28) & 1) == 1;
        }

        position = data + size + (size & 1);
    }

    if (!info.width) return null;
    if (!info.animated) info.frames = 1;

    return info;
}

/** Checks one WebP file of a pack. */
async function checkImage(path, where, kind, animatedAllowed) {
    let buffer = readFileSync(path);
    let info = readWebp(buffer);
    let expected = LIMITS[kind];

    if (!info) {
        report('error', where, 'not a valid WebP file');
        return null;
    }

    if (info.width != expected || info.height != expected)
        report('error', where, 'is ' + info.width + '×' + info.height + ' px, must be exactly ' + expected + '×' + expected);

    if (kind == 'thumb') {
        if (info.animated) report('error', where, 'the thumbnail must be static (the first frame)');
        if (buffer.length > LIMITS.thumbBytes) report('error', where, Math.round(buffer.length / 1024) + ' KB, the limit is 20 KB');
        else if (buffer.length > LIMITS.thumbBytes * 0.9) report('warning', where, 'close to the 20 KB limit');

        return info;
    }

    if (info.animated) {
        if (!animatedAllowed) report('warning', where, 'is animated but the manifest does not say "animated": true');
        if (info.frames > LIMITS.frames) report('error', where, info.frames + ' frames, the limit is ' + LIMITS.frames);
        if (info.duration > LIMITS.seconds * 1000) report('error', where, 'loop of ' + (info.duration / 1000).toFixed(1) + ' s, the limit is 10 s');
        if (buffer.length > LIMITS.animatedBytes) report('error', where, Math.round(buffer.length / 1024) + ' KB, the limit for animated is 500 KB');
        else if (buffer.length > LIMITS.animatedBytes * 0.9) report('warning', where, 'close to the 500 KB limit');
    } else {
        if (buffer.length > LIMITS.stickerBytes) report('error', where, Math.round(buffer.length / 1024) + ' KB, the limit for static is 100 KB');
        else if (buffer.length > LIMITS.stickerBytes * 0.9) report('warning', where, 'close to the 100 KB limit');
    }

    if (sharp && !info.animated) await checkPixels(buffer, where);

    return info;
}

/** Warns about a background that isn't transparent and a drawing too close to the edge (needs sharp). */
async function checkPixels(buffer, where) {
    let { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minX = info.width, minY = info.height, maxX = -1, maxY = -1;

    for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++)
            if (data[(y * info.width + x) * 4 + 3] > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }

    if (maxX < 0) {
        report('error', where, 'the image is fully transparent');
        return;
    }

    if (data[3] > 8 && data[(info.width - 1) * 4 + 3] > 8) report('warning', where, 'the background is not transparent');
    else if (Math.min(minX, minY, info.width - 1 - maxX, info.height - 1 - maxY) < 12) report('warning', where, 'the drawing is closer than 12 px to the edge (16 px margin recommended)');
}

/** Checks a translation file (§3) against the sticker ids of the manifest. */
function checkTranslation(path, where, stickerIds) {
    let data = readJson(path, where, 128 * 1024);

    if (!data) return;

    if (typeof data != 'object' || Array.isArray(data)) {
        report('error', where, 'must be an object');
        return;
    }

    checkText(data.name, where, 'name', 1, 40, false);
    checkText(data.description, where, 'description', 1, 200, false);

    for (let [id, entry] of Object.entries(data.stickers || {})) {
        if (!stickerIds.has(id)) report('warning', where, 'sticker "' + id + '" is not in the manifest');

        checkText(entry && entry.name, where + ' › ' + id, 'name', 1, 40, false);
        checkKeywords(entry && entry.keywords, where + ' › ' + id);
    }
}

/** Validates one pack folder. */
async function validatePack(packDir, label) {
    console.log(label);

    let manifestPath = join(packDir, 'wcp-stickers.json');
    let manifest = readJson(manifestPath, 'wcp-stickers.json', 256 * 1024);

    if (!manifest) return;

    if (manifest.format !== 1) {
        report('error', 'wcp-stickers.json', 'format must be 1');
        return;
    }

    let packId = manifest.id;

    if (checkText(manifest.id, 'wcp-stickers.json', 'id', 1, 40) && !ID_PATTERN.test(manifest.id)) report('error', 'wcp-stickers.json', 'id must be a-z 0-9 words joined by "-"');

    checkText(manifest.name, 'wcp-stickers.json', 'name', 1, 40);
    checkText(manifest.author, 'wcp-stickers.json', 'author', 1, 60);
    checkText(manifest.license, 'wcp-stickers.json', 'license', 1, 40);
    checkText(manifest.description, 'wcp-stickers.json', 'description', 1, 200, false);

    if (manifest.animated !== undefined && typeof manifest.animated != 'boolean') report('error', 'wcp-stickers.json', 'animated must be true or false');

    let stickers = Array.isArray(manifest.stickers) ? manifest.stickers : [];

    if (!stickers.length || stickers.length > 120) report('error', 'wcp-stickers.json', 'stickers must have 1–120 items (has ' + stickers.length + ')');

    let ids = new Set();

    for (let sticker of stickers) {
        let where = 'sticker ' + (sticker && sticker.id);

        if (!sticker || typeof sticker != 'object') {
            report('error', 'wcp-stickers.json', 'a sticker is not an object');
            continue;
        }

        if (checkText(sticker.id, where, 'id', 1, 40) && !ID_PATTERN.test(sticker.id)) report('error', where, 'id must be a-z 0-9 words joined by "-"');
        if (ids.has(sticker.id)) report('error', where, 'duplicated id');

        ids.add(sticker.id);
        checkText(sticker.name, where, 'name', 1, 40);
        checkKeywords(sticker.keywords, where);

        if (!Array.isArray(sticker.emojis) || sticker.emojis.length < 1 || sticker.emojis.length > 3) report('error', where, 'emojis must have 1–3 items');
        else sticker.emojis.forEach(emoji => checkText(emoji, where, 'emoji', 1, 16));
    }

    if (!ids.has(manifest.icon)) report('error', 'wcp-stickers.json', 'icon "' + manifest.icon + '" is not a sticker id');

    // Images: fixed paths (§1, §4).
    let anyAnimated = false;

    for (let id of ids) {
        for (let [folder, kind] of [['stickers', 'sticker'], ['thumbs', 'thumb']]) {
            let file = folder + '/' + id + '.webp';
            let path = join(packDir, folder, id + '.webp');

            if (!existsSync(path)) {
                report('error', file, 'missing');
                continue;
            }

            let info = await checkImage(path, file, kind, manifest.animated === true);

            if (kind == 'sticker' && info && info.animated) anyAnimated = true;
        }
    }

    if (anyAnimated && manifest.animated !== true) report('warning', 'wcp-stickers.json', 'has animated stickers: set "animated": true');

    for (let folder of ['stickers', 'thumbs'])
        if (existsSync(join(packDir, folder)))
            for (let file of readdirSync(join(packDir, folder)))
                if (!ids.has(file.replace(/\.webp$/, ''))) report('warning', folder + '/' + file, 'not in the manifest (ignored)');

    // Translations (§3).
    let locales = Array.isArray(manifest.locales) ? manifest.locales : [];

    for (let locale of locales) {
        if (!LOCALES.includes(locale) && !BASE_LOCALES.includes(locale)) report('error', 'wcp-stickers.json', 'locale "' + locale + '" is not a language of Waze Chat Plus');
        else if (!existsSync(join(packDir, 'i18n', locale + '.json'))) report('error', 'i18n/' + locale + '.json', 'listed in locales but missing');
        else checkTranslation(join(packDir, 'i18n', locale + '.json'), 'i18n/' + locale + '.json', ids);
    }

    if (existsSync(join(packDir, 'i18n')))
        for (let file of readdirSync(join(packDir, 'i18n')))
            if (file.endsWith('.json') && !locales.includes(file.slice(0, -5))) report('warning', 'i18n/' + file, 'not listed in locales (it is never downloaded)');

    console.log('  ' + packId + ': ' + ids.size + ' stickers checked');
}

/** Checks a link of the showcase: a GitHub repository, a folder at a ref, or the manifest on jsDelivr. */
function checkShowcaseLink(link, where) {
    let github = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}(\/tree\/[^/\s]+(\/[A-Za-z0-9._\/-]+)?)?\/?$/;
    let jsdelivr = /^https:\/\/cdn\.jsdelivr\.net\/gh\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}@[^/\s]+\/([A-Za-z0-9._\/-]+\/)?wcp-stickers\.json$/;

    if (typeof link != 'string' || !(github.test(link) || jsdelivr.test(link))) report('error', where, 'not an accepted install link (§5): ' + link);
    else if (/\/tree\/(main|master)\b/.test(link)) report('warning', where, 'points to a branch: use a version tag (§5)');
}

/** Validates showcase.json (§9). */
function validateShowcase(path) {
    console.log('showcase.json');

    let data = readJson(path, 'showcase.json', 256 * 1024);

    if (!data) return;
    if (data.format !== 1) report('error', 'showcase.json', 'format must be 1');

    for (let list of ['official', 'community']) {
        if (!Array.isArray(data[list])) {
            report('error', 'showcase.json', list + ' must be a list');
            continue;
        }

        data[list].forEach((entry, index) => checkShowcaseLink(entry && entry.link, 'showcase.json › ' + list + '[' + index + ']'));
    }
}

/** Validates blocked.json (§8). */
function validateBlocked(path) {
    console.log('blocked.json');

    let data = readJson(path, 'blocked.json', 1024 * 1024);

    if (!data) return;
    if (data.format !== 1) report('error', 'blocked.json', 'format must be 1');

    for (let [list, needsId] of [['packs', false], ['stickers', true]]) {
        if (!Array.isArray(data[list])) {
            report('error', 'blocked.json', list + ' must be a list');
            continue;
        }

        data[list].forEach((entry, index) => {
            let where = 'blocked.json › ' + list + '[' + index + ']';

            if (!entry || !/^gh:[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,4}$/.test(entry.pack)) report('error', where, 'pack must be gh:<user>/<repo>[/<pack root>]');
            if (needsId && !(entry && ID_PATTERN.test(entry.id))) report('error', where, 'id is required');
            if (!entry || !BLOCK_REASONS.includes(entry.reason)) report('error', where, 'reason must be one of ' + BLOCK_REASONS.join(', '));
            if (!entry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.at)) report('error', where, 'at must be a date YYYY-MM-DD');
            if (entry && entry.refs !== undefined && !(Array.isArray(entry.refs) && entry.refs.every(ref => typeof ref == 'string'))) report('error', where, 'refs must be a list of tags');
        });
    }
}

/** Finds the pack folders (with a wcp-stickers.json) under a folder, at most 5 levels down. */
function findPacks(dir, depth = 0) {
    if (existsSync(join(dir, 'wcp-stickers.json'))) return [dir];
    if (depth >= 5) return [];

    let found = [];

    for (let entry of readdirSync(dir, { withFileTypes: true }))
        if (entry.isDirectory() && !['node_modules', '.git', 'stickers', 'thumbs', 'i18n'].includes(entry.name))
            found.push(...findPacks(join(dir, entry.name), depth + 1));

    return found;
}

const target = resolve(process.argv[2] || '.');

if (!existsSync(target) || !statSync(target).isDirectory()) {
    console.error('Not a folder: ' + target);
    process.exit(1);
}

if (!sharp) console.log('(sharp is not installed: transparency and margin checks skipped)');

let packs = findPacks(target);

for (let pack of packs) await validatePack(pack, 'Pack ' + (relative(target, pack) || '.'));

if (existsSync(join(target, 'showcase.json'))) validateShowcase(join(target, 'showcase.json'));
if (existsSync(join(target, 'blocked.json'))) validateBlocked(join(target, 'blocked.json'));

if (!packs.length && !existsSync(join(target, 'showcase.json'))) {
    console.error('No wcp-stickers.json found under ' + target);
    process.exit(1);
}

console.log('\n' + errors + ' error(s), ' + warnings + ' warning(s).');
process.exit(errors ? 1 : 0);

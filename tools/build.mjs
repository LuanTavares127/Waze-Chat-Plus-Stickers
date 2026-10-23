// Builds the official packs in packs/ from the art folder and curation/stickers-curation.json.
// Usage: node tools/build.mjs [--art <folder of the 512 px WebP art>]
// Needs `npm install` (sharp). Output is deterministic: running it twice changes nothing.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argIndex = process.argv.indexOf('--art');
const artDir = argIndex > 0 ? process.argv[argIndex + 1] : 'G:\\Meu Drive\\Waze\\Moods\\Images (WEBP)\\With Border (Com Borda)';

const AUTHOR = 'luan_tavares_127';
const LICENSE = 'All rights reserved';
const STICKER_SIZE = 512;
const MARGIN = 16;
const THUMB_SIZE = 128;
const MAX_STICKER_BYTES = 100 * 1024;
const MAX_THUMB_BYTES = 20 * 1024;
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Encodes a WebP at the highest quality that fits the byte limit. */
async function encodeWebp(pipeline, maxBytes, startQuality) {
    for (let quality = startQuality; quality >= 40; quality -= 5) {
        let buffer = await pipeline.clone().webp({ quality, effort: 6, alphaQuality: 100 }).toBuffer();

        if (buffer.length <= maxBytes) return buffer;
    }

    throw new Error('does not fit in ' + maxBytes + ' bytes even at quality 40');
}

/** Writes a text file with CRLF, like the rest of the repository. */
function writeText(path, text) {
    writeFileSync(path, text.replace(/\r?\n/g, '\r\n'));
}

/** Throws when a text breaks the limits of the specification (§2). */
function check(condition, message) {
    if (!condition) throw new Error(message);
}

if (!existsSync(artDir)) {
    console.error('Art folder not found: ' + artDir + ' (use --art <folder>)');
    process.exit(1);
}

const curation = JSON.parse(readFileSync(join(root, 'curation', 'stickers-curation.json'), 'utf8'));
let total = 0;

for (let pack of curation.packs) {
    check(ID_PATTERN.test(pack.id) && pack.id.length <= 40, 'bad pack id ' + pack.id);
    check(pack.stickers.some(sticker => sticker.id == pack.icon), pack.id + ': icon ' + pack.icon + ' is not a sticker');

    let packDir = join(root, 'packs', pack.id);
    let seen = new Set();

    for (let sub of ['stickers', 'thumbs']) {
        rmSync(join(packDir, sub), { recursive: true, force: true });
        mkdirSync(join(packDir, sub), { recursive: true });
    }

    mkdirSync(join(packDir, 'i18n'), { recursive: true });

    let manifest = {
        format: 1,
        id: pack.id,
        name: pack.name.en,
        author: AUTHOR,
        license: LICENSE,
        icon: pack.icon,
        locales: [],
        stickers: []
    };
    let translation = { name: pack['name']['pt-BR'], stickers: {} };

    for (let sticker of pack.stickers) {
        let where = pack.id + '/' + sticker.id;

        check(ID_PATTERN.test(sticker.id) && sticker.id.length <= 40, where + ': bad id');
        check(!seen.has(sticker.id), where + ': duplicated id');
        check(sticker.name.en.length >= 1 && sticker.name.en.length <= 40, where + ': name length');
        check(sticker.emojis.length >= 1 && sticker.emojis.length <= 3, where + ': emojis count');
        check(sticker.keywords.en.length <= 10 && sticker.keywords['pt-BR'].length <= 10, where + ': too many keywords');

        for (let word of [...sticker.keywords.en, ...sticker.keywords['pt-BR']])
            check(word.length >= 1 && word.length <= 30, where + ': keyword length ' + word);

        seen.add(sticker.id);

        let source = join(artDir, sticker.file);

        check(existsSync(source), where + ': art file ' + sticker.file + ' not found');

        // Same scale for all: the drawing fits a 480 px box, centered on the transparent 512 px canvas.
        let box = STICKER_SIZE - MARGIN * 2;
        let fitted = await sharp(source).resize(box, box, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
        let left = Math.floor((STICKER_SIZE - fitted.info.width) / 2);
        let top = Math.floor((STICKER_SIZE - fitted.info.height) / 2);
        let canvas = sharp({ create: { width: STICKER_SIZE, height: STICKER_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite([{ input: fitted.data, left, top }])
            .png();
        let image = await canvas.toBuffer();
        let full = await encodeWebp(sharp(image), MAX_STICKER_BYTES, 90);
        let thumb = await encodeWebp(sharp(image).resize(THUMB_SIZE, THUMB_SIZE), MAX_THUMB_BYTES, 85);

        writeFileSync(join(packDir, 'stickers', sticker.id + '.webp'), full);
        writeFileSync(join(packDir, 'thumbs', sticker.id + '.webp'), thumb);

        manifest.stickers.push({ id: sticker.id, name: sticker.name.en, keywords: sticker.keywords.en, emojis: sticker.emojis });
        translation.stickers[sticker.id] = { name: sticker.name['pt-BR'], keywords: sticker.keywords['pt-BR'] };
        total++;
    }

    // Every language file in i18n/ is listed (48d adds more of them; the build only writes pt-BR).
    writeText(join(packDir, 'i18n', 'pt-BR.json'), JSON.stringify(translation, null, 4) + '\n');
    manifest.locales = readdirSync(join(packDir, 'i18n')).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)).sort();
    writeText(join(packDir, 'wcp-stickers.json'), JSON.stringify(manifest, null, 4) + '\n');
    console.log(pack.id + ': ' + pack.stickers.length + ' stickers');
}

console.log('Built ' + total + ' stickers in ' + curation.packs.length + ' packs.');

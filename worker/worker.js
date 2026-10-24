// Waze Chat Plus Worker (Cloudflare): KLIPY GIF proxy + sticker routes + link previews.
// Published with `npx wrangler deploy` inside worker/ (wrangler.toml creates the limiters and binds the KV); after that, pasting
// into the Cloudflare editor also works (the bindings stay). Secrets (Settings > Variables and Secrets, type Secret):
//   KLIPY_KEY    the KLIPY key (never in the code)
//   GITHUB_TOKEN fine-grained token of this repository with ONLY "Issues: read and write" (reports); it expires, renew it
// Bindings (optional: without them only the weaker in-memory limits apply):
//   GIFS_LIMITER, STICKERS_LIMITER, REPORT_LIMITER,  Rate Limiting per IP in each Cloudflare location (wrangler.toml)
//   PREVIEW_LIMITER
//   REPORTS                                         KV with the daily report counters (per IP, hashed, and in all)
// Routes:
//   GET  /preview?url=<link>&lang=<locale>  title, description, image and site name of a page, read here so the reader's IP never
//                                       reaches the site (shared cache: 1 day with a preview, 1 hour without); nothing is logged
//   GET  /gifs/trending, /gifs/search   KLIPY proxy (validated parameters, shared 5-minute cache)
//   GET  /stickers/showcase             copy of showcase.json of the stickers repository (5-minute cache)
//   GET  /stickers/blocked              copy of blocked.json (5-minute cache)
//   POST /stickers/report               { pack, sticker?, reason, details? } -> issue in the repository (no account needed)

const API = 'https://api.klipy.com/api/v1/';
const KINDS = { '/gifs/trending': 'trending', '/gifs/search': 'search' };
const FILTERS = new Set(['off', 'low', 'medium', 'high']);
const FORMATS = new Set(['gif', 'webp', 'jpg', 'mp4', 'webm']);
const CACHE_SECONDS = 300;

// Stickers repository (owner/name are case-insensitive for GitHub)
const REPO = 'LuanTavares127/Waze-Chat-Plus-Stickers';
const BRANCH = 'main';
const STICKER_FILES = { '/stickers/showcase': 'showcase.json', '/stickers/blocked': 'blocked.json' };
const MAX_FILE_BYTES = 200000;

// Reasons of the spec (docs/sticker-packs.md §8)
const REASONS = new Set(['illegal', 'sexual', 'violence', 'hate', 'harassment', 'spam', 'copyright', 'other']);
const PACK_PATTERN = /^gh:[a-z0-9_.-]{1,40}\/[a-z0-9_.-]{1,100}(\/[a-z0-9_.-]{1,60}){0,4}$/;
const STICKER_PATTERN = /^[a-z0-9_.-]{1,64}$/;
const MAX_REPORT_BYTES = 4000;

// Per-IP limits per minute, loose enough for many users behind one IP (carrier CGNAT). Normal use of one person:
// GIFs up to ~10/min (search + scrolling), sticker lists ~2/day, reports almost never. The binding (`binding`, same number in
// wrangler.toml) applies in each Cloudflare location; without it, the in-memory count only applies within one instance.
const LIMITS = {
    gifs: { max: 30, windowMs: 60000, binding: 'GIFS_LIMITER' },
    stickers: { max: 10, windowMs: 60000, binding: 'STICKERS_LIMITER' },
    report: { max: 2, windowMs: 60000, binding: 'REPORT_LIMITER' },
    // One per new link that comes into view (the script keeps the answers for days)
    preview: { max: 30, windowMs: 60000, binding: 'PREVIEW_LIMITER' }
};

// Link previews: only the start of the page is read (the Discuss home is 6 MB, its head 28 KB, 2026-10-14; a YouTube video has its
// metas after ~775 KB of inline scripts, 2026-10-23), one deadline for every redirect, each redirect checked like the link itself
// (a clean link must not lead to a blocked one)
const PREVIEW_HEAD_BYTES = 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 6000;
const PREVIEW_REDIRECTS = 4;
const PREVIEW_URL_MAX = 2000;
const PREVIEW_TITLE_MAX = 150;
const PREVIEW_DESCRIPTION_MAX = 300;
const PREVIEW_READY_SECONDS = 86400;
const PREVIEW_NONE_SECONDS = 3600;
const PREVIEW_CACHE_VERSION = '2';
const PREVIEW_USER_AGENT = 'Mozilla/5.0 (compatible; WazeChatPlus-LinkPreview/1.0; +https://greasyfork.org/scripts/598466)';
// Map sites that aren't open data allowed for Waze editing (same list as the script's `blockedLinkHosts`), any `map.`/`maps.` label too
const PREVIEW_BLOCKED_HOSTS = [/(^|\.)openstreetmap\.[a-z.]+$/, /(^|\.)osm\.org$/, /(^|\.)mapillary\.com$/, /(^|\.)kartaview\.org$/,
    /(^|\.)openstreetcam\.org$/, /(^|\.)wikimapia\.org$/, /(^|\.)mapquest\.com$/, /(^|\.)here\.com$/, /(^|\.)2gis\.[a-z.]+$/, /(^|\.)mapy\.(cz|com)$/,
    /(^|\.)organicmaps\.app$/, /(^|\.)osmand\.net$/, /(^|\.)maps\.me$/, /(^|\.)viamichelin\.[a-z.]+$/, /(^|\.)amap\.com$/, /^(plan|mydrive)\.tomtom\.com$/,
    /(^|\.)maps?\./];
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', copy: '©', reg: '®', trade: '™' };
const hits = new Map();

// Reports per day (UTC, in the KV REPORTS): per IP and in all (each one becomes an issue read by hand)
const REPORTS_PER_IP_DAY = 5;
const REPORTS_PER_DAY = 30;
const REPORT_KEY_TTL = 2 * 86400;

/**
 * Builds a JSON answer with CORS open.
 * @param {*} body - Anything JSON.stringify takes.
 * @param {number} status - HTTP status.
 * @param {Object} extra - More headers.
 *
 * @returns {Response}
 */
function reply(body, status = 200, extra = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'access-control-allow-origin': '*',
            ...extra
        }
    });
}

function clamp(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);

    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/**
 * Counts a request of an IP in the Rate Limiting binding and in this instance; over either one = limited. In production the binding
 * is approximate (counts reach the other machines of a location in the background: a limit of 5 let ~70% of 60 requests through in
 * a test, 2026-10-23), so the in-memory count stays as a second brake.
 * @param {string} name - Key of LIMITS.
 * @param {string} ip - Client address.
 * @param {Object} env - Worker bindings.
 *
 * @returns {Promise<boolean>} true when the IP is over the limit.
 */
async function isLimited(name, ip, env) {
    const binding = env[LIMITS[name].binding];
    const local = isLimitedHere(name, ip);

    if (!binding)
        return local;

    try {
        const { success } = await binding.limit({ key: `${name}:${ip}` });

        return local || !success;

    } catch (error) {
        // Binding unavailable: only the in-memory count
        return local;
    }
}

/**
 * Counts a request of an IP in a window of this instance only.
 * @param {string} name - Key of LIMITS.
 * @param {string} ip - Client address.
 *
 * @returns {boolean} true when the IP is over the limit.
 */
function isLimitedHere(name, ip) {
    const limit = LIMITS[name];
    const now = Date.now();
    const key = `${name}:${ip}`;
    const entry = hits.get(key);

    if (hits.size > 5000)
        for (const [other, value] of hits) if (now - value.start > LIMITS[other.split(':')[0]].windowMs) hits.delete(other);

    if (!entry || now - entry.start > limit.windowMs) {
        hits.set(key, { start: now, count: 1 });

        return false;
    }

    return ++entry.count > limit.max;
}

/**
 * Daily report counters in the KV REPORTS: the keys of today (UTC) for everyone and for this IP (SHA-256, never the address itself).
 * @param {string} ip - Client address.
 *
 * @returns {Promise<{ total: string, mine: string, retryAfter: number }>} `retryAfter` = seconds until the next UTC day.
 */
async function getReportKeys(ip) {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`wcp-report:${ip}`));
    const hash = [...new Uint8Array(digest)].slice(0, 12).map(byte => byte.toString(16).padStart(2, '0')).join('');
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);

    return { total: `day:${day}`, mine: `ip:${day}:${hash}`, retryAfter: Math.ceil((midnight - now.getTime()) / 1000) };
}

/**
 * Checks and counts a report against the daily caps (KV REPORTS; without it, no daily cap). The KV is eventually consistent, so the
 * caps can be passed by a few reports sent at the same moment: a brake, not an exact count.
 * @param {Object} env - Worker bindings.
 * @param {string} ip - Client address.
 *
 * @returns {Promise<number>} 0 = allowed (and counted), else the seconds to wait.
 */
async function takeDailyReport(env, ip) {
    if (!env.REPORTS)
        return 0;

    try {
        const keys = await getReportKeys(ip);
        const [total, mine] = (await Promise.all([env.REPORTS.get(keys.total), env.REPORTS.get(keys.mine)])).map(value => Number(value) || 0);

        if (total >= REPORTS_PER_DAY || mine >= REPORTS_PER_IP_DAY)
            return keys.retryAfter;

        await Promise.all([
            env.REPORTS.put(keys.total, String(total + 1), { expirationTtl: REPORT_KEY_TTL }),
            env.REPORTS.put(keys.mine, String(mine + 1), { expirationTtl: REPORT_KEY_TTL })
        ]);

    } catch (error) {
        // KV unavailable: the per-minute limits still apply
    }

    return 0;
}

/**
 * Proxy of the KLIPY search (the key stays in the secret KLIPY_KEY, only known parameters pass).
 */
async function handleGifs(request, env, ctx, url, kind) {
    if (!env.KLIPY_KEY)
        return reply({ error: 'not configured' }, 500);

    if (await isLimited('gifs', request.headers.get('cf-connecting-ip') || 'unknown', env))
        return reply({ error: 'too many requests' }, 429, { 'retry-after': '60' });

    const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const params = new URLSearchParams({
        page: String(clamp(url.searchParams.get('page'), 1, 50, 1)),
        per_page: String(clamp(url.searchParams.get('per_page'), 1, 50, 24)),
        content_filter: FILTERS.has(url.searchParams.get('content_filter')) ? url.searchParams.get('content_filter') : 'medium'
    });

    const locale = (url.searchParams.get('locale') || '').toLowerCase();
    const formats = (url.searchParams.get('format_filter') || '').split(',').filter(format => FORMATS.has(format));

    if (/^[a-z]{2}$/.test(locale))
        params.set('locale', locale);

    if (formats.length)
        params.set('format_filter', formats.join(','));

    if (kind === 'search') {
        if (!query)
            return reply({ error: 'missing q' }, 400);

        params.set('q', query);
    }

    // The cache is shared between users: customer_id is not part of the key
    const cacheKey = new Request(`${url.origin}${url.pathname}?${params}`);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);

    if (cached)
        return cached;

    const customerId = url.searchParams.get('customer_id') || '';

    if (/^[\w-]{8,64}$/.test(customerId))
        params.set('customer_id', customerId);

    let upstream;

    try {
        upstream = await fetch(`${API}${encodeURIComponent(env.KLIPY_KEY)}/gifs/${kind}?${params}`, { headers: { accept: 'application/json' } });

    } catch (error) {
        return reply({ error: 'upstream unreachable' }, 502);
    }

    // Never return the error body (it may quote the key); only the status
    if (!upstream.ok)
        return reply({ error: 'upstream error', status: upstream.status }, upstream.status === 429 ? 429 : 502);

    const response = reply(await upstream.json(), 200, { 'cache-control': `public, max-age=${CACHE_SECONDS}` });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
}

/**
 * Serves showcase.json / blocked.json of the stickers repository (read from the branch, so a commit reaches users in minutes).
 */
async function handleStickerFile(request, env, ctx, url, file) {
    if (await isLimited('stickers', request.headers.get('cf-connecting-ip') || 'unknown', env))
        return reply({ error: 'too many requests' }, 429, { 'retry-after': '60' });

    const cacheKey = new Request(`${url.origin}${url.pathname}`);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);

    if (cached)
        return cached;

    let upstream;

    try {
        upstream = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${file}`, { headers: { accept: 'application/json' } });

    } catch (error) {
        return reply({ error: 'upstream unreachable' }, 502);
    }

    if (!upstream.ok)
        return reply({ error: 'upstream error', status: upstream.status }, 502);

    const text = await upstream.text();
    let json = null;

    try {
        json = text.length <= MAX_FILE_BYTES ? JSON.parse(text) : null;

    } catch (error) {
        json = null;
    }

    // Only pass on what has the expected shape of format 1
    if (!json || typeof json !== 'object' || json.format !== 1)
        return reply({ error: 'invalid file' }, 502);

    const response = reply(json, 200, { 'cache-control': `public, max-age=${CACHE_SECONDS}` });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
}

/**
 * Cleans free text for the issue: no control characters, no @mentions or #references that notify people, no backticks.
 */
function cleanText(value, max) {
    return String(value || '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .replace(/`/g, "'")
        .replace(/@/g, '@​')
        .replace(/#(?=\d)/g, '#​')
        .trim()
        .slice(0, max);
}

/**
 * Validates a report and opens an issue in the stickers repository (token with issues only, in the secret GITHUB_TOKEN).
 */
async function handleReport(request, env) {
    if (!env.GITHUB_TOKEN)
        return reply({ error: 'not configured' }, 500);

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';

    if (await isLimited('report', ip, env))
        return reply({ error: 'too many requests' }, 429, { 'retry-after': '60' });

    const text = await request.text();

    if (text.length > MAX_REPORT_BYTES)
        return reply({ error: 'too large' }, 413);

    let data = null;

    try {
        data = JSON.parse(text);

    } catch (error) {
        data = null;
    }

    if (!data || typeof data !== 'object' || Array.isArray(data))
        return reply({ error: 'invalid json' }, 400);

    const pack = String(data.pack || '').toLowerCase();
    const sticker = data.sticker == null || data.sticker === '' ? '' : String(data.sticker).toLowerCase();

    if (!PACK_PATTERN.test(pack))
        return reply({ error: 'invalid pack' }, 400);

    if (sticker && !STICKER_PATTERN.test(sticker))
        return reply({ error: 'invalid sticker' }, 400);

    if (!REASONS.has(data.reason))
        return reply({ error: 'invalid reason' }, 400);

    // Only a valid report uses up the daily quota
    const wait = await takeDailyReport(env, ip);

    if (wait)
        return reply({ error: 'too many requests' }, 429, { 'retry-after': String(wait) });

    const details = cleanText(data.details, 500);
    const subject = sticker ? `${pack} · ${sticker}` : pack;
    const body = [
        'Report received from Waze Chat Plus.',
        '',
        `- Pack: \`${pack}\``,
        sticker ? `- Sticker: \`${sticker}\`` : '- Sticker: (the whole pack)',
        `- Reason: \`${data.reason}\``,
        '',
        details ? `Details (written by the reporter, not verified):\n\n\`\`\`\n${details}\n\`\`\`` : 'No details.'
    ].join('\n');

    let upstream;

    try {
        upstream = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
            method: 'POST',
            headers: {
                accept: 'application/vnd.github+json',
                authorization: `Bearer ${env.GITHUB_TOKEN}`,
                'content-type': 'application/json',
                'user-agent': 'waze-chat-plus-worker',
                'x-github-api-version': '2022-11-28'
            },
            body: JSON.stringify({ title: `Report (${data.reason}): ${subject}`.slice(0, 200), body })
        });

    } catch (error) {
        return reply({ error: 'upstream unreachable' }, 502);
    }

    // Never return the GitHub error body
    if (!upstream.ok)
        return reply({ error: 'upstream error', status: upstream.status }, 502);

    return reply({ ok: true }, 201);
}

/**
 * Tells whether a link (or where it led, or its image) may be read for a preview: http(s) without credentials or port, a host name
 * with a dot (never an IP or a local name), not a blocked map site, not Bing/Yandex/Google maps by path, not Waze but its Discuss,
 * not the GIF sites. The script checks the same before asking, and again on the answer.
 * @param {URL} url - The link.
 *
 * @returns {boolean}
 */
function isPreviewAllowed(url) {
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const path = url.pathname.toLowerCase();

    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !host.includes('.') || host.includes(':') || host.startsWith('['))
        return false;

    if (/^[\d.]+$/.test(host) || /\.(local|localhost|internal|lan|home|arpa|test|invalid)$/.test(host))
        return false;

    if (PREVIEW_BLOCKED_HOSTS.some(pattern => pattern.test(host)))
        return false;

    if (/(^|\.)(bing|yandex|google)\.[a-z.]+$/.test(host) && /^\/maps(\/|$)/.test(path))
        return false;

    if (/(^|\.)goo\.gl$/.test(host) && /^\/maps(\/|$)/.test(path))
        return false;

    if (/(^|\.)waze\.com$/.test(host) && !/^\/discuss(\/|$)/.test(path))
        return false;

    return !/(^|\.)(tenor|klipy|giphy)\.com$/.test(host);
}

/**
 * Decodes the HTML entities of a text read by HTMLRewriter (it gives attributes and text as written in the page).
 */
function decodeEntities(value) {
    return String(value || '').replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (all, name) => {
        if (name[0] != '#')
            return ENTITIES[name.toLowerCase()] ?? all;

        const code = name[1] == 'x' || name[1] == 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);

        return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : all;
    });
}

/**
 * Cleans a preview text: entities decoded, no control characters, spaces joined, cut with "…".
 */
function cutText(value, max) {
    const text = decodeEntities(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Reads a page stream up to the end of its `<head>` (or `<body>`), at most PREVIEW_HEAD_BYTES, then cancels the rest.
 * @param {Response} response - The page.
 *
 * @returns {Promise<string>}
 */
async function readPageHead(response) {
    const charset = /charset=["']?([\w-]+)/i.exec(response.headers.get('content-type') || '')?.[1] || 'utf-8';
    let decoder;

    try {
        decoder = new TextDecoder(charset);

    } catch (error) {
        decoder = new TextDecoder();
    }

    const reader = response.body.getReader();
    let text = '';
    let bytes = 0;

    try {
        while (bytes < PREVIEW_HEAD_BYTES) {
            const { done, value } = await reader.read();

            if (done)
                break;

            const from = Math.max(0, text.length - 16);

            bytes += value.byteLength;
            text += decoder.decode(value, { stream: true });

            if (/<\/head\s*>|<body[\s>]/i.test(text.slice(from)))
                break;
        }

    } finally {
        reader.cancel().catch(() => {});
    }

    return text;
}

/**
 * Takes the preview out of a page head: title (`og:title`, `twitter:title`, `<title>`), description, https image and site name.
 * @param {string} html - The head.
 * @param {URL} base - Where the page came from (after redirects).
 *
 * @returns {Promise<{ title: string, description: string, image: string|null, site: string }|null>} Null without title and description.
 */
async function parsePreview(html, base) {
    const metas = {};
    let titles = 0;
    let pageTitle = '';

    await new HTMLRewriter()
        .on('meta', {
            element(element) {
                const name = (element.getAttribute('property') || element.getAttribute('name') || '').trim().toLowerCase();
                const content = element.getAttribute('content');

                if (name && content?.trim() && !(name in metas))
                    metas[name] = content;
            }
        })
        .on('title', {
            element() {
                titles++;
            },
            text(chunk) {
                if (titles == 1 && pageTitle.length < 2000)
                    pageTitle += chunk.text;
            }
        })
        // Scripts and styles dropped first: less to parse (CPU time is short on the free plan)
        .transform(new Response(html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ''), { headers: { 'content-type': 'text/html; charset=utf-8' } }))
        .arrayBuffer();

    const read = (...names) => names.map(name => metas[name]).find(Boolean) || '';
    let title = cutText(read('og:title', 'twitter:title') || pageTitle, PREVIEW_TITLE_MAX);
    let description = cutText(read('og:description', 'twitter:description', 'description'), PREVIEW_DESCRIPTION_MAX);
    const site = cutText(read('og:site_name'), PREVIEW_TITLE_MAX) || base.hostname.replace(/^www\./i, '');
    let image = null;

    if (!title && !description)
        return null;

    try {
        const source = decodeEntities(read('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src')).trim();
        const url = source ? new URL(source, base) : null;

        if (url?.protocol == 'https:' && isPreviewAllowed(url) && url.href.length <= PREVIEW_URL_MAX)
            image = url.href;

    } catch (error) {
        image = null;
    }

    // Only a description: it becomes the title
    if (!title) {
        title = description;
        description = '';
    }

    return { title, description, image, site };
}

/**
 * Reads a page for its preview: redirects followed by hand (each one checked), only HTML, only its head.
 * @param {URL} start - The link.
 * @param {string} lang - The reader's language (`accept-language`), or ''.
 *
 * @returns {Promise<Object|null>}
 */
async function readPreview(start, lang) {
    const signal = AbortSignal.timeout(PREVIEW_TIMEOUT_MS);
    const headers = {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'accept-language': lang ? `${lang},en;q=0.5` : 'en',
        'user-agent': PREVIEW_USER_AGENT
    };
    let address = start;

    for (let hop = 0; hop <= PREVIEW_REDIRECTS; hop++) {
        const response = await fetch(address.href, { headers, redirect: 'manual', signal });

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');

            response.body?.cancel().catch(() => {});

            if (!location)
                return null;

            const next = new URL(location, address);

            if (!isPreviewAllowed(next))
                return null;

            address = next;

            continue;
        }

        const type = response.headers.get('content-type') || 'text/html';

        if (!response.ok || !response.body || !/html|xml/i.test(type)) {
            response.body?.cancel().catch(() => {});

            return null;
        }

        return parsePreview(await readPageHead(response), address);
    }

    return null;
}

/**
 * Preview of a YouTube video through its official oEmbed: the watch page read from Cloudflare gave no metas in production (it did
 * from a home connection, 2026-10-23). Channels and other pages answer 404 there and are read like any page.
 * @param {URL} target - The link.
 *
 * @returns {Promise<Object|null>}
 */
async function readYoutubePreview(target) {
    if (!/(^|\.)(youtube\.com|youtu\.be)$/i.test(target.hostname))
        return null;

    const response = await fetch(`https://www.youtube.com/oembed?${new URLSearchParams({ url: target.href, format: 'json' })}`, {
        headers: { accept: 'application/json', 'user-agent': PREVIEW_USER_AGENT },
        signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS)
    });

    if (!response.ok) {
        response.body?.cancel().catch(() => {});

        return null;
    }

    const data = await response.json();
    const title = cutText(data?.title, PREVIEW_TITLE_MAX);
    let image = null;

    try {
        const url = data?.thumbnail_url ? new URL(data.thumbnail_url) : null;

        if (url?.protocol == 'https:' && isPreviewAllowed(url))
            image = url.href;

    } catch (error) {
        image = null;
    }

    return title ? { title, description: cutText(data?.author_name, PREVIEW_DESCRIPTION_MAX), image, site: 'YouTube' } : null;
}

/**
 * Preview of a link for the script (Phase 41): `{ preview }` or `{ none: true }`, both kept in the shared cache. Neither the link nor
 * the reader is logged.
 */
async function handlePreview(request, env, ctx, url) {
    if (await isLimited('preview', request.headers.get('cf-connecting-ip') || 'unknown', env))
        return reply({ error: 'too many requests' }, 429, { 'retry-after': '60' });

    const link = url.searchParams.get('url') || '';
    const lang = url.searchParams.get('lang') || '';
    let target;

    try {
        target = link.length <= PREVIEW_URL_MAX ? new URL(link) : null;

    } catch (error) {
        target = null;
    }

    if (!target || !isPreviewAllowed(target))
        return reply({ error: 'invalid url' }, 400);

    target.hash = '';

    const language = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i.test(lang) ? lang : '';
    // `v` changes with the reading code, so answers of an older version aren't served from the cache
    const cacheKey = new Request(`${url.origin}/preview?${new URLSearchParams({ url: target.href, lang: language, v: PREVIEW_CACHE_VERSION })}`);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);

    if (cached)
        return cached;

    let preview = null;

    try {
        preview = await readYoutubePreview(target).catch(() => null) || await readPreview(target, language);

    } catch (error) {
        // Unreachable, too slow or broken page: no preview (cached for less time)
        preview = null;
    }

    const seconds = preview ? PREVIEW_READY_SECONDS : PREVIEW_NONE_SECONDS;
    const response = reply(preview ? { preview } : { none: true }, 200, { 'cache-control': `public, max-age=${seconds}` });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'access-control-allow-origin': '*',
                    'access-control-allow-methods': 'GET, POST',
                    'access-control-allow-headers': 'content-type'
                }
            });
        }

        const url = new URL(request.url);
        const gifKind = KINDS[url.pathname];
        const stickerFile = STICKER_FILES[url.pathname];

        if (gifKind || stickerFile) {
            if (request.method !== 'GET')
                return reply({ error: 'method not allowed' }, 405);

            return gifKind ? handleGifs(request, env, ctx, url, gifKind) : handleStickerFile(request, env, ctx, url, stickerFile);
        }

        if (url.pathname === '/preview') {
            if (request.method !== 'GET')
                return reply({ error: 'method not allowed' }, 405);

            return handlePreview(request, env, ctx, url);
        }

        if (url.pathname === '/stickers/report') {
            if (request.method !== 'POST')
                return reply({ error: 'method not allowed' }, 405);

            return handleReport(request, env);
        }

        return reply({ error: 'not found' }, 404);
    }
};

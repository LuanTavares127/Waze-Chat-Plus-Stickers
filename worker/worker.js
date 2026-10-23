// Worker do Waze Chat Plus (Cloudflare): proxy de GIFs da KLIPY + rotas das figurinhas.
// Colado à mão no editor da Cloudflare (módulo ES). Segredos (Settings > Variables and Secrets, tipo Secret):
//   KLIPY_KEY    chave da KLIPY (nunca no código)
//   GITHUB_TOKEN token fine-grained deste repositório com SÓ a permissão "Issues: read and write" (denúncias)
// Rotas:
//   GET  /gifs/trending, /gifs/search   proxy da KLIPY (parâmetros validados, cache de 5 min compartilhado)
//   GET  /stickers/showcase             cópia de showcase.json do repositório de figurinhas (cache de 5 min)
//   GET  /stickers/blocked              cópia de blocked.json (cache de 5 min)
//   POST /stickers/report               { pack, sticker?, reason, details? } -> issue no repositório (sem conta)

const API = 'https://api.klipy.com/api/v1/';
const KINDS = { '/gifs/trending': 'trending', '/gifs/search': 'search' };
const FILTERS = new Set(['off', 'low', 'medium', 'high']);
const FORMATS = new Set(['gif', 'webp', 'jpg', 'mp4', 'webm']);
const CACHE_SECONDS = 300;

// Repositório de figurinhas (dono/nome sem diferença de maiúsculas para o GitHub)
const REPO = 'LuanTavares127/Waze-Chat-Plus-Stickers';
const BRANCH = 'main';
const STICKER_FILES = { '/stickers/showcase': 'showcase.json', '/stickers/blocked': 'blocked.json' };
const MAX_FILE_BYTES = 200000;

// Motivos da especificação (docs/sticker-packs.md §8)
const REASONS = new Set(['illegal', 'sexual', 'violence', 'hate', 'harassment', 'spam', 'copyright', 'other']);
const PACK_PATTERN = /^gh:[a-z0-9_.-]{1,40}\/[a-z0-9_.-]{1,100}(\/[a-z0-9_.-]{1,60}){0,4}$/;
const STICKER_PATTERN = /^[a-z0-9_.-]{1,64}$/;
const MAX_REPORT_BYTES = 4000;

// Limites por IP (só valem dentro de uma instância do Worker, então são um freio leve)
const LIMITS = {
    gifs: { max: 60, windowMs: 60000 },
    stickers: { max: 60, windowMs: 60000 },
    report: { max: 5, windowMs: 3600000 }
};
const hits = new Map();

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
 * Counts a request of an IP in a named window.
 * @param {string} name - Key of LIMITS.
 * @param {string} ip - Client address.
 *
 * @returns {boolean} true when the IP is over the limit.
 */
function isLimited(name, ip) {
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
 * Proxy of the KLIPY search (the key stays in the secret KLIPY_KEY, only known parameters pass).
 */
async function handleGifs(request, env, ctx, url, kind) {
    if (!env.KLIPY_KEY)
        return reply({ error: 'not configured' }, 500);

    if (isLimited('gifs', request.headers.get('cf-connecting-ip') || 'unknown'))
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

    // O cache é compartilhado entre usuários: o customer_id não entra na chave
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

    // Nunca devolve o corpo do erro (pode citar a chave); só o código
    if (!upstream.ok)
        return reply({ error: 'upstream error', status: upstream.status }, upstream.status === 429 ? 429 : 502);

    const response = reply(await upstream.json(), 200, { 'cache-control': `public, max-age=${CACHE_SECONDS}` });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
}

/**
 * Serves showcase.json / blocked.json of the stickers repository (read from the branch, so a commit reaches users in minutes).
 */
async function handleStickerFile(request, ctx, url, file) {
    if (isLimited('stickers', request.headers.get('cf-connecting-ip') || 'unknown'))
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

    // Só repassa o que tem a forma esperada do formato 1
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

    if (isLimited('report', request.headers.get('cf-connecting-ip') || 'unknown'))
        return reply({ error: 'too many requests' }, 429, { 'retry-after': '3600' });

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

    // Nunca devolve o corpo do erro do GitHub
    if (!upstream.ok)
        return reply({ error: 'upstream error', status: upstream.status }, 502);

    return reply({ ok: true }, 201);
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

            return gifKind ? handleGifs(request, env, ctx, url, gifKind) : handleStickerFile(request, ctx, url, stickerFile);
        }

        if (url.pathname === '/stickers/report') {
            if (request.method !== 'POST')
                return reply({ error: 'method not allowed' }, 405);

            return handleReport(request, env);
        }

        return reply({ error: 'not found' }, 404);
    }
};

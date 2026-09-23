/**
 * Forwarding a request to an arccms- function, unchanged.
 *
 * A proxy rather than a redirect: webhook senders (Dodo, email providers) often
 * do not follow redirects, and their signatures are computed over the raw body,
 * so the body must arrive byte for byte. CORS preflights are forwarded too, so a
 * browser calling the old `search` callable gets the new one's CORS answer.
 */

/** Request headers that describe this hop, not the request. */
const HOP_HEADERS = new Set([
    'host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive',
    'upgrade', 'proxy-authorization', 'te', 'trailer', 'accept-encoding',
]);

/** Response headers fetch has already acted on, or that describe the upstream hop. */
const DROP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

/** The successor's URL, keeping the caller's query string. */
export function targetUrl({ name, project, region, originalUrl }) {
    const query = originalUrl && originalUrl.includes('?') ? originalUrl.slice(originalUrl.indexOf('?')) : '';
    return `https://${region}-${project}.cloudfunctions.net/arccms-${name}${query}`;
}

/** The headers to send upstream. */
export function forwardHeaders(headers) {
    const out = {};
    for (const [key, value] of Object.entries(headers || {})) {
        if (HOP_HEADERS.has(key.toLowerCase()) || value === undefined) continue;
        out[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    return out;
}

/** Forward `req` to `url` and write the answer to `res`. */
export async function forward(req, res, url, fetchImpl = fetch) {
    const init = { method: req.method, headers: forwardHeaders(req.headers), redirect: 'manual' };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.rawBody) init.body = req.rawBody;

    let upstream;
    try {
        upstream = await fetchImpl(url, init);
    } catch (err) {
        console.error(`legacy proxy: ${url} unreachable`, err);
        res.status(502).send('Bad gateway');
        return;
    }

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
        if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
    });
    res.send(Buffer.from(await upstream.arrayBuffer()));
}

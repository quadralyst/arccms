/**
 * The app's own HTTP response headers (docs/operations/deploy.html#security-headers).
 *
 * Arc CMS sends security headers on every address (firebase.json, its site-wide rule,
 * SITE_WIDE below):
 * frame protection, nosniff, Referrer-Policy, HSTS, a Permissions-Policy that turns off
 * the camera, geolocation and payments, which core never uses, and a
 * Content-Security-Policy in report-only mode. An app that needs one of those (a page
 * that scans with the camera, a script from another host) lists its headers in
 * src/custom/site/headers.json, in Firebase Hosting's own header format:
 *
 *   [
 *     { "source": "**", "headers": [{ "key": "Permissions-Policy", "value": "camera=(self), microphone=(self), geolocation=(), payment=()" }] },
 *     { "source": "/kiosk/**", "headers": [{ "key": "Cache-Control", "value": "no-store" }] }
 *   ]
 *
 * The file is the app's (custom space), so firebase.json, a core file, never needs an
 * edit. A header in a `**` rule goes into Arc CMS's site-wide rule, replacing Arc CMS's
 * value or adding one;
 * a rule for some addresses is added after Arc CMS's own. A header Arc CMS sends on
 * every address can only be changed in a `**` rule, so one value is ever in force. The
 * website deploy (scripts/arc-deploy.mjs) puts them in the Hosting config it uploads,
 * as it does the app's redirects; `npm run dev` and `npm run build` check the file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The app's headers file, from the repo root. */
export const APP_HEADERS = 'src/custom/site/headers.json';

/** The source of the app's rule for every address. */
export const EVERY_ADDRESS = '**';

/**
 * Arc CMS's site-wide rule in firebase.json matches every address but Firebase's own
 * under /__/ (written without lookahead, which Hosting's RE2 lacks): the sign-in helper
 * Firebase serves at /__/auth/iframe is framed by the site from the auth domain, which
 * may be another origin, so it must not get X-Frame-Options.
 */
export const SITE_WIDE = '^/(|[^_].*|_|_[^_].*|__|__[^/].*)$';

/** Whether a rule of Arc CMS's applies to every address of the site. */
const isSiteWide = (rule) => (rule.source === EVERY_ADDRESS && !('regex' in rule)) || rule.regex === SITE_WIDE;

const RULE_FIELDS = ['source', 'regex', 'headers'];
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** The header names (lowercase) a config's `**` rule sets, in each Hosting block. */
function everyAddressKeys(config) {
    const blocks = Array.isArray(config?.hosting) ? config.hosting : config?.hosting ? [config.hosting] : [];
    return new Set(blocks.flatMap((hosting) => (hosting.headers ?? [])
        .filter(isSiteWide)
        .flatMap((rule) => (rule.headers ?? []).map((header) => String(header.key).toLowerCase()))));
}

/**
 * Everything wrong with a headers list, one line per problem, each naming its rule by
 * number (from 1). `core` is the Hosting config the rules go into: a header it sends on
 * every address may only be changed in a `**` rule. Empty when the list is fine.
 */
export function headerProblems(list, core = null) {
    if (!Array.isArray(list)) {
        return ['It must hold a list: [ { "source": "**", "headers": [ { "key": "Permissions-Policy", "value": "camera=(self)" } ] } ].'];
    }
    const coreKeys = everyAddressKeys(core);
    const problems = [];
    list.forEach((rule, index) => {
        const n = index + 1;
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
            problems.push(`Rule ${n} is not an object with "source" and "headers".`);
            return;
        }
        const name = `Rule ${n}${typeof rule.source === 'string' ? ` ("${rule.source}")` : typeof rule.regex === 'string' ? ` (regex "${rule.regex}")` : ''}`;
        for (const key of Object.keys(rule)) {
            if (!RULE_FIELDS.includes(key)) problems.push(`${name} has an unknown field "${key}" (allowed: ${RULE_FIELDS.join(', ')}).`);
        }
        const hasSource = 'source' in rule;
        const hasRegex = 'regex' in rule;
        if (hasSource && hasRegex) problems.push(`${name} has both "source" and "regex": give one.`);
        else if (!hasSource && !hasRegex) problems.push(`${name} has no "source" (or "regex"): the addresses it is for, "**" for all.`);
        else if (hasSource && (typeof rule.source !== 'string' || !/^[/*]/.test(rule.source))) {
            problems.push(`${name}: "source" must be an address pattern starting with "/" or "**".`);
        } else if (hasRegex) {
            try {
                if (typeof rule.regex !== 'string' || !rule.regex.trim()) throw new Error('empty');
                new RegExp(rule.regex.replace(/\(\?P</g, '(?<'));
            } catch {
                problems.push(`${name}: "regex" must be a regular expression such as "^/kiosk/.*$".`);
            }
        }
        if (!Array.isArray(rule.headers) || !rule.headers.length) {
            problems.push(`${name} has no "headers": a list of { "key": ..., "value": ... }.`);
            return;
        }
        const everyAddress = hasSource && !hasRegex && rule.source === EVERY_ADDRESS;
        rule.headers.forEach((header, h) => {
            const label = `${name}, header ${h + 1}`;
            if (!header || typeof header !== 'object' || Array.isArray(header)) {
                problems.push(`${label} is not an object with "key" and "value".`);
                return;
            }
            for (const key of Object.keys(header)) {
                if (key !== 'key' && key !== 'value') problems.push(`${label} has an unknown field "${key}" (allowed: key, value).`);
            }
            if (typeof header.key !== 'string' || !HEADER_NAME.test(header.key)) {
                problems.push(`${label}: "key" must be a header name such as "Permissions-Policy".`);
            } else if (!everyAddress && coreKeys.has(header.key.toLowerCase())) {
                problems.push(`${label}: Arc CMS sends ${header.key} on every address, so change it in a "**" rule, which replaces Arc CMS's value.`);
            }
            if (typeof header.value !== 'string' || /[\r\n]/.test(header.value)) {
                problems.push(`${label}: "value" must be text on one line.`);
            }
        });
    });
    return problems;
}

/**
 * The app's headers, checked against `core` (the Hosting config they go into): [] when
 * there is no file. Throws, with a message naming every bad rule, when the file is not
 * valid JSON or a rule is wrong.
 */
export function readAppHeaders(root = ROOT, core = null) {
    const file = resolve(root, APP_HEADERS);
    if (!existsSync(file)) return [];
    let list;
    try {
        list = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`${APP_HEADERS} is not valid JSON: ${error.message}`);
    }
    const problems = headerProblems(list, core ?? readCoreConfig(root));
    if (problems.length) {
        throw new Error(`${APP_HEADERS} has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`} (see docs/operations/deploy.html#security-headers):\n  ${problems.join('\n  ')}`);
    }
    return list;
}

function readCoreConfig(root) {
    try {
        return JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
    } catch {
        return null;
    }
}

/**
 * A copy of a Firebase CLI config with the app's headers in each Hosting block: those
 * of a `**` rule replace Arc CMS's value of the same header on its site-wide rule (or
 * join it), and every other rule comes after Arc CMS's own. A config without Hosting is
 * returned as it is.
 */
export function withAppHeaders(config, rules) {
    if (!rules.length || !config?.hosting) return config;
    const out = structuredClone(config);
    const add = (hosting) => {
        const headers = structuredClone(hosting.headers ?? []);
        for (const rule of structuredClone(rules)) {
            const target = rule.source === EVERY_ADDRESS && !('regex' in rule) && headers.find(isSiteWide);
            if (!target) {
                headers.push(rule);
                continue;
            }
            for (const header of rule.headers) {
                const at = target.headers.findIndex((existing) => existing.key.toLowerCase() === header.key.toLowerCase());
                if (at === -1) target.headers.push(header);
                else target.headers[at] = header;
            }
        }
        return { ...hosting, headers };
    };
    out.hosting = Array.isArray(out.hosting) ? out.hosting.map(add) : add(out.hosting);
    return out;
}

/**
 * The app's own HTTP redirects (docs/website/redirects.html).
 *
 * A site moving to Arc CMS keeps its old addresses working by listing them in
 * src/custom/site/redirects.json, in Firebase Hosting's own redirect format:
 *
 *   [
 *     { "source": "/services-web-designing.html", "destination": "/services/web-designing", "type": 301 },
 *     { "regex": "^/blog/(?P<slug>[^/]+)\\.html$", "destination": "/blog/:slug", "type": 301 }
 *   ]
 *
 * The file is the app's (custom space), so firebase.json, a core file, never needs
 * an edit. No file means no redirects. The website deploy (scripts/arc-deploy.mjs)
 * puts these first in the Hosting config it uploads to the deploy channel, ahead of
 * Arc CMS's own redirects: Hosting answers with the first redirect that matches, so
 * an app can take over an address Arc CMS's own redirect would otherwise take (a
 * Blogger site's /p/about.html, say). The live release copies that config, so the
 * redirects go live with the build. The website build (scripts/vite-arc-site.ts)
 * checks the file too, so a mistake stops `npm run build` and `npm run dev` with a
 * message, as a broken strings file does.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The app's redirects file, from the repo root. */
export const APP_REDIRECTS = 'src/custom/site/redirects.json';

/** The status codes Firebase Hosting takes for a redirect; without `type` it sends 301. */
export const REDIRECT_TYPES = [301, 302];

const FIELDS = ['source', 'regex', 'destination', 'type'];

/**
 * Addresses Arc CMS needs for itself, with sample requests under each: one of every
 * kind of file served there, so a pattern for every .html address is caught by the
 * templates it would take. A redirect that matches one would break the admin, the
 * site's own files, its search engine files or a function, so it is refused.
 * Firebase's own /__/ addresses never redirect at all.
 */
export const RESERVED_PATHS = [
    { path: '/admin', samples: ['/admin', '/admin/dashboard'] },
    { path: '/assets/', samples: ['/assets/css/main.css', '/assets/css/site.css', '/assets/js/arc-site.js'] },
    {
        path: '/_site/',
        samples: [
            '/_site/site.json', '/_site/header.html', '/_site/footer.html', '/_site/home.html', '/_site/sign-in.html',
            '/_site/templates/default/detail.html', '/_site/templates/default/list.html', '/_site/templates/default/partials.html',
            '/_site/pages/terms.html', '/_site/strings/en.json',
        ],
    },
    { path: '/site/', samples: ['/site/images/logo.png', '/site/home.css', '/site/home.js'] },
    { path: '/_arc/', samples: ['/_arc/version.json'] },
    { path: '/__/', samples: ['/__/auth/handler'] },
    { path: '/unsubscribe', samples: ['/unsubscribe'] },
    { path: '/email-preferences', samples: ['/email-preferences'] },
    { path: '/sitemap.xml', samples: ['/sitemap.xml'] },
    { path: '/robots.txt', samples: ['/robots.txt'] },
    { path: '/llms.txt', samples: ['/llms.txt'] },
];

const escapeRegex = (text) => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/**
 * A glob `source` as a RegExp, close enough to tell whether it can match an address:
 * `**` any path, `*` and `?` within a segment, `:name` one segment, `:name*` the rest,
 * `{a,b}` and `@(a|b)` alternatives. Null when it cannot be read that way.
 */
export function globToRegExp(glob) {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        const rest = glob.slice(i);
        let m;
        if (rest.startsWith('**')) { out += '.*'; i++; }
        else if ((m = /^:[A-Za-z_][A-Za-z0-9_]*\*/.exec(rest))) { out += '.*'; i += m[0].length - 1; }
        else if ((m = /^:[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) { out += '[^/]+'; i += m[0].length - 1; }
        else if (/^[@?+*!]\(/.test(rest)) {
            const end = glob.indexOf(')', i);
            if (end === -1) return null;
            const quantifier = { '@': '', '?': '?', '+': '+', '*': '*', '!': '' }[c];
            out += `(?:${glob.slice(i + 2, end).split('|').map(escapeRegex).join('|')})${quantifier}`;
            i = end;
        }
        else if (c === '*') out += '[^/]*';
        else if (c === '?') out += '[^/]';
        else if (c === '{') {
            const end = glob.indexOf('}', i);
            if (end === -1) return null;
            out += `(?:${glob.slice(i + 1, end).split(',').map(escapeRegex).join('|')})`;
            i = end;
        }
        else out += escapeRegex(c);
    }
    try {
        return new RegExp(`^${out}$`);
    } catch {
        return null;
    }
}

/** An RE2 `regex` as a JavaScript RegExp (RE2 names a group `(?P<name>`), or null. */
export function re2ToRegExp(regex) {
    try {
        return new RegExp(regex.replace(/\(\?P</g, '(?<'));
    } catch {
        return null;
    }
}

/** Whether a source has no pattern in it: one exact address. */
const isLiteral = (source) => !/[*?{}[\]:()!@+]/.test(source);

/** Whether a destination is an address on this site (`/...`) or an http(s) URL. */
export function isValidDestination(destination) {
    if (typeof destination !== 'string' || !destination || /\s/.test(destination)) return false;
    if (destination.startsWith('/')) return !destination.startsWith('//');
    return /^https?:\/\/[^/]+/i.test(destination);
}

/**
 * Everything wrong with a redirects list, one line per problem, each naming its
 * entry by number (from 1) and source. Empty when the list is fine.
 */
export function redirectProblems(list) {
    if (!Array.isArray(list)) {
        return ['It must hold a list: [ { "source": "/old.html", "destination": "/new", "type": 301 } ].'];
    }
    const problems = [];
    const seen = new Map();
    list.forEach((entry, index) => {
        const n = index + 1;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            problems.push(`Redirect ${n} is not an object with "source", "destination" and "type".`);
            return;
        }
        const name = `Redirect ${n}${typeof entry.source === 'string' ? ` ("${entry.source}")` : typeof entry.regex === 'string' ? ` (regex "${entry.regex}")` : ''}`;
        for (const key of Object.keys(entry)) {
            if (!FIELDS.includes(key)) problems.push(`${name} has an unknown field "${key}" (allowed: ${FIELDS.join(', ')}).`);
        }
        const hasSource = 'source' in entry;
        const hasRegex = 'regex' in entry;
        let matcher = null;
        if (hasSource && hasRegex) problems.push(`${name} has both "source" and "regex": give one.`);
        else if (!hasSource && !hasRegex) problems.push(`${name} has no "source" (or "regex"): the old address to redirect.`);
        else if (hasSource) {
            if (typeof entry.source !== 'string' || !entry.source.trim()) problems.push(`${name}: "source" must be an address pattern such as "/old-page.html".`);
            else if (!/^[/*]/.test(entry.source)) problems.push(`${name}: "source" must start with "/", as in "/${entry.source}".`);
            else matcher = globToRegExp(entry.source);
        } else if (typeof entry.regex !== 'string' || !entry.regex.trim()) {
            problems.push(`${name}: "regex" must be a regular expression such as "^/old/(.*)$".`);
        } else {
            matcher = re2ToRegExp(entry.regex);
            if (!matcher) problems.push(`${name}: "regex" is not a valid regular expression.`);
        }
        if (!('destination' in entry)) problems.push(`${name} has no "destination": the new address.`);
        else if (!isValidDestination(entry.destination)) {
            problems.push(`${name}: "destination" must be an address on this site starting with "/" or a full http(s) URL, not ${JSON.stringify(entry.destination)}.`);
        } else if (hasSource && !hasRegex && typeof entry.source === 'string' && isLiteral(entry.source) && entry.source === entry.destination) {
            problems.push(`${name} redirects to itself, so the browser would loop.`);
        }
        if ('type' in entry && !REDIRECT_TYPES.includes(entry.type)) {
            problems.push(`${name}: "type" must be 301 (moved for good) or 302 (moved for now), not ${JSON.stringify(entry.type)}.`);
        }
        if (matcher) {
            const shadowed = RESERVED_PATHS.find(({ samples }) => samples.some((path) => matcher.test(path)));
            if (shadowed) problems.push(`${name} would also catch ${shadowed.path}, which Arc CMS needs for itself. Make the pattern narrower.`);
        }
        const key = hasSource ? `source ${entry.source}` : `regex ${entry.regex}`;
        if ((hasSource || hasRegex) && seen.has(key)) {
            problems.push(`${name} repeats redirect ${seen.get(key)}: only the first would ever be used.`);
        } else if (hasSource || hasRegex) seen.set(key, n);
    });
    return problems;
}

/**
 * The app's redirects, checked: [] when there is no file. Throws, with a message
 * naming every bad entry, when the file is not valid JSON or a redirect is wrong.
 */
export function readAppRedirects(root = ROOT) {
    const file = resolve(root, APP_REDIRECTS);
    if (!existsSync(file)) return [];
    let list;
    try {
        list = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`${APP_REDIRECTS} is not valid JSON: ${error.message}`);
    }
    const problems = redirectProblems(list);
    if (problems.length) {
        throw new Error(`${APP_REDIRECTS} has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`} (see docs/website/redirects.html):\n  ${problems.join('\n  ')}`);
    }
    return list;
}

/**
 * A copy of a Firebase CLI config with the app's redirects first in each Hosting
 * block, before Arc CMS's own. A config without Hosting is returned as it is.
 */
export function withAppRedirects(config, redirects) {
    if (!redirects.length || !config?.hosting) return config;
    const out = structuredClone(config);
    const add = (hosting) => ({ ...hosting, redirects: [...structuredClone(redirects), ...(hosting.redirects ?? [])] });
    out.hosting = Array.isArray(out.hosting) ? out.hosting.map(add) : add(out.hosting);
    return out;
}

/**
 * Where the website deploy writes its Hosting config when the app has redirects. A
 * project id never holds a dot, so this never meets firebase.<projectId>.json. In the
 * repo root, as the Firebase CLI reads the paths in a config from the config's folder.
 */
export function websiteConfigPath(projectId, root = ROOT) {
    return resolve(root, `firebase.${projectId}.website.json`);
}

/**
 * Writes the config the website deploy uploads: `base` (the project's generated
 * firebase.<projectId>.json, else firebase.json) with the app's redirects first.
 * Returns its path, or null when the app has no redirects and `base`'s own file serves.
 */
export function writeWebsiteConfig(projectId, base, redirects, root = ROOT) {
    if (!redirects.length) return null;
    const path = websiteConfigPath(projectId, root);
    writeFileSync(path, `${JSON.stringify(withAppRedirects(base, redirects), null, 4)}\n`);
    return path;
}

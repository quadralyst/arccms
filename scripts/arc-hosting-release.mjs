/**
 * A website deploy that keeps the published pages (docs/operations/deploy.html).
 *
 * The publish functions write pages straight to Firebase Hosting: the home page,
 * every content page and list page, the static pages, the sitemap, feeds,
 * robots.txt and llms.txt. None of them is in the build. A plain
 * `firebase deploy --only hosting` replaces the site with the build, so until the
 * republish (`npm run seed:*`) those addresses showed the browser app instead.
 *
 * So the website goes live in two steps, with one switch for visitors:
 *
 *   1. `firebase hosting:channel:deploy arc-deploy`: the CLI uploads the build to
 *      a preview channel, with the Hosting config (headers, rewrites) from the
 *      install's firebase.json. The live site is untouched.
 *   2. A new live version made of that build plus the live site's published files,
 *      by hash, so nothing is uploaded twice. Then it is released: visitors go
 *      from the old site to the new one in one step, published pages included.
 *
 * If step 2 fails, the live site is still the old one, whole.
 */
import { accessToken } from './arc-admin-script.mjs';

export const DEPLOY_CHANNEL = 'arc-deploy';
export const HOSTING_API = 'https://firebasehosting.googleapis.com/v1beta1';

/** Folders only the build writes; nothing published lives there. */
const BUILD_FOLDERS = /^\/(assets|_site|site)\//;
/** What the publish functions write at the top level: pages, feeds, robots.txt, llms.txt, key files. */
const PUBLISHED_TOP_LEVEL = /^\/[^/]+\.(html|xml|txt|md)$/;
/**
 * The seo feature's files: robots.txt, the sitemap, llms.txt, llms-full.txt, the
 * IndexNow key file (32 hex characters) and each content type's feed.
 */
export const SEO_FILES = /^\/(?:robots\.txt|sitemap\.xml|llms\.txt|llms-full\.txt|[0-9a-f]{32}\.txt|[^/]+\/feed\.xml)$/;
/** The home page in the default language and in each other one. */
export const HOME_PATH = /^\/(?:([a-z]{2,3}(?:-[a-z0-9]{2,8})?)\/)?index\.html$/;

/**
 * The live files to carry into the new version: every published file, by path
 * and hash.
 *
 *   live       { path: hash } of the live version
 *   build      { path: hash } of the new build
 *   publishedHomes  the home page paths that are published pages, not a build's
 *              copy (an older build prerendered /index.html and /hi/index.html)
 *   pages      the site's static pages (site.json `pages`); a published static
 *              page the site no longer has is dropped
 *   seo        whether the seo feature is on; off, its files (SEO_FILES) are
 *              dropped, so one website deploy removes what an earlier publish wrote
 *
 * A file the build has is the build's, except a published home page, which wins
 * over the build's /index.html (the app shell). Files from older builds, such as
 * hashed scripts, are left behind.
 */
export function keptPublishedFiles({ live, build, publishedHomes = new Set(), pages = null, seo = true }) {
    const keep = {};
    for (const [path, hash] of Object.entries(live)) {
        if (HOME_PATH.test(path)) {
            if (publishedHomes.has(path)) keep[path] = hash;
            continue;
        }
        if (path in build) continue;
        if (BUILD_FOLDERS.test(path)) continue;
        if (!seo && SEO_FILES.test(path)) continue;
        if (!path.slice(1).includes('/') && !PUBLISHED_TOP_LEVEL.test(path)) continue;
        const page = /^\/pages\/([^/]+)\//.exec(path);
        if (page && pages && !(page[1] in pages)) continue;
        keep[path] = hash;
    }
    return keep;
}

/** A Hosting REST client: `api(method, path, body?)` resolves to the JSON answer. */
export function hostingApi(token, fetchImpl = fetch) {
    return async (method, path, body) => {
        const res = await fetchImpl(`${HOSTING_API}/${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Hosting API ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
        return text ? JSON.parse(text) : {};
    };
}

/** Every file of a version as { path: hash }, page by page (the API returns at most 1000 at a time). */
export async function versionFiles(api, versionName) {
    const files = {};
    let pageToken = '';
    do {
        const page = await api('GET', `${versionName}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
        for (const file of page.files ?? []) files[file.path] = file.hash;
        pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return files;
}

/** Whether the live home page at this path is a published page: those carry arc-deployed-at. */
async function isPublishedHome(site, path, fetchImpl) {
    const url = `https://${site}.web.app${path.replace(/index\.html$/, '')}?arc-deploy=${Date.now()}`;
    try {
        const res = await fetchImpl(url, { cache: 'no-store' });
        return res.ok && /name=["']arc-deployed-at["']/.test(await res.text());
    } catch {
        return false;
    }
}

/**
 * Step 2: a live release of the channel's build plus the live site's published
 * files. Returns { kept, version }.
 */
export async function releaseKeepingPublished({ site, api, fetchImpl = fetch, channel = DEPLOY_CHANNEL, log = console.log, seo = true }) {
    const channelInfo = await api('GET', `sites/${site}/channels/${channel}`);
    const buildVersion = channelInfo.release?.version?.name;
    if (!buildVersion) throw new Error(`The ${channel} channel has no build; the channel deploy did not finish.`);
    const [buildVersionInfo, build] = await Promise.all([api('GET', buildVersion), versionFiles(api, buildVersion)]);

    const releases = await api('GET', `sites/${site}/releases?pageSize=1`);
    const liveVersion = releases.releases?.[0]?.version?.name;
    const live = liveVersion ? await versionFiles(api, liveVersion) : {};

    const homes = Object.keys(live).filter((p) => HOME_PATH.test(p));
    const publishedHomes = new Set();
    for (const path of homes) {
        if (await isPublishedHome(site, path, fetchImpl)) publishedHomes.add(path);
    }
    let pages = null;
    try {
        // The new build's static pages; without the list, every published static page is kept.
        const manifest = channelInfo.url ? await fetchImpl(`${channelInfo.url}/_site/site.json?arc-deploy=${Date.now()}`, { cache: 'no-store' }) : null;
        if (manifest?.ok) pages = (await manifest.json()).pages ?? null;
    } catch {
        pages = null;
    }
    const kept = keptPublishedFiles({ live, build, publishedHomes, pages, seo });
    const dropped = seo ? [] : Object.keys(live).filter((path) => SEO_FILES.test(path) && !(path in build));
    if (dropped.length) log(`The seo feature is off: removing ${dropped.join(', ')} from the site.`);

    const version = await api('POST', `sites/${site}/versions`, { config: buildVersionInfo.config ?? {} });
    const populated = await api('POST', `${version.name}:populateFiles`, { files: { ...build, ...kept } });
    if (populated.uploadRequiredHashes?.length) {
        throw new Error(`Hosting asked for ${populated.uploadRequiredHashes.length} file(s) it should already have; nothing was released.`);
    }
    await api('PATCH', `${version.name}?updateMask=status`, { status: 'FINALIZED' });
    await api('POST', `sites/${site}/releases?versionName=${encodeURIComponent(version.name)}`, {
        message: `Website deploy, ${Object.keys(kept).length} published file(s) kept`,
    });
    log(`Released the website to ${site} with ${Object.keys(kept).length} published file(s) kept.`);
    return { kept: Object.keys(kept).length, version: version.name };
}

/** The Hosting site a Firebase config deploys to: its `site`, else the project's default site. */
export function hostingSiteOf(config, projectId) {
    const hosting = Array.isArray(config?.hosting) ? config.hosting[0] : config?.hosting;
    return hosting?.site || projectId;
}

/**
 * The firebase arguments for everything but the website, or null when the deploy
 * is the website only. A plain deploy (no --only) becomes `--except hosting`.
 */
export function withoutHosting(args) {
    const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
    if (i === -1) return [...args, '--except', 'hosting'];
    const inline = args[i].startsWith('--only=');
    const only = inline ? args[i].slice('--only='.length) : args[i + 1] || '';
    const rest = only.split(',').map((t) => t.trim()).filter((t) => t && t.split(':')[0] !== 'hosting');
    if (!rest.length) return null;
    const out = [...args];
    if (inline) out.splice(i, 1, `--only=${rest.join(',')}`);
    else out.splice(i, 2, '--only', rest.join(','));
    return out;
}

/** The `firebase` arguments for step 1, the build on the deploy channel. */
export function channelDeployArgs({ projectId, configPath, channel = DEPLOY_CHANNEL }) {
    return ['hosting:channel:deploy', channel, '--expires', '1h', '--no-authorized-domains', ...(configPath ? ['--config', configPath] : []), '--project', projectId];
}

/** Step 2 with the person's own credentials. */
export async function releaseWebsite({ site, log = console.log, seo = true }) {
    const api = hostingApi(await accessToken());
    return releaseKeepingPublished({ site, api, log, seo });
}

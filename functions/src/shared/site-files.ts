import { arcHostingOrigin, arcHostingSite } from '../arc-config.js';
import { isTemplateFragment } from './template-fragment.js';
import { DEFAULT_TEMPLATES } from '../site-defaults.gen.js';

/**
 * The live site's own files, read by publishing (specs/own-website-spec.md, W3).
 *
 * The build assembles Arc CMS's defaults (public/_site/) and the app's website
 * (src/custom/site/) into /_site/ on Hosting (scripts/arc-site.mjs), and lists
 * what it holds in /_site/site.json. The app renders from those files and
 * publishing reads the same ones from the live site, so a published page is the
 * page the app previews. Nothing is read from Firestore.
 *
 * Each file is cached under its build hash from /_site/site.json, and the
 * manifest itself for a few seconds, so a deploy is seen at once;
 * clearSiteFilesCache() (called by clearSettingsCache) empties it.
 */

export type TemplateFile = 'partials' | 'list' | 'detail';

/** What /_site/site.json says; mirrors buildManifest() in scripts/arc-site.mjs. */
export interface SiteManifest {
    version: number;
    home: Record<string, 'core' | 'app'>;
    templates: Record<string, Partial<Record<TemplateFile, 'core' | 'app'>>>;
    pages: Record<string, 'core' | 'app'>;
    strings: string[];
    files: Record<string, string>;
}

export const DEFAULT_TEMPLATE_FOLDER = 'default';

/** The static pages a site without a manifest is assumed to have. */
export const LEGACY_STATIC_PAGES = ['privacy-policy', 'cookie-policy'];

/**
 * A content type names a template folder the live site does not have. Thrown so
 * the publish fails with a status the admin can act on, rather than publishing a
 * page in the wrong layout.
 */
export class MissingTemplateFolderError extends Error {
    constructor(readonly folder: string, liveSiteHasFiles: boolean) {
        super(liveSiteHasFiles
            ? `Template folder '${folder}' is not on the live site. Deploy the website, then publish again.`
            : `The live site has no template files yet, so template folder '${folder}' cannot be read. Deploy the website, then publish again.`);
        this.name = 'MissingTemplateFolderError';
    }
}

/**
 * How long the manifest is trusted before it is read again. Short, so "deploy the
 * website, then publish" works at once; long enough that one publish run, which
 * reads many files, reads the manifest once.
 */
const MANIFEST_TTL_MS = 10 * 1000;
/** Files by path and build hash: a deploy that changes a file changes its key. */
const fileCache = new Map<string, { text: string | null; timestamp: number }>();
let manifestCache: { data: SiteManifest | null; timestamp: number } | null = null;

const fresh = (timestamp: number) => Date.now() - timestamp < MANIFEST_TTL_MS;

/** Empties the cache, for a run that needs what is live now (the seed). */
export function clearSiteFilesCache(): void {
    fileCache.clear();
    manifestCache = null;
}

/**
 * A file under /_site/ on the live site as it is now, or null when there is none
 * (hosting off, not deployed, or a path the site does not have: Hosting answers
 * those with the app shell, which is recognised and refused).
 */
async function fetchSiteFile(path: string): Promise<string | null> {
    if (!arcHostingSite()) return null;
    try {
        const res = await fetch(`${arcHostingOrigin()}/_site/${path}`);
        if (!res.ok) return null;
        const body = await res.text();
        // The app shell (and the not-found page it renders) carries <arc-root>;
        // no site file does.
        return /<arc-root[\s>]/.test(body) ? null : body;
    } catch {
        return null;
    }
}

/**
 * A file under /_site/ on the live site, or null when there is none.
 *
 * A file the manifest lists is cached under its build hash, so it is read again
 * only after a deploy changed it. A file it does not list, or any file of a site
 * without a manifest, is kept no longer than the manifest.
 */
export async function getSiteFile(path: string): Promise<string | null> {
    const manifest = await getSiteManifest();
    const hash = manifest?.files[`_site/${path}`];
    const key = `${path}#${hash ?? ''}`;
    const cached = fileCache.get(key);
    if (cached && (hash || fresh(cached.timestamp))) return cached.text;

    const text = await fetchSiteFile(path);
    fileCache.set(key, { text, timestamp: Date.now() });
    return text;
}

/**
 * The live site's manifest, or null when the live site has none (not yet deployed
 * with /_site/). `reread` skips the cache, for a check that must not act on a
 * manifest from before the last deploy.
 */
export async function getSiteManifest(reread = false): Promise<SiteManifest | null> {
    if (!reread && manifestCache && fresh(manifestCache.timestamp)) return manifestCache.data;
    let data: SiteManifest | null = null;
    const text = await fetchSiteFile('site.json');
    if (text) {
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && parsed.templates && parsed.pages) data = parsed as SiteManifest;
        } catch {
            data = null;
        }
    }
    manifestCache = { data, timestamp: Date.now() };
    return data;
}

/**
 * A content type's template file, the way the app chooses it: the type's folder,
 * else the default; a folder without that file uses the default's.
 *
 * Read from the live site. The default folder's copy built into the functions
 * (DEFAULT_TEMPLATES) is used only when the live site cannot give one. A folder
 * other than the default that the live site does not have throws
 * MissingTemplateFolderError.
 */
export async function loadSiteTemplate(folder: string | null | undefined, file: TemplateFile): Promise<string> {
    const wanted = folder && folder !== DEFAULT_TEMPLATE_FOLDER ? folder : DEFAULT_TEMPLATE_FOLDER;
    // Hosting off: the page is built but never deployed (the deploy records a
    // skip), so there is no live site to read and nothing to guard.
    if (!arcHostingSite()) return DEFAULT_TEMPLATES[file];
    let manifest = await getSiteManifest();
    // A folder the cached manifest lacks may have been deployed since it was read.
    if (wanted !== DEFAULT_TEMPLATE_FOLDER && !manifest?.templates[wanted]) manifest = await getSiteManifest(true);

    if (wanted !== DEFAULT_TEMPLATE_FOLDER && !manifest?.templates[wanted]) {
        throw new MissingTemplateFolderError(wanted, !!manifest);
    }

    const from = manifest?.templates[wanted]?.[file] ? wanted : DEFAULT_TEMPLATE_FOLDER;
    const text = manifest ? await getSiteFile(`templates/${from}/${file}.html`) : null;
    if (text && isTemplateFragment(text)) return text;
    if (from !== DEFAULT_TEMPLATE_FOLDER) {
        // Listed in the manifest but not readable as a template: the deploy is
        // half done or the file is a whole document. Never publish it.
        throw new MissingTemplateFolderError(wanted, !!manifest);
    }
    return DEFAULT_TEMPLATES[file];
}

/**
 * A served file's address with its build hash (`/assets/css/site.css?v=...`), so a
 * changed stylesheet reaches browsers that keep CSS for a year. The bare address
 * when the manifest has no hash for it.
 */
export function versionedUrl(path: string, manifest: SiteManifest | null): string {
    const hash = manifest?.files[path.replace(/^\//, '')];
    return hash ? `${path}?v=${hash}` : path;
}

/**
 * The stylesheets a published page links: the install's list with Arc CMS's
 * main.css versioned by its build hash, and the site's own site.css
 * (src/custom/site/site.css) after it, versioned too, so a changed stylesheet
 * reaches browsers that keep CSS for a year. An install's stored list predates
 * site.css, so it is added rather than expected. Pure, for the tests.
 */
export function siteStylesheets(urls: string[], manifest: SiteManifest | null): string[] {
    const bare = (url: string) => url.split('?')[0];
    const list = urls.map((url) => (bare(url) === '/assets/css/main.css' ? versionedUrl('/assets/css/main.css', manifest) : url));
    const at = list.findIndex((url) => bare(url) === '/assets/css/site.css');
    if (at === -1) list.push(versionedUrl('/assets/css/site.css', manifest));
    else list[at] = versionedUrl('/assets/css/site.css', manifest);
    return list;
}

/** siteStylesheets with the live site's manifest: what publishing links (getSiteConfig().cssUrls in). */
export async function pageStylesheets(urls: string[]): Promise<string[]> {
    return siteStylesheets(urls, await getSiteManifest());
}

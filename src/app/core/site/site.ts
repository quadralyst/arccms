/**
 * The public website's files, as the browser app sees them (specs/own-website-spec.md,
 * docs/website/overview.html).
 *
 * The build assembles Arc CMS's defaults (public/_site/) and the app's own website
 * (src/custom/site/) into one served folder, /_site/, and lists what it holds in
 * /_site/site.json. That list, the header and the footer are bundled into the app
 * through `virtual:arc-site` (scripts/arc-site.mjs), so they are there on first
 * paint and are always the ones this build serves.
 */
import { manifest as builtManifest } from 'virtual:arc-site';

export type SiteFileFrom = 'core' | 'app';
export type TemplateFile = 'partials' | 'list' | 'detail';

/** What /_site/site.json says; mirrors buildManifest() in scripts/arc-site.mjs. */
export interface SiteManifest {
    version: number;
    /** Languages with a home page file: `default` for home.html, else the code. */
    home: Record<string, SiteFileFrom>;
    /** Each template folder's files, and where each comes from. */
    templates: Record<string, Partial<Record<TemplateFile, SiteFileFrom>>>;
    /** Each folder's layouts (`detail-{name}.html`) by name; missing on a site built before them. */
    layouts?: Record<string, Record<string, SiteFileFrom>>;
    /** Static pages by name. */
    pages: Record<string, SiteFileFrom>;
    /** Languages with a strings file. */
    strings: string[];
    /** A hash of every /_site file and the site stylesheet. */
    files: Record<string, string>;
}

/** The folder every public content type falls back to, file by file. */
export const DEFAULT_TEMPLATE_FOLDER = 'default';

let current: SiteManifest = builtManifest;

/** The manifest this build serves. */
export function siteManifest(): SiteManifest {
    return current;
}

/** For tests: a different manifest; no argument restores the built one. */
export function setSiteManifestForTesting(manifest?: SiteManifest): void {
    current = manifest ?? builtManifest;
}

/** The folder a content type renders with: its own when the site has it, else the default. */
export function templateFolderFor(folder: string | null | undefined): string {
    return folder && current.templates[folder] ? folder : DEFAULT_TEMPLATE_FOLDER;
}

/**
 * Where a template file is served. A folder without that file uses the default
 * folder's, so a folder holding only detail.html is complete.
 */
export function siteTemplateUrl(folder: string | null | undefined, file: TemplateFile): string {
    const chosen = templateFolderFor(folder);
    const from = current.templates[chosen]?.[file] ? chosen : DEFAULT_TEMPLATE_FOLDER;
    return `/_site/templates/${from}/${file}.html`;
}

/**
 * The layouts a content type's folder offers: other detail pages, written
 * `detail-{name}.html`, that an entry can choose instead of `detail.html`
 * (specs/site-sections-spec.md, SS8). None for most folders.
 */
export function siteLayouts(folder: string | null | undefined): string[] {
    return Object.keys(current.layouts?.[templateFolderFor(folder)] ?? {}).sort();
}

/** Where an entry's detail template is served: its layout when the folder has it, else the folder's detail.html. */
export function siteLayoutUrl(folder: string | null | undefined, layout: string | null | undefined): string {
    const chosen = templateFolderFor(folder);
    const name = (layout || '').trim();
    return name && current.layouts?.[chosen]?.[name]
        ? `/_site/templates/${chosen}/detail-${name}.html`
        : siteTemplateUrl(folder, 'detail');
}

/** A layout's name as the editor shows it: `wide-hero` is "Wide hero". */
export function layoutLabel(name: string): string {
    const words = name.replace(/[-_]+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/** Where a static page's source is served. */
export function sitePageUrl(name: string): string {
    return `/_site/pages/${name}.html`;
}

/** Where a language's strings are served, or null when the site has none for it. */
export function siteStringsUrl(lang: string): string | null {
    return lang && current.strings.includes(lang) ? `/_site/strings/${lang}.json` : null;
}

/** Whether the app supplies this static page itself (not Arc CMS's sample). */
export function appHasPage(name: string): boolean {
    return current.pages[name] === 'app';
}

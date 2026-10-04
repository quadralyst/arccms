/**
 * Whether the site files on this computer are the ones the live site serves
 * (specs/own-website-spec.md, section 8).
 *
 * Publishing reads templates, the header, the footer and the home page from the
 * live site's /_site/, not from this computer. While the admin runs in
 * `npm run dev`, a file changed here and not yet deployed would be published in
 * its old form without a word, so the admin compares the two manifests' file
 * hashes and says so beside Publish. The dev server fetches the live manifest
 * (scripts/vite-arc-site.ts); a built admin is the live site, so it never checks.
 */
import { Injectable, isDevMode } from '@angular/core';
import { arcConfig, type ResolvedArcConfig } from '../config/arc-config';
import { environment } from '../../../environments/environment';
import { siteManifest } from './site';

/** Where the dev server serves the live manifest (LIVE_MANIFEST_PATH in scripts/vite-arc-site.ts). */
export const LIVE_MANIFEST_PATH = '/__arc/live-site.json';

/** The live site's manifest path, listed when the live site has no site files at all. */
export const NO_LIVE_SITE_FILES = '_site/site.json';

/** The install's Hosting site: its own, else the project's default one; null when it has no website. */
export function liveSiteName(
    config: Pick<ResolvedArcConfig, 'hostingSite'> = arcConfig,
    projectId: string | undefined = environment.firebaseConfig?.projectId,
): string | null {
    if (config.hostingSite === 'none') return null;
    return config.hostingSite || projectId || null;
}

/** The served paths whose local and live copies differ, or exist on one side only. */
export function siteFileDrift(local: Record<string, string>, live: Record<string, string>): string[] {
    const paths = new Set([...Object.keys(local), ...Object.keys(live)]);
    return [...paths].filter((path) => local[path] !== live[path]).sort();
}

@Injectable({ providedIn: 'root' })
export class SiteDriftService {
    private pending: Promise<string[]> | null = null;

    /**
     * The site files that differ from the live site; empty when they match, when
     * this is not `npm run dev`, or when the live site cannot be reached. Asked
     * once per page load.
     */
    differences(): Promise<string[]> {
        this.pending ??= this.compare();
        return this.pending;
    }

    private async compare(): Promise<string[]> {
        const site = liveSiteName();
        if (!isDevMode() || !site || typeof fetch !== 'function') return [];
        try {
            const res = await fetch(`${LIVE_MANIFEST_PATH}?site=${encodeURIComponent(site)}`);
            if (res.status === 404) return [NO_LIVE_SITE_FILES];
            if (!res.ok) return [];
            const live = await res.json();
            return siteFileDrift(siteManifest().files ?? {}, live?.files ?? {});
        } catch {
            return [];
        }
    }
}

/**
 * The site manifest as Arc CMS ships it, for core specs.
 *
 * The built manifest (`virtual:arc-site`, scripts/arc-site.mjs) is Arc CMS's
 * defaults in public/ with the app's website in src/custom/site/ laid over them,
 * so in an app it lists the app's strings, templates, layouts and pages too. A core
 * spec that reads it passes in Arc CMS and fails in an app: a strings file for the
 * default language, say, makes the page load it (specs/form-gamification-spec.md,
 * G-D4). Core specs start from this manifest instead and add what each test needs:
 *
 *   setSiteManifestForTesting({ ...coreSiteManifest(), strings: ['hi'] });
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildManifest, CORE_PUBLIC, VERSIONED } from '../../scripts/arc-site.mjs';
import type { SiteManifest } from '../app/core/site/site';

const PUBLIC = resolve(__dirname, '../..', CORE_PUBLIC);

/** Every file under `{PUBLIC}/{dir}`, as `/`-separated served paths. */
function served(dir: string): string[] {
    return readdirSync(join(PUBLIC, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return served(path);
        return entry.isFile() ? [path] : [];
    });
}

let core: SiteManifest | undefined;

/** What /_site/site.json holds for Arc CMS alone, with no app website. */
export function coreSiteManifest(): SiteManifest {
    if (!core) {
        const paths = [...served('_site'), ...VERSIONED.filter((path: string) => existsSync(join(PUBLIC, path)))];
        core = buildManifest(new Map(paths.map((path) => [path, { from: 'core', file: join(PUBLIC, path) }]))) as SiteManifest;
    }
    return structuredClone(core);
}

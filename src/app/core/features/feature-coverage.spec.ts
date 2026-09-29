/**
 * Keeps the features complete (docs/feature-flags-spec.md, section 8): every page
 * URL belongs to exactly one feature or to core, so a new page cannot ship
 * outside the system. The menu, the settings tabs and the Cloud Functions have
 * their own checks beside their code (side-navbar, settings page, functions).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Route } from '@angular/router';
import { routes } from '../../app.routes';
import { CORE_URLS, FEATURE_PARAM_ROUTES, FEATURE_URLS, featureOfPath, isCorePath } from './feature-routes';
import { FEATURE_IDS } from './feature-registry';

const PAGES = resolve(__dirname, '../../pages');

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
    });
}

/** The URL the file router gives each page file (a default export makes it a page). */
function fileRouteUrls(): string[] {
    return files(PAGES)
        .filter((f) => f.endsWith('.page.ts') && !f.endsWith('.spec.ts') && /export default/.test(readFileSync(f, 'utf8')))
        .map((f) => relative(PAGES, f)
            .replace(/\.page\.ts$/, '')
            .replace(/\([^)]*\)\//g, '')
            .replace(/(^|\/)index$/, '')
            .replace(/\[\.\.\.[^\]]*\]/g, '**')
            .replace(/\[([^\]]*)\]/g, ':$1')
            .replace(/\./g, '/'));
}

/** The URL of every explicit route with a page, children joined to their parents. */
function explicitRouteUrls(list: Route[], prefix = ''): string[] {
    return list.flatMap((route) => {
        if (route.matcher) return [];
        const url = [prefix, route.path].filter(Boolean).join('/');
        return route.children ? explicitRouteUrls(route.children, url) : [url];
    });
}

const owners = (url: string) => {
    const path = url.split('/').filter(Boolean);
    return [
        ...(featureOfPath(path) ? [`feature ${featureOfPath(path)}`] : []),
        ...(url in FEATURE_PARAM_ROUTES ? [`feature ${FEATURE_PARAM_ROUTES[url]}`] : []),
        ...(isCorePath(path) ? ['core'] : []),
    ];
};

describe('feature coverage', () => {
    const urls = [...new Set([...fileRouteUrls(), ...explicitRouteUrls(routes)])].sort();

    it('finds the pages to check', () => {
        expect(urls.length).toBeGreaterThan(80);
        expect(urls).toContain('admin/email/broadcasts');
        expect(urls).toContain('admin/broadcasts');
    });

    it('gives every page URL exactly one owner, a feature or core', () => {
        const problems = urls
            .map((url) => ({ url, owners: owners(url) }))
            .filter(({ owners }) => owners.length !== 1)
            .map(({ url, owners }) => `/${url}: ${owners.length ? owners.join(' and ') : 'no owner. Add it to FEATURE_URLS or CORE_URLS in feature-routes.ts'}`);
        expect(problems).toEqual([]);
    });

    it('lists only URLs that exist, so the lists do not rot', () => {
        const unused = [
            ...Object.values(FEATURE_URLS).flat(),
            ...CORE_URLS,
            ...Object.keys(FEATURE_PARAM_ROUTES),
        ].filter((pattern) => !urls.some((url) => {
            if (pattern === url) return true;
            if (!pattern.endsWith('/**')) return false;
            const base = pattern.slice(0, -3);
            return url === base || url.startsWith(`${base}/`);
        }));
        expect(unused).toEqual([]);
    });

    it('names only real features', () => {
        for (const id of Object.values(FEATURE_PARAM_ROUTES)) expect(FEATURE_IDS).toContain(id);
    });
});

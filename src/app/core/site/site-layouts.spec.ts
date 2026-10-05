/**
 * Layouts (specs/site-sections-spec.md, SS8): other detail pages in a template
 * folder, written detail-{name}.html, that one entry can choose.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { layoutLabel, setSiteManifestForTesting, siteLayoutUrl, siteLayouts, siteManifest, type SiteManifest } from './site';

function withSite(extra: Partial<SiteManifest>): void {
    const built = siteManifest();
    setSiteManifestForTesting({ ...built, ...extra, templates: { ...built.templates, ...extra.templates } });
}

describe('site layouts', () => {
    afterEach(() => setSiteManifestForTesting());

    it('lists a folder\'s layouts by name, and none for a folder without', () => {
        withSite({ templates: { pages: { detail: 'app' } }, layouts: { pages: { team: 'app', contact: 'core' } } });
        expect(siteLayouts('pages')).toEqual(['contact', 'team']);
        expect(siteLayouts('articles')).toEqual([]);
    });

    it('reads a manifest from before layouts as having none', () => {
        withSite({ templates: { pages: { detail: 'app' } }, layouts: undefined });
        expect(siteLayouts('pages')).toEqual([]);
        expect(siteLayoutUrl('pages', 'contact')).toBe('/_site/templates/pages/detail.html');
    });

    it('serves the layout the entry chose, else the folder\'s detail.html', () => {
        withSite({ templates: { pages: { detail: 'app' } }, layouts: { pages: { contact: 'core' } } });
        expect(siteLayoutUrl('pages', 'contact')).toBe('/_site/templates/pages/detail-contact.html');
        expect(siteLayoutUrl('pages', '')).toBe('/_site/templates/pages/detail.html');
        expect(siteLayoutUrl('pages', undefined)).toBe('/_site/templates/pages/detail.html');
        expect(siteLayoutUrl('pages', 'gone')).toBe('/_site/templates/pages/detail.html');
        // A folder the site does not have: the default's detail, never a layout.
        expect(siteLayoutUrl('nowhere', 'contact')).toBe('/_site/templates/default/detail.html');
    });

    it('names a layout for the editor', () => {
        expect(layoutLabel('contact')).toBe('Contact');
        expect(layoutLabel('wide-hero')).toBe('Wide hero');
        expect(layoutLabel('team_grid')).toBe('Team grid');
    });

    it('ships the Contact layout for the standard pages', () => {
        expect(siteManifest().layouts?.['info']?.['contact']).toBe('core');
    });
});

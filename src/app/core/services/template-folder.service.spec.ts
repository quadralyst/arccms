/**
 * The template folders a content type can pick come from the site's manifest
 * (/_site/site.json, bundled through virtual:arc-site): the default first, then
 * core's and the app's folders, with nothing to fetch or register.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { TemplateFolderService } from './template-folder.service';
import { SiteManifest, setSiteManifestForTesting, siteManifest } from '../site/site';

const MANIFEST: SiteManifest = {
    version: 1,
    home: {},
    templates: {
        default: { partials: 'core', list: 'core', detail: 'core' },
        articles: { partials: 'core', list: 'core', detail: 'core' },
        'case-studies': { detail: 'app' },
    },
    pages: {},
    strings: [],
    files: {},
};

describe('TemplateFolderService', () => {
    let service: TemplateFolderService;

    beforeEach(() => {
        setSiteManifestForTesting(MANIFEST);
        service = TestBed.inject(TemplateFolderService);
    });

    afterEach(() => setSiteManifestForTesting());

    it('lists the default first, then every folder of the site, sorted', () => {
        expect(service.folders().map((f) => f.name)).toEqual(['default', 'articles', 'case-studies']);
    });

    it('says which folders are the app\'s own', () => {
        const byName = Object.fromEntries(service.folders().map((f) => [f.name, f.from]));
        expect(byName).toEqual({ default: 'core', articles: 'core', 'case-studies': 'app' });
    });

    it('formats display names', () => {
        expect(service.folders().find((f) => f.name === 'case-studies')!.displayName).toBe('Case Studies');
        expect(service.folders().find((f) => f.name === 'articles')!.displayName).toBe('Articles');
    });

    it('marks every listed folder valid', () => {
        expect(service.folders().every((f) => f.isValid)).toBe(true);
    });

    it('loads the folders for the pickers and keeps them in the signal', async () => {
        const folders = await firstValueFrom(service.loadAndValidateTemplates());
        expect(folders.map((f) => f.name)).toEqual(['default', 'articles', 'case-studies']);
        expect(service.templateFolders()).toEqual(folders);
    });

    it('knows whether the site has a folder', () => {
        expect(service.hasFolder('articles')).toBe(true);
        expect(service.hasFolder('recipes')).toBe(false);
        expect(service.hasFolder('')).toBe(false);
    });

    it('reads the manifest this build serves, with Arc CMS\'s shipped folders in it', () => {
        setSiteManifestForTesting();
        expect(Object.keys(siteManifest().templates)).toEqual(expect.arrayContaining(['default', 'articles', 'manuals']));
        expect(siteManifest().templates['default']).toEqual({ detail: 'core', list: 'core', partials: 'core' });
    });
});

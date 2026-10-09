/**
 * The site's name and logo wherever Arc CMS shows them (specs/admin-brand-spec.md AB-D7):
 * Settings, About, then the app's default, then Arc CMS's only when neither has a name or a logo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ARC_CMS_LOGO, ARC_CMS_NAME, APP_BRAND, SiteBrandService, siteBrand } from './site-brand';
import { SiteIdentityService } from '../services/site-identity.service';
import { SIGN_IN_IMAGE } from './app-brand-files';

const NO_APP = { name: '', logo: '' };
const APP = { name: 'Acme Studio', logo: '/src/custom/logo.svg' };

describe('siteBrand', () => {
    it('uses the site\'s name and logo from Settings, About', () => {
        expect(siteBrand({ name: 'Deepakam', logoUrl: 'https://x.test/logo.svg' }, APP))
            .toEqual({ name: 'Deepakam', logo: 'https://x.test/logo.svg', arc: false });
    });

    it('shows the site\'s name, not Arc CMS\'s logo, when the site has no logo', () => {
        expect(siteBrand({ name: 'Deepakam', logoUrl: '' }, NO_APP)).toEqual({ name: 'Deepakam', logo: '', arc: false });
    });

    it('takes the app\'s name and logo, field by field, where About has none', () => {
        expect(siteBrand({ name: '', logoUrl: '' }, APP)).toEqual({ name: 'Acme Studio', logo: '/src/custom/logo.svg', arc: false });
        expect(siteBrand({ name: 'Deepakam', logoUrl: '' }, APP)).toEqual({ name: 'Deepakam', logo: '/src/custom/logo.svg', arc: false });
        expect(siteBrand({ name: '', logoUrl: 'https://x.test/l.png' }, APP)).toEqual({ name: 'Acme Studio', logo: 'https://x.test/l.png', arc: false });
    });

    it('shows a logo with no name when only a logo is set, never Arc CMS\'s name beside it', () => {
        expect(siteBrand({ logoUrl: 'https://x.test/l.png' }, NO_APP)).toEqual({ name: '', logo: 'https://x.test/l.png', arc: false });
    });

    it('falls back to Arc CMS\'s name and logo only when nothing names the site', () => {
        expect(siteBrand({ name: '  ', logoUrl: '' }, NO_APP)).toEqual({ name: ARC_CMS_NAME, logo: ARC_CMS_LOGO, arc: true });
    });

    it('sees Arc CMS as shipped in a core spec: no app name, logo or sign-in image', () => {
        expect(APP_BRAND).toEqual({ name: '', logo: '' });
        expect(SIGN_IN_IMAGE).toBe('');
    });
});

describe('SiteBrandService', () => {
    function setup(identity: { name?: string; logoUrl?: string }, loaded: boolean) {
        TestBed.configureTestingModule({
            providers: [{
                provide: SiteIdentityService,
                useValue: { identity: signal(identity), loaded: signal(loaded), load: () => Promise.resolve(identity) },
            }],
        });
        return TestBed.inject(SiteBrandService);
    }

    it('gives nothing until Settings, About has loaded, so Arc CMS\'s name never flashes', () => {
        const brand = setup({ name: 'Deepakam' }, false);
        expect(brand.brand()).toBeNull();
        expect(brand.name()).toBe('');
    });

    it('gives the site\'s brand once loaded', () => {
        expect(setup({ name: 'Deepakam' }, true).name()).toBe('Deepakam');
    });
});

describe('the app\'s brand files', () => {
    const source = readFileSync(resolve(__dirname, 'app-brand-files.ts'), 'utf8');

    it('finds the logo and the sign-in image in the custom space, with no declaration', () => {
        expect(source).toContain("'../../../custom/logo.{svg,png,webp}'");
        expect(source).toContain("'../../../custom/sign-in-image.{webp,jpg,jpeg,png,svg}'");
    });
});

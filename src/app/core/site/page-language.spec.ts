/**
 * Site pages the app draws hold `<html lang>` and `dir` in the content's language, not
 * the member's (RF6 review), and hand them back when they go.
 */
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { translocoTestingModule } from '../../../test/transloco-test-providers';
import { LocalizationService } from '../services/localization.service';
import { PageLanguageHold, siteLanguageDir, usePageLanguage } from './page-language';

const tick = () => new Promise((r) => setTimeout(r, 0));
const root = document.documentElement;

const content = signal('');
@Component({ selector: 'arc-test-site-page', template: '' })
class SitePage {
    constructor() { usePageLanguage(() => content()); }
}

describe('page language', () => {
    afterEach(() => {
        root.lang = 'en';
        root.dir = 'ltr';
        content.set('');
    });

    it('takes a site language\'s direction from its settings', () => {
        expect(siteLanguageDir('ar', [{ code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true }])).toBe('rtl');
        expect(siteLanguageDir('hi', [{ code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' }])).toBe('ltr');
    });

    it('puts its language back when the app\'s language service writes its own, until released', async () => {
        const hold = new PageLanguageHold(document, () => 'en');
        hold.hold('ar', 'rtl');
        root.lang = 'en';
        root.dir = 'ltr';
        await tick();
        expect([root.lang, root.dir]).toEqual(['ar', 'rtl']);
        hold.release();
        expect([root.lang, root.dir]).toEqual(['en', 'ltr']);
        root.lang = 'fr';
        await tick();
        expect(root.lang).toBe('fr');
    });

    it('follows the content\'s language on an in-app content page, the default one without a prefix', async () => {
        TestBed.configureTestingModule({
            imports: [translocoTestingModule({ lang: 'en' })],
            providers: [{
                provide: LocalizationService,
                useValue: {
                    load: async () => ({}),
                    defaultLanguage: signal('hi'),
                    enabledLanguages: signal([{ code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' }, { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true }]),
                },
            }],
        });
        const fixture = TestBed.createComponent(SitePage);
        fixture.detectChanges();
        await tick();
        expect([root.lang, root.dir]).toEqual(['hi', 'ltr']);

        content.set('ar');
        fixture.detectChanges();
        await tick();
        expect([root.lang, root.dir]).toEqual(['ar', 'rtl']);

        fixture.destroy();
        expect([root.lang, root.dir]).toEqual(['en', 'ltr']);
    });
});

/**
 * Member languages with a fake one, zz, declared (specs/app-member-language-spec.md, A1a).
 * Arc CMS ships no real member translations, so the mechanism is tested this way (L-D11).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';

vi.mock('../../../custom/languages', () => ({
    MEMBER_LANGUAGES: [{ code: 'zz', label: 'Zed', locale: 'en-GB', localeData: async () => ({ default: ['en-GB-test'] }) }],
}));

import { AuthState } from '../../pages/(auth)/auth.store';
import { ADMIN_LANGUAGES, isAdminLanguage } from './admin-languages';
import { AdminLanguageService } from './admin-language.service';
import { LanguageAreaService, MEMBER_LANGUAGES_DECLARED, MEMBER_LANGUAGE_LIST, MemberLanguageService, setMemberLanguage } from './member-language.service';
import { MEMBER_LANGUAGE_CACHE_KEY } from './member-languages';
import { startupLocale } from './admin-locale.provider';
import { AdminTranslationLoader, MEMBER_TRANSLATION_SOURCES, customTranslationFiles } from './translation.loader';

@Component({ template: '' })
class Page {}

const transloco = { setActiveLang: vi.fn(), getActiveLang: vi.fn(() => 'en') };
const browserLanguages = (langs: string[]) => vi.spyOn(navigator, 'languages', 'get').mockReturnValue(langs);

function setup() {
    TestBed.configureTestingModule({
        providers: [
            provideRouter([{ path: '', component: Page }, { path: 'user', component: Page }, { path: 'admin/users', component: Page }]),
            { provide: PLATFORM_ID, useValue: 'browser' },
            { provide: TranslocoService, useValue: transloco },
            { provide: AuthState, useValue: { currentUser: signal(null), updateUserProfile: vi.fn() } },
        ],
    });
}

beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    localStorage.clear();
    history.replaceState({}, '', '/');
    browserLanguages(['en-US']);
});

describe('the declared languages', () => {
    it('are English plus the app\'s, and never reach the admin', () => {
        expect(MEMBER_LANGUAGES_DECLARED).toBe(true);
        expect(MEMBER_LANGUAGE_LIST.map((l) => l.code)).toEqual(['en', 'zz']);
        expect(ADMIN_LANGUAGES.map((l) => l.code)).toEqual(['en', 'hi']);
        expect(isAdminLanguage('zz')).toBe(false);
        setup();
        expect(TestBed.inject(AdminLanguageService).languages.map((l) => l.code)).not.toContain('zz');
    });
});

describe('MemberLanguageService', () => {
    it('starts in the browser\'s language when the app has it, else English', () => {
        browserLanguages(['zz-QQ', 'en']);
        setup();
        expect(TestBed.inject(MemberLanguageService).activeLang()).toBe('zz');
    });

    it('keeps a choice made on this device, even before sign-in', () => {
        browserLanguages(['zz']);
        localStorage.setItem(MEMBER_LANGUAGE_CACHE_KEY, 'en');
        setup();
        expect(TestBed.inject(MemberLanguageService).activeLang()).toBe('en');
    });

    it('switches with use() or setMemberLanguage(), remembers it, and ignores a language the app lacks', () => {
        setup();
        const member = TestBed.inject(MemberLanguageService);
        setMemberLanguage('zz');
        expect(member.activeLang()).toBe('zz');
        expect(member.activeLocale()).toBe('en-GB');
        expect(localStorage.getItem(MEMBER_LANGUAGE_CACHE_KEY)).toBe('zz');
        member.use('fr');
        expect(member.activeLang()).toBe('zz');
    });
});

describe('LanguageAreaService', () => {
    it('shows the member language outside /admin and the admin language inside it', async () => {
        localStorage.setItem(MEMBER_LANGUAGE_CACHE_KEY, 'zz');
        localStorage.setItem('arc-admin-lang', 'hi');
        setup();
        const router = TestBed.inject(Router);
        TestBed.inject(LanguageAreaService);
        await router.navigateByUrl('/user');
        TestBed.tick();
        expect(transloco.setActiveLang).toHaveBeenLastCalledWith('zz');

        await router.navigateByUrl('/admin/users');
        TestBed.tick();
        expect(transloco.setActiveLang).toHaveBeenLastCalledWith('hi');

        await router.navigateByUrl('/');
        TestBed.tick();
        expect(transloco.setActiveLang).toHaveBeenLastCalledWith('zz');
    });
});

describe('dates and numbers (L-D7)', () => {
    it('follow the member language outside /admin, and the admin\'s inside it', () => {
        localStorage.setItem(MEMBER_LANGUAGE_CACHE_KEY, 'zz');
        localStorage.setItem('arc-admin-lang', 'hi');
        history.replaceState({}, '', '/user');
        expect(startupLocale()).toBe('en-GB');
        history.replaceState({}, '', '/admin/users');
        expect(startupLocale()).toBe('hi');
    });
});

describe('the loader', () => {
    it('finds the app\'s files by name, so a new language needs no core edit', () => {
        const files = customTranslationFiles({ '../../../custom/i18n/en.json': async () => ({ default: {} }), '/x/custom/i18n/zz.json': async () => ({ default: {} }) });
        expect(Object.keys(files).sort()).toEqual(['en', 'zz']);
    });

    it('loads only the app\'s file for its own language, and merges the app\'s English over core', async () => {
        TestBed.configureTestingModule({
            providers: [{
                provide: MEMBER_TRANSLATION_SOURCES,
                useValue: {
                    zz: async () => ({ default: { user: { nav: { home: 'Zome' } } } }),
                    en: async () => ({ default: { user: { nav: { home: 'Start here' } } } }),
                },
            }],
        });
        const loader = TestBed.inject(AdminTranslationLoader);
        expect(await loader.getTranslation('zz')).toEqual({ user: { nav: { home: 'Zome' } } });
        const english = await loader.getTranslation('en') as { user: { nav: { home: string } }; common: unknown };
        expect(english.user.nav.home).toBe('Start here');
        expect(english.common).toBeDefined();
    });
});

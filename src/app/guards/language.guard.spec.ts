/**
 * Tests for the language-prefix route guard.
 *
 * The guard's whole job is to stop a `:lang/:contentTypeSlug/:urlSlug` route
 * from swallowing unrelated three-segment URLs, so the cases that must NOT
 * match matter more than the ones that must. Every address passes through it on
 * its way to the app's pages, so it must also never make them wait for the
 * server when it does not have to (F18).
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, Routes, UrlSegment, provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { claimedFirstSegments, languageRedirect, languageRedirectGuard, languageRouteGuard } from './language.guard';
import { LocalizationService } from '../core/services/localization.service';
import { ILocalizationSettings } from '../../shared/models/localization.model';

const EN_HI: ILocalizationSettings = {
    defaultLanguage: 'en',
    enabledLanguages: [
        { code: 'en', label: 'English', nativeLabel: 'English' },
        { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
    ],
};

const SINGLE: ILocalizationSettings = {
    defaultLanguage: 'en',
    enabledLanguages: [{ code: 'en', label: 'English', nativeLabel: 'English' }],
};

@Component({ template: '' })
class Page {}

/** The shape of app.routes.ts around the language routes, with an app's routes after them. */
const ROUTES: Routes = [
    { path: 'signup', component: Page },
    { path: 'pricing', component: Page },
    { path: ':lang', pathMatch: 'full', canMatch: [languageRouteGuard], component: Page, data: { at: 'language home' } },
    { path: ':lang/:contentTypeSlug', canMatch: [languageRouteGuard], component: Page, data: { at: 'language content' } },
    languageRedirect,
    // The app's routes: `pay` fits the language code pattern.
    { path: 'pay', component: Page, data: { at: 'pay' } },
    { path: 'pay/start', component: Page, data: { at: 'pay start' } },
    // A (group) folder of file-based pages.
    { path: '', children: [{ path: 'faq', component: Page, data: { at: 'faq' } }] },
    { path: '**', component: Page, data: { at: 'not found' } },
];

/** A Firestore read that never answers, as on a slow or unreachable network. */
const never = () => new Promise<ILocalizationSettings>(() => {});

let load: ReturnType<typeof vi.fn>;
let known: ReturnType<typeof vi.fn>;
let loaded: ReturnType<typeof vi.fn>;

function setUp(): void {
    load = vi.fn(never);
    known = vi.fn(() => null);
    loaded = vi.fn(() => false);
    TestBed.configureTestingModule({
        providers: [
            provideRouter(ROUTES),
            { provide: LocalizationService, useValue: { load, known, loaded } },
        ],
    });
}

function segments(...paths: string[]): UrlSegment[] {
    return paths.map(path => new UrlSegment(path, {}));
}

/** Runs the guard in an injection context, as the router does. */
function runGuard(...paths: string[]): boolean | Promise<boolean> {
    return TestBed.runInInjectionContext(() => languageRouteGuard({}, segments(...paths)));
}

/** Where the router lands for an address. */
async function open(url: string): Promise<string> {
    await TestBed.inject(Router).navigateByUrl(url);
    return where();
}

function where(): string {
    const router = TestBed.inject(Router);
    let route = router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    return route.data['at'] ?? router.url;
}

describe('languageRouteGuard', () => {
    beforeEach(setUp);

    describe('what it decides', () => {
        beforeEach(() => load.mockResolvedValue(EN_HI));

        it('matches an enabled non-default language', async () => {
            await expect(runGuard('hi', 'articles', 'my-post')).resolves.toBe(true);
            await expect(runGuard('hi', 'articles')).resolves.toBe(true);
        });

        it('does not match the default language', async () => {
            // The default language keeps the unprefixed URLs; /en/articles would
            // quietly duplicate every page under a second address.
            await expect(runGuard('en', 'articles', 'my-post')).resolves.toBe(false);
        });

        it('does not match a language that is not enabled', async () => {
            await expect(runGuard('fr', 'articles', 'my-post')).resolves.toBe(false);
        });

        it('does not swallow admin URLs of the same shape', () => {
            // The regression this guard exists to prevent.
            expect(runGuard('admin', 'settings', 'localization')).toBe(false);
            expect(runGuard('admin', 'contents')).toBe(false);
        });

        it('does not swallow other top-level routes', () => {
            for (const path of ['pricing', 'checkout', 'user', 'p', 'waitlist', 'pay', 'faq']) {
                expect(runGuard(path, 'anything', 'else')).toBe(false);
            }
        });

        it('matches nothing on a single-language site', async () => {
            load.mockResolvedValue(SINGLE);
            await expect(runGuard('hi', 'articles', 'my-post')).resolves.toBe(false);
            await expect(runGuard('en', 'articles', 'my-post')).resolves.toBe(false);
        });

        it('does not match an empty path', () => {
            expect(runGuard()).toBe(false);
        });
    });

    describe('never waiting when it does not have to', () => {
        it('answers at once, with no read, for a first segment that cannot be a language', () => {
            for (const path of ['signup', 'account', 'admin']) expect(runGuard(path)).toBe(false);
            expect(load).not.toHaveBeenCalled();
            expect(known).not.toHaveBeenCalled();
        });

        it("answers at once, with no read, for an app route's first segment", () => {
            expect(runGuard('pay')).toBe(false);
            expect(runGuard('pay', 'start')).toBe(false);
            // Inside a (group) folder of file-based pages.
            expect(runGuard('faq')).toBe(false);
            expect(load).not.toHaveBeenCalled();
        });

        it('answers a later visit from the list this browser kept, and reads it again in the background', () => {
            known.mockReturnValue(EN_HI);
            expect(runGuard('hi', 'articles')).toBe(true);
            expect(runGuard('fr', 'articles')).toBe(false);
            expect(runGuard('en')).toBe(false);
            // One background read, however many routes asked.
            expect(load).toHaveBeenCalledTimes(1);
        });

        it('answers at once on a single-language site once the list is known', () => {
            known.mockReturnValue(SINGLE);
            loaded.mockReturnValue(true);
            expect(runGuard('de')).toBe(false);
            expect(load).not.toHaveBeenCalled();
        });

        it('waits for the server only on a first visit, for a segment that could be a language', async () => {
            load.mockResolvedValue(EN_HI);
            const answer = runGuard('hi');
            expect(answer).toBeInstanceOf(Promise);
            await expect(answer).resolves.toBe(true);
        });
    });

    describe('with the router', () => {
        it('opens app pages and sign-up while Firestore never answers, on a first visit', async () => {
            expect(await open('/pay')).toBe('pay');
            expect(await open('/pay/start')).toBe('pay start');
            expect(await open('/signup')).toBe('/signup');
            expect(await open('/faq')).toBe('faq');
            expect(load).not.toHaveBeenCalled();
        });

        it('opens language pages from the kept list while Firestore never answers', async () => {
            known.mockReturnValue(EN_HI);
            expect(await open('/hi')).toBe('language home');
            expect(await open('/hi/articles')).toBe('language content');
            expect(await open('/hi/pay/start')).toBe('pay start');
            expect(await open('/fr')).toBe('not found');
        });

        it('opens the page again when the fresh list changes the answer', async () => {
            let fresh = false;
            let answer!: (settings: ILocalizationSettings) => void;
            known.mockImplementation(() => (fresh ? SINGLE : EN_HI));
            loaded.mockImplementation(() => fresh);
            load.mockImplementation(() => new Promise<ILocalizationSettings>((resolve) => { answer = resolve; }));

            expect(await open('/hi')).toBe('language home');

            // An admin removed Hindi since this browser last looked.
            fresh = true;
            answer(SINGLE);
            await vi.waitFor(() => expect(where()).toBe('not found'));
            expect(TestBed.inject(Router).url).toBe('/hi');
        });

        it('leaves the page alone when the fresh list agrees', async () => {
            let answer!: (settings: ILocalizationSettings) => void;
            known.mockReturnValue(EN_HI);
            load.mockImplementation(() => new Promise<ILocalizationSettings>((resolve) => { answer = resolve; }));
            expect(await open('/hi')).toBe('language home');

            const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
            loaded.mockReturnValue(true);
            answer(EN_HI);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(navigate).not.toHaveBeenCalled();
        });
    });
});

describe('claimedFirstSegments', () => {
    it('lists the literal first segments, inside empty-path groups too', () => {
        expect([...claimedFirstSegments(ROUTES)].sort()).toEqual(['faq', 'pay', 'pricing', 'signup']);
    });

    it('leaves out parameters, the wildcard and routes that match by function', () => {
        const claimed = claimedFirstSegments([
            { path: ':lang' }, { path: '**' }, { matcher: () => null }, { path: 'de/impressum' },
        ]);
        expect([...claimed]).toEqual(['de']);
    });
});

describe('languageRedirect', () => {
    beforeEach(() => {
        setUp();
        load.mockResolvedValue(EN_HI);
    });

    it('takes any address of two segments or more', () => {
        const matcher = languageRedirect.matcher!;
        expect(matcher(segments('hi', 'signup'), {} as never, {} as never)).toEqual({ consumed: segments('hi', 'signup') });
        expect(matcher(segments('hi', 'learn', 'lesson-1'), {} as never, {} as never)).toBeTruthy();
        expect(matcher(segments('hi'), {} as never, {} as never)).toBeNull();
    });

    it('sends an address under a language to the same address without it', async () => {
        const guard = (...paths: string[]) => TestBed.runInInjectionContext(() => languageRedirectGuard({}, segments(...paths)));
        expect(String(await guard('hi', 'signup'))).toBe('/signup');
        expect(String(await guard('hi', 'learn', 'lesson-1'))).toBe('/learn/lesson-1');
    });

    it('lets the next route try when the first segment is not a language', async () => {
        const result = await TestBed.runInInjectionContext(() => languageRedirectGuard({}, segments('admin', 'settings')));
        expect(result).toBe(false);
    });
});

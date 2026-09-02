/**
 * Tests for the language-prefix route guard.
 *
 * The guard's whole job is to stop a `:lang/:contentTypeSlug/:urlSlug` route
 * from swallowing unrelated three-segment URLs, so the cases that must NOT
 * match matter more than the ones that must.
 */
import { TestBed } from '@angular/core/testing';
import { UrlSegment } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { languageRouteGuard } from './language.guard';
import { LocalizationService } from '../core/services/localization.service';

const EN_HI = {
    defaultLanguage: 'en',
    enabledLanguages: [
        { code: 'en', label: 'English', nativeLabel: 'English' },
        { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
    ],
};

const SINGLE = {
    defaultLanguage: 'en',
    enabledLanguages: [{ code: 'en', label: 'English', nativeLabel: 'English' }],
};

function segments(...paths: string[]): UrlSegment[] {
    return paths.map(path => new UrlSegment(path, {}));
}

/** Runs the guard in an injection context, as the router does. */
function runGuard(...paths: string[]): Promise<boolean> {
    return TestBed.runInInjectionContext(
        () => languageRouteGuard({} as never, segments(...paths)),
    ) as Promise<boolean>;
}

describe('languageRouteGuard', () => {
    let load: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        load = vi.fn().mockResolvedValue(EN_HI);
        TestBed.configureTestingModule({
            providers: [{ provide: LocalizationService, useValue: { load } }],
        });
    });

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

    it('does not swallow admin URLs of the same shape', async () => {
        // The regression this guard exists to prevent.
        await expect(runGuard('admin', 'settings', 'localization')).resolves.toBe(false);
        await expect(runGuard('admin', 'contents')).resolves.toBe(false);
    });

    it('does not swallow other top-level routes', async () => {
        for (const path of ['pricing', 'checkout', 'user', 'p', 'waitlist']) {
            await expect(runGuard(path, 'anything', 'else')).resolves.toBe(false);
        }
    });

    it('matches nothing on a single-language site', async () => {
        load.mockResolvedValue(SINGLE);
        await expect(runGuard('hi', 'articles', 'my-post')).resolves.toBe(false);
        await expect(runGuard('en', 'articles', 'my-post')).resolves.toBe(false);
    });

    it('does not match an empty path', async () => {
        await expect(runGuard()).resolves.toBe(false);
    });
});

/**
 * Static UI strings for the SPA.
 *
 * The counterpart of `getUiStrings` in functions/src/shared/site-settings.ts:
 * both read the site's `/_site/strings/{lang}.json` (src/custom/site/strings/
 * merged over Arc CMS's public/_site/strings/), so a page rendered client-side
 * shows the same chrome as the statically published one.
 *
 * The default language has no file — its text is the English authored into the
 * templates and component markup, which is also the fallback for missing keys.
 *
 * Spec: specs/multilingual-spec.md — Phase M5.1.
 */

import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { siteStringsUrl } from '../site/site';

@Injectable({ providedIn: 'root' })
export class UiStringsService {
    private http = inject(HttpClient);

    /** Strings for the active language; empty for the default language. */
    readonly strings = signal<Record<string, string>>({});

    /**
     * The language the page on screen is written in; empty for the default.
     *
     * Set here because `use()` is already the one call every page makes to
     * declare its language. Components without a `:lang` route param — the
     * home page and anything it embeds — have no other way to know.
     */
    readonly activeLang = signal<string>('');

    private loaded = new Map<string, Record<string, string>>();
    private inFlight = new Map<string, Promise<Record<string, string>>>();

    /**
     * Loads and activates the strings for a language. Passing an empty code
     * (the default language) clears them, restoring the authored English.
     */
    async use(lang: string): Promise<Record<string, string>> {
        this.activeLang.set(lang);

        if (!lang) {
            this.strings.set({});
            return {};
        }

        const cached = this.loaded.get(lang);
        if (cached) {
            this.strings.set(cached);
            return cached;
        }

        const pending = this.inFlight.get(lang) ?? this.fetch(lang);
        this.inFlight.set(lang, pending);
        const strings = await pending;
        this.inFlight.delete(lang);
        this.strings.set(strings);
        return strings;
    }

    /**
     * The strings for a language without making it the page's language, for a part
     * of the page shown in another one, such as the sign-in panel in the language a
     * member chose. Empty for the default language; cached like use().
     */
    async load(lang: string): Promise<Record<string, string>> {
        if (!lang) return {};
        const cached = this.loaded.get(lang);
        if (cached) return cached;
        const pending = this.inFlight.get(lang) ?? this.fetch(lang);
        this.inFlight.set(lang, pending);
        try {
            return await pending;
        } finally {
            this.inFlight.delete(lang);
        }
    }

    private async fetch(lang: string): Promise<Record<string, string>> {
        const url = siteStringsUrl(lang);
        if (!url) {
            // The site has no strings for this language: the authored English stands.
            this.loaded.set(lang, {});
            return {};
        }
        try {
            const strings = await firstValueFrom(this.http.get<Record<string, string>>(url));
            const safe = strings && typeof strings === 'object' ? strings : {};
            this.loaded.set(lang, safe);
            return safe;
        } catch {
            // No file, or a malformed one: the authored English stands. This is
            // the designed fallback, not an error worth surfacing.
            this.loaded.set(lang, {});
            return {};
        }
    }

    /** The translated text for a key, or the caller's English default. */
    translate(key: string, fallback: string): string {
        const value = this.strings()[key];
        return typeof value === 'string' && value.trim() ? value : fallback;
    }
}

/**
 * The admin's own UI language.
 *
 * Separate from `LocalizationService`, which answers "what languages does this
 * site publish in?". This one answers "what language does the person running
 * it read?" — a site publishing in Hindi may well be administered in English
 * (M-D11), so the two lists are independent and so is the choice.
 *
 * The preference lives on the user document, so it follows the admin between
 * machines. It is *also* mirrored to localStorage, because the user document
 * arrives well after the first paint: without the cache the admin would render
 * in English and visibly flip a moment later, every single load.
 *
 * Spec: docs/multilingual-spec.md — Phase M6.
 */

import { Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslocoService } from '@jsverse/transloco';
import { AuthState } from '../../pages/(auth)/auth.store';
import {
    ADMIN_LANGUAGES,
    ADMIN_LANGUAGE_CACHE_KEY,
    DEFAULT_ADMIN_LANGUAGE,
    cachedAdminLanguage,
    isAdminLanguage,
} from './admin-languages';

@Injectable({ providedIn: 'root' })
export class AdminLanguageService {
    private transloco = inject(TranslocoService);
    private authStore = inject(AuthState);
    private platformId = inject(PLATFORM_ID);

    /** The language the admin UI is currently rendering in. */
    readonly activeLang = signal<string>(DEFAULT_ADMIN_LANGUAGE);

    readonly languages = ADMIN_LANGUAGES;

    readonly activeLabel = computed(() =>
        ADMIN_LANGUAGES.find(language => language.code === this.activeLang())?.label ?? '',
    );

    /** True once the user document has been consulted. */
    private adopted = false;

    constructor() {
        this.apply(cachedAdminLanguage());

        // The user document arrives after sign-in resolves. Adopt its
        // preference once, and only if it disagrees with the cache — a later
        // in-session change is the picker's job, not this effect's.
        effect(() => {
            const stored = this.authStore.currentUser()?.preferredLanguage;
            if (this.adopted || !stored) return;
            this.adopted = true;
            if (isAdminLanguage(stored) && stored !== this.activeLang()) {
                this.apply(stored);
            }
        });
    }

    /**
     * Switches the admin UI, remembers the choice, and persists it to the user
     * document.
     *
     * The UI switches first and the write follows: a failed write must not
     * leave the admin looking at a language they did not choose, and the cache
     * already carries the choice to the next load.
     */
    async use(code: string): Promise<void> {
        if (!isAdminLanguage(code) || code === this.activeLang()) return;
        this.apply(code);

        const user = this.authStore.currentUser();
        if (!user?.id) return;
        try {
            await this.authStore.updateUserProfile(user.id, { preferredLanguage: code });
        } catch (error) {
            // The choice still holds for this browser via the cache; only the
            // cross-device part is lost, which is not worth interrupting for.
            console.error('Could not save the admin language preference:', error);
        }
    }

    private apply(code: string): void {
        this.transloco.setActiveLang(code);
        this.activeLang.set(code);
        this.cache(code);
    }

    private cache(code: string): void {
        if (!isPlatformBrowser(this.platformId)) return;
        try {
            localStorage.setItem(ADMIN_LANGUAGE_CACHE_KEY, code);
        } catch {
            // Private browsing or a full quota — never worth failing a
            // language switch over; it just is not remembered.
        }
    }
}

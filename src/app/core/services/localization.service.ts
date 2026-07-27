/**
 * Localization Service
 *
 * Single frontend entry point for "which languages does this site publish?".
 * Reads `Settings/localization` once, caches it, and exposes the result as
 * signals for the editor, the admin settings page and (later) the public
 * language switcher.
 *
 * Deliberately a one-time `getDoc` rather than an `onSnapshot` listener: the
 * language list changes about as often as the site name, and a live listener
 * constructed during SSR outlives the request injector and crashes the server
 * on the next snapshot (see the note in `GlobalMessageService`).
 *
 * Spec: docs/multilingual-spec.md — Phase M1.
 */

import { inject, Injectable, Injector, runInInjectionContext, signal, computed } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import {
    DEFAULT_LOCALIZATION_SETTINGS,
    ILanguage,
    ILocalizationSettings,
    extraLanguages,
    findLanguage,
    isLanguageEnabled,
    languagePathPrefix,
    normalizeLocalizationSettings,
} from '../../../shared/models/localization.model';

export const SETTINGS_COLLECTION = 'Settings';
export const LOCALIZATION_DOC = 'localization';

@Injectable({ providedIn: 'root' })
export class LocalizationService {
    private injector = inject(Injector);

    /**
     * Resolved on first use rather than injected in the constructor.
     *
     * The public language switcher lives in the site header, so this service
     * is constructed by anything that renders a page. Requiring Firestore up
     * front would make every one of those components — and every one of their
     * specs — depend on it, for a read whose failure this service already
     * treats as "single-language site".
     */
    private get firestore(): Firestore {
        return this.injector.get(Firestore);
    }

    private readonly settingsSignal = signal<ILocalizationSettings>(DEFAULT_LOCALIZATION_SETTINGS);
    private readonly loadedSignal = signal(false);

    /** In-flight load, so concurrent callers share one Firestore read. */
    private loadPromise: Promise<ILocalizationSettings> | null = null;

    /** Normalized settings. Defaults until the first load resolves. */
    readonly settings = this.settingsSignal.asReadonly();
    /** True once a load attempt has completed (successfully or not). */
    readonly loaded = this.loadedSignal.asReadonly();

    /**
     * Whether the page currently being rendered actually exists in other
     * languages.
     *
     * Only content pages are published per language. The home page and the
     * static pages are single-language, so offering to switch there would link
     * to a URL that does not exist — `/hi` is not a route and falls through to
     * the content-list route, rendering an empty page for a content type
     * called "hi".
     *
     * Content components set this while they are on screen; the switcher hides
     * itself otherwise. This mirrors the static pipeline, which only injects a
     * switcher into content pages.
     */
    readonly hasLanguageVariants = signal(false);

    readonly defaultLanguage = computed(() => this.settingsSignal().defaultLanguage);
    readonly enabledLanguages = computed(() => this.settingsSignal().enabledLanguages);
    /** Languages needing translations — i.e. everything but the default. */
    readonly extraLanguages = computed(() => extraLanguages(this.settingsSignal()));
    /** True when the site publishes in more than one language. */
    readonly isMultilingual = computed(() => this.settingsSignal().enabledLanguages.length > 1);

    /**
     * Loads the settings once and caches them. Subsequent calls return the
     * cached value; pass `force: true` after a save to refresh.
     */
    async load(force = false): Promise<ILocalizationSettings> {
        if (!force && this.loadedSignal()) return this.settingsSignal();
        if (!force && this.loadPromise) return this.loadPromise;

        this.loadPromise = this.fetch();
        try {
            return await this.loadPromise;
        } finally {
            this.loadPromise = null;
        }
    }

    private async fetch(): Promise<ILocalizationSettings> {
        try {
            const snap = await runInInjectionContext(this.injector, () =>
                getDoc(doc(this.firestore, SETTINGS_COLLECTION, LOCALIZATION_DOC)),
            );
            const settings = normalizeLocalizationSettings(snap.exists() ? snap.data() : null);
            this.settingsSignal.set(settings);
            return settings;
        } catch (error) {
            // A missing doc or a denied read must never break page rendering —
            // a single-language site is the correct fallback.
            console.error('Error loading localization settings:', error);
            this.settingsSignal.set(DEFAULT_LOCALIZATION_SETTINGS);
            return DEFAULT_LOCALIZATION_SETTINGS;
        } finally {
            this.loadedSignal.set(true);
        }
    }

    /** Persists settings and refreshes the cached signals. */
    async save(settings: ILocalizationSettings): Promise<void> {
        const normalized = normalizeLocalizationSettings(settings);
        const docRef = runInInjectionContext(this.injector, () =>
            doc(this.firestore, SETTINGS_COLLECTION, LOCALIZATION_DOC),
        );
        await setDoc(docRef, normalized, { merge: true });
        this.settingsSignal.set(normalized);
        this.loadedSignal.set(true);
    }

    isEnabled(code: string): boolean {
        return isLanguageEnabled(this.settingsSignal(), code);
    }

    find(code: string): ILanguage | undefined {
        return findLanguage(this.settingsSignal(), code);
    }

    /** '' for the default language, '/{code}' otherwise. */
    pathPrefix(code: string): string {
        return languagePathPrefix(this.settingsSignal(), code);
    }
}

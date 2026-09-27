/**
 * Site Identity Service
 *
 * Who publishes this site, for the SPA fallback pages' structured data
 * (docs/discoverability-spec.md, D1). Reads `Settings/about` once and caches
 * it; the same document the publish pipeline bakes into the static pages.
 *
 * One-time `getDoc`, not a listener, for the SSR reason documented in
 * `LocalizationService`. A denied or failed read degrades to "unknown
 * publisher": the page still renders and simply omits the Organization node.
 */

import { inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { DEFAULT_ABOUT_SETTINGS, IAboutSettings } from '../../pages/admin/(settings)/about/about-settings.model';

@Injectable({ providedIn: 'root' })
export class SiteIdentityService {
    private injector = inject(Injector);

    private get firestore(): Firestore {
        return this.injector.get(Firestore);
    }

    private readonly identitySignal = signal<IAboutSettings>(DEFAULT_ABOUT_SETTINGS);
    private loadPromise: Promise<IAboutSettings> | null = null;

    /** Defaults (all empty) until the first load resolves. */
    readonly identity = this.identitySignal.asReadonly();

    /** Loads once; concurrent callers share the read. */
    load(): Promise<IAboutSettings> {
        if (!this.loadPromise) {
            this.loadPromise = this.fetch();
        }
        return this.loadPromise;
    }

    private async fetch(): Promise<IAboutSettings> {
        try {
            const snap = await runInInjectionContext(this.injector, () =>
                getDoc(doc(this.firestore, 'Settings', 'about')),
            );
            const data = (snap.exists() ? snap.data() : {}) as Partial<IAboutSettings>;
            const identity: IAboutSettings = {
                ...DEFAULT_ABOUT_SETTINGS,
                ...data,
                sameAs: Array.isArray(data.sameAs) ? data.sameAs : [],
                organizationType: data.organizationType === 'Person' ? 'Person' : 'Organization',
            };
            this.identitySignal.set(identity);
            return identity;
        } catch (error) {
            console.error('Error loading site identity:', error);
            return DEFAULT_ABOUT_SETTINGS;
        }
    }
}

/**
 * Media Settings Service
 *
 * The image maximum from `Settings/misc` (Settings, Misc), for the content
 * pages the app renders: their Unsplash size bindings (`{{ coverImage_xl }}`)
 * fit it, as on published pages. Reads once and hands the value to
 * TemplateHydrationService; `maxSize` lets a page hydrate again when it arrives.
 *
 * One-time `getDoc`, not a listener, like SiteIdentityService. A failed read
 * keeps the default.
 */

import { inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { DEFAULT_MAX_IMAGE_SIZE } from '../../../shared/utils/image-sizes';
import { TemplateHydrationService } from './template-hydration.service';

@Injectable({ providedIn: 'root' })
export class MediaSettingsService {
    private injector = inject(Injector);
    private loadPromise: Promise<number> | null = null;

    private readonly maxSizeSignal = signal(DEFAULT_MAX_IMAGE_SIZE);
    /** The default until the first load resolves. */
    readonly maxSize = this.maxSizeSignal.asReadonly();

    /** Loads once; concurrent callers share the read. */
    load(): Promise<number> {
        if (!this.loadPromise) this.loadPromise = this.fetch();
        return this.loadPromise;
    }

    private async fetch(): Promise<number> {
        try {
            const firestore = this.injector.get(Firestore);
            const snap = await runInInjectionContext(this.injector, () => getDoc(doc(firestore, 'Settings', 'misc')));
            const max = Number(snap.exists() ? snap.data()?.['mediaMaxSize'] : undefined) || DEFAULT_MAX_IMAGE_SIZE;
            TemplateHydrationService.setMaxImageSize(max);
            this.maxSizeSignal.set(max);
            return max;
        } catch (error) {
            console.error('Error loading media settings:', error);
            return DEFAULT_MAX_IMAGE_SIZE;
        }
    }
}

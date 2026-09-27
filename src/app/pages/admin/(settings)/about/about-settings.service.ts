/**
 * About Settings Service
 *
 * CRUD operations for the Settings/about Firestore document.
 */

import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { IAboutSettings, DEFAULT_ABOUT_SETTINGS } from './about-settings.model';

@Injectable({ providedIn: 'root' })
export class AboutSettingsService {
    private firestore = inject(Firestore);

    async load(): Promise<IAboutSettings> {
        const docRef = doc(this.firestore, 'Settings', 'about');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data() as Partial<IAboutSettings>;
            return {
                ...DEFAULT_ABOUT_SETTINGS,
                ...data,
                // Documents written before the identity fields existed have no
                // array here; keep the type honest for the page.
                sameAs: Array.isArray(data.sameAs) ? data.sameAs : [],
                organizationType: data.organizationType === 'Person' ? 'Person' : 'Organization',
            };
        }
        return { ...DEFAULT_ABOUT_SETTINGS };
    }

    async save(settings: IAboutSettings): Promise<void> {
        const docRef = doc(this.firestore, 'Settings', 'about');
        await setDoc(docRef, settings, { merge: true });
    }
}

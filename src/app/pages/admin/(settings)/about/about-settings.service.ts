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
            return { ...DEFAULT_ABOUT_SETTINGS, ...docSnap.data() } as IAboutSettings;
        }
        return { ...DEFAULT_ABOUT_SETTINGS };
    }

    async save(settings: IAboutSettings): Promise<void> {
        const docRef = doc(this.firestore, 'Settings', 'about');
        await setDoc(docRef, settings, { merge: true });
    }
}

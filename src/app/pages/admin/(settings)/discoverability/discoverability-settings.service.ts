/**
 * Discoverability Settings Service
 *
 * Reads and writes `Settings/discoverability` (crawler policy, llms.txt,
 * IndexNow) and applies it to Hosting through the `regenerateSeoFiles`
 * callable. Spec: docs/discoverability-spec.md, D3.
 */
import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
    IDiscoverabilitySettings,
    normalizeDiscoverabilitySettings,
} from '../../../../../shared/models/discoverability.model';

export interface RegenerateSeoFilesResult {
    files: string[];
    removed: string[];
    indexNowKey: string;
}

@Injectable({ providedIn: 'root' })
export class DiscoverabilitySettingsService {
    private firestore = inject(Firestore);
    /** Optional so specs without Firebase Functions can construct the page. */
    private functions = inject(Functions, { optional: true });

    async load(): Promise<IDiscoverabilitySettings> {
        const snap = await getDoc(doc(this.firestore, 'Settings', 'discoverability'));
        return normalizeDiscoverabilitySettings(snap.exists() ? snap.data() : null);
    }

    /**
     * Saves the policy fields. `defaultAuthorId` and the IndexNow key are
     * owned elsewhere (the Authors page and the functions) and left alone.
     */
    async save(settings: IDiscoverabilitySettings): Promise<void> {
        await setDoc(
            doc(this.firestore, 'Settings', 'discoverability'),
            {
                crawlers: settings.crawlers,
                llmsTxt: settings.llmsTxt,
                indexNow: { enabled: settings.indexNow.enabled },
            },
            { merge: true },
        );
    }

    /** Pushes robots.txt, llms.txt and the IndexNow key file to Hosting now. */
    async apply(): Promise<RegenerateSeoFilesResult> {
        if (!this.functions) throw new Error('Firebase Functions is not available.');
        const callable = httpsCallable<void, RegenerateSeoFilesResult>(this.functions, 'regenerateSeoFiles');
        return (await callable()).data;
    }
}
